import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { BiometricDevice, listBiometricDevices, triggerBiometricSync } from "../api/client";

const PERIODIC_SYNC_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes -- within the requested 15-30 min range

// Owners previously had to remember to open Biometric Devices and tap
// "Sync now" to get fresh attendance data -- ZKTeco devices don't push,
// so nothing updates otherwise. This runs the same sync automatically
// (a) once on app foreground/launch and (b) on a periodic timer while
// the app stays open, for every device the owner has added. "Sync now"
// on BiometricDevicesScreen stays as a manual fallback/override --
// this hook doesn't replace it, just means the owner isn't required to
// use it every time.
//
// Deliberately app-side only, not a backend-side scheduled job: no
// physical ZKTeco device exists yet for this project (everything runs
// against the mock connector -- see biometric.py), and a cloud-hosted
// backend (Render) generally can't reach a device sitting on a
// factory's own local network without a VPN/tunnel of some kind. That
// part of the request needs a real device and real network topology to
// build against, not something to fake here.
//
// Failures are deliberately silent here (unlike the manual "Sync now"
// button, which shows an Alert) -- an automatic background sync
// failing every 20 minutes on an unreachable device would otherwise
// nag the owner with a repeating error popup for something they didn't
// even ask to happen right now. Each device's own last_synced_at /
// last_sync_status (shown on BiometricDevicesScreen) is still the
// source of truth for "how stale is this," so nothing is hidden --
// it's just not interrupting whatever screen the owner is actually on.
export function useAutoBiometricSync(token: string | null) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!token) return;

    async function syncAllDevices() {
      let devices: BiometricDevice[];
      try {
        devices = await listBiometricDevices(token!);
      } catch {
        return; // no network right now -- next trigger (foreground or timer) will retry
      }
      for (const device of devices) {
        try {
          await triggerBiometricSync(token!, device.id);
        } catch {
          // one device being unreachable shouldn't stop syncing the rest
        }
      }
    }

    syncAllDevices(); // once on mount (covers app launch)

    const interval = setInterval(syncAllDevices, PERIODIC_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (appState.current !== "active" && next === "active") {
        syncAllDevices();
      }
      appState.current = next;
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [token]);
}
