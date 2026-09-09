"""Biometric device connector layer. Exactly one interface --
BaseConnector.fetch_punches(device) -- with two implementations:
MockConnector (no hardware needed, used for all of today's development
and every automated test) and ZKTecoConnector (the real pyzk-backed
implementation, structurally complete against pyzk's documented API
but untested against a physical unit -- none is available yet).

biometric_sync.py, the one caller of this module, only ever talks to a
connector through BaseConnector's methods. Swapping mock for real
hardware is the BIOMETRIC_CONNECTOR env var (see get_connector below),
not a rewrite of the sync job -- and adding a different device brand
later means writing one more BaseConnector subclass, not touching
anything above this module.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

import models


@dataclass
class PunchRecord:
    """Mirrors the shape pyzk's get_attendance() returns -- (user_id,
    timestamp, punch_type) -- as a real type instead of a bare tuple,
    so every connector and the sync job share one unambiguous shape."""

    device_user_id: str
    timestamp: datetime
    punch_type: str  # "in" | "out"


class ConnectorError(Exception):
    """Base for every failure mode the sync job handles explicitly."""


class DeviceUnreachableError(ConnectorError):
    """Connection timed out / device not responding on the network."""


class DeviceBusyError(ConnectorError):
    """Device already has an active connection (most ZKTeco units only
    accept one at a time) -- worth a short retry, not an immediate
    failure."""


class PartialReadError(ConnectorError):
    """The read started but didn't finish cleanly -- caller must
    discard whatever was read so far rather than write incomplete
    data; the next poll cycle re-reads the full batch from scratch."""


class BaseConnector:
    """The one interface biometric_sync.py depends on."""

    # "device" for a real connector, "mock" for a synthetic one --
    # stamped onto BiometricPunch.source so real and test-generated
    # data are distinguishable at a glance even once a real device is
    # in production alongside earlier mock/dev data.
    SOURCE_LABEL = "device"

    def fetch_punches(self, device: models.BiometricDevice) -> list[PunchRecord]:
        raise NotImplementedError

    def fetch_enrolled_user_ids(self, device: models.BiometricDevice) -> set[str]:
        """Device-side enrolled user IDs (pyzk's get_users()) -- called
        periodically, not every cycle, to reconcile which device_user_ids
        exist on the device but have no mapping yet. A connector that
        can't support this cheaply may return an empty set."""
        return set()

    def confirm_and_clear(self, device: models.BiometricDevice) -> None:
        """Called only after a pulled batch is confirmed written to
        biometric_punches -- never speculatively. No-op by default;
        ZKTecoConnector overrides it to actually clear device memory."""


class MockConnector(BaseConnector):
    """Test double and today's only real usage. `responses` is a queue
    consumed one item per fetch_punches() call (the last item repeats
    once exhausted) -- each item is either a list[PunchRecord] to
    return or an Exception instance to raise, which is what makes
    "busy on first attempt, succeeds on retry" or "always times out"
    scenarios trivial to set up in a test without needing a real
    device to misbehave on cue."""

    SOURCE_LABEL = "mock"

    def __init__(
        self,
        responses: list[list[PunchRecord] | Exception] | None = None,
        enrolled_user_ids: set[str] | None = None,
    ):
        self._responses = list(responses) if responses is not None else [default_mock_batch()]
        self._enrolled_user_ids = set(enrolled_user_ids) if enrolled_user_ids else set()
        self._call_count = 0

    def fetch_punches(self, device: models.BiometricDevice) -> list[PunchRecord]:
        index = min(self._call_count, len(self._responses) - 1)
        self._call_count += 1
        result = self._responses[index]
        if isinstance(result, Exception):
            raise result
        return list(result)

    def fetch_enrolled_user_ids(self, device: models.BiometricDevice) -> set[str]:
        return set(self._enrolled_user_ids)


def default_mock_batch() -> list[PunchRecord]:
    """A realistic single-fetch batch: normal in/out pairs for a
    handful of enrolled workers, one punch from a device_user_id with
    no mapping (a worker enrolled on the device but never mapped in
    our system), and a backlog of older timestamps as if the device
    had just reconnected after being offline for a few hours -- all in
    one batch, since that's what a real device's memory dump looks
    like on the next successful poll, not three separate fetches."""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    punches: list[PunchRecord] = []
    for uid in ("1001", "1002", "1003"):
        punches.append(PunchRecord(uid, today.replace(hour=9, minute=0), "in"))
        punches.append(PunchRecord(uid, today.replace(hour=18, minute=0), "out"))
    # Unmapped: enrolled on the device, never mapped in our system.
    punches.append(PunchRecord("9999", today.replace(hour=9, minute=5), "in"))
    # Backlog: the device was offline since yesterday and is only now
    # handing over what it buffered -- old timestamps, not spread
    # across real time.
    yesterday = today.replace(day=today.day - 1) if today.day > 1 else today
    punches.append(PunchRecord("1001", yesterday.replace(hour=9, minute=2), "in"))
    punches.append(PunchRecord("1001", yesterday.replace(hour=17, minute=58), "out"))
    return punches


class ZKTecoConnector(BaseConnector):
    """Real hardware, via the `pyzk` library. Structurally complete
    against pyzk's documented API shape -- connect (TCP by default,
    UDP if device.force_udp), disable_device() before reading so a
    mid-scan isn't caught half-written, get_attendance() for the
    batch, enable_device(), then a clean disconnect -- but genuinely
    untested against a physical unit, since none is available yet. See
    README.md's Biometric section for the checklist to run once one
    is."""

    SOURCE_LABEL = "device"

    def _connect(self, device: models.BiometricDevice):
        try:
            from zk import ZK  # deferred: pyzk is an optional dependency --
            # every real usage today is MockConnector, so nothing
            # should require pyzk to even be installed until this
            # class is actually used.
        except ImportError as e:
            raise ConnectorError(
                "pyzk is not installed -- add it to requirements.txt before using a real device"
            ) from e

        zk = ZK(
            device.ip_address,
            port=device.port,
            timeout=10,
            password=int(device.comm_password) if device.comm_password else 0,
            force_udp=device.force_udp,
        )
        try:
            return zk.connect()
        except Exception as e:
            # pyzk raises its own exception types for a dead socket --
            # "already has a session" is the one shape worth telling
            # apart (worth a quick retry), everything else is treated
            # as unreachable. Matched on message text since pyzk
            # doesn't expose a distinct exception class for it.
            if "busy" in str(e).lower() or "already" in str(e).lower():
                raise DeviceBusyError(str(e)) from e
            raise DeviceUnreachableError(str(e)) from e

    def fetch_punches(self, device: models.BiometricDevice) -> list[PunchRecord]:
        conn = self._connect(device)
        try:
            try:
                conn.disable_device()
            except Exception:
                pass  # not every model supports this -- best-effort, never fatal

            try:
                raw_records = conn.get_attendance() or []
            except Exception as e:
                raise PartialReadError(str(e)) from e

            return [
                PunchRecord(
                    device_user_id=str(record.user_id),
                    timestamp=record.timestamp
                    if record.timestamp.tzinfo
                    else record.timestamp.replace(tzinfo=timezone.utc),
                    # pyzk's punch/status codes: 0/4 are check-in-shaped,
                    # everything else treated as check-out -- the exact
                    # code table varies a little by firmware, confirm
                    # against the real device's actual values once one
                    # is available (see README.md's Biometric checklist).
                    punch_type="in" if getattr(record, "punch", 0) in (0, 4) else "out",
                )
                for record in raw_records
            ]
        finally:
            try:
                conn.enable_device()
            except Exception:
                pass
            try:
                conn.disconnect()
            except Exception:
                pass

    def fetch_enrolled_user_ids(self, device: models.BiometricDevice) -> set[str]:
        conn = self._connect(device)
        try:
            try:
                users = conn.get_users() or []
            except Exception:
                return set()
            return {str(u.user_id) for u in users}
        finally:
            try:
                conn.disconnect()
            except Exception:
                pass

    def confirm_and_clear(self, device: models.BiometricDevice) -> None:
        conn = self._connect(device)
        try:
            conn.clear_attendance()
        finally:
            try:
                conn.disconnect()
            except Exception:
                pass


def get_connector() -> BaseConnector:
    """The single config switch between mock and real hardware --
    BIOMETRIC_CONNECTOR=zkteco for a real device, anything else
    (including unset, which is today's only real usage) stays mock.
    biometric_sync.py and biometric_api.py both call this rather than
    constructing a connector directly, so there's exactly one place
    that decision is made."""
    if os.environ.get("BIOMETRIC_CONNECTOR", "mock").lower() == "zkteco":
        return ZKTecoConnector()
    return MockConnector()
