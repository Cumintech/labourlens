"""Worker ID-card photo storage.

This is the first file-upload feature in this project -- there was no
object storage of any kind configured before this (confirmed by
grepping the whole backend for boto3/S3/GCS/any upload path). The
obvious "just write to local disk" fallback does NOT work on this
project's actual host: Render's free/starter web service disk is
ephemeral and gets wiped on every deploy (which happens on every git
push), so a photo saved to local disk would silently vanish the very
next time this backend redeploys -- not a "revisit before scaling"
problem, a "doesn't survive today" one.

Instead this uses Supabase Storage -- the same Supabase project already
hosting this app's Postgres database, so it's zero new vendor
relationships, just one new bucket in a dashboard already in use.
Requires two new env vars on Render: SUPABASE_URL (the project's own
URL, e.g. https://xxxx.supabase.co) and SUPABASE_SERVICE_ROLE_KEY (from
Project Settings -> API -- the service_role key, not the anon key,
since this writes on the backend's own authority, not a signed-in
user's). A bucket named "worker-photos" must exist (Storage -> New
bucket in the Supabase dashboard); it can be private, since every read
here goes through this backend's own owner-scoped auth, never a public
Supabase Storage URL handed to the client.

Local-disk fallback: if those two env vars aren't set, photos are
written under PHOTO_STORAGE_DIR (default ./worker_photos_dev) instead.
This exists ONLY to make local development and this file's own
verify_*.py script possible without real Supabase credentials -- it is
NOT suitable for the Render deployment, per the ephemeral-disk note
above, and upload_worker_photo() below refuses to fall back silently in
that case, forcing this decision to be visible rather than a
production surprise.
"""

import os

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "worker-photos"

LOCAL_FALLBACK_DIR = os.environ.get("PHOTO_STORAGE_DIR", "./worker_photos_dev")

# Explicit opt-in for the local fallback, rather than "no Supabase env
# vars set" silently meaning "use local disk" -- a misconfigured Render
# deploy (env vars simply forgotten) should fail loudly on first upload
# attempt, not quietly start writing to a disk that's wiped on the next
# deploy.
ALLOW_LOCAL_FALLBACK = os.environ.get("PHOTO_STORAGE_ALLOW_LOCAL_FALLBACK", "false").lower() == "true"

_supabase_configured = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


class PhotoStorageNotConfigured(RuntimeError):
    pass


def _supabase_headers(content_type: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def upload_worker_photo(worker_id: int, jpeg_bytes: bytes) -> str:
    """Stores (or overwrites) this worker's single photo and returns the
    storage key to save on Worker.photo_key. One deterministic key per
    worker -- a re-upload replaces the same object, never accumulating
    old ones."""
    key = f"{worker_id}.jpg"
    if _supabase_configured:
        resp = requests.put(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{key}",
            headers={**_supabase_headers("image/jpeg"), "x-upsert": "true"},
            data=jpeg_bytes,
            timeout=15,
        )
        resp.raise_for_status()
        return key
    if not ALLOW_LOCAL_FALLBACK:
        raise PhotoStorageNotConfigured(
            "Photo storage isn't configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
            "(Supabase dashboard -> Project Settings -> API), and create a 'worker-photos' bucket "
            "under Storage. For local development only, set PHOTO_STORAGE_ALLOW_LOCAL_FALLBACK=true "
            "instead -- do not set that on Render, its disk does not persist across deploys."
        )
    os.makedirs(LOCAL_FALLBACK_DIR, exist_ok=True)
    with open(os.path.join(LOCAL_FALLBACK_DIR, key), "wb") as f:
        f.write(jpeg_bytes)
    return key


def get_worker_photo(key: str) -> bytes:
    if _supabase_configured:
        resp = requests.get(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{key}",
            headers=_supabase_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        return resp.content
    if not ALLOW_LOCAL_FALLBACK:
        raise PhotoStorageNotConfigured("Photo storage isn't configured -- see upload_worker_photo's error for setup steps.")
    with open(os.path.join(LOCAL_FALLBACK_DIR, key), "rb") as f:
        return f.read()


def delete_worker_photo(key: str) -> None:
    """Not currently called anywhere (a re-upload overwrites the same
    key instead), but kept for completeness -- e.g. a future "remove
    photo" action shouldn't have to duplicate this."""
    if _supabase_configured:
        resp = requests.delete(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{key}",
            headers=_supabase_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        return
    if not ALLOW_LOCAL_FALLBACK:
        raise PhotoStorageNotConfigured("Photo storage isn't configured -- see upload_worker_photo's error for setup steps.")
    path = os.path.join(LOCAL_FALLBACK_DIR, key)
    if os.path.exists(path):
        os.remove(path)
