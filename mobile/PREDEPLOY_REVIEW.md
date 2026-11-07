# LabourLens mobile: pre-deploy review (2026-10-07)

Scope: `mobile/` at master c293192. Nothing was fixed. Statutory calculations live in the backend and were not re-verified here (run `backend/run_verify_suite.py`).

## 1. Build gates
| Step | Result |
|---|---|
| `npm ci` | OK |
| `tsc --noEmit` | OK, no errors |
| Lint | **No linter configured** (no eslint config or script) |
| Tests | **No mobile tests exist** (CI only runs `tsc`) |
| Release bundle (`expo export --platform android`) | OK, 7.5MB hbc. A real EAS signed build was NOT run (no EAS credentials in this env) |
| `npm audit --omit=dev` | 36 vulns (1 critical, 23 high, 12 moderate). The critical one is `shell-quote`. Nearly all are build-time Expo/RN tooling (`@expo/config-plugins`, metro, cli), not shipped in the app bundle. Re-check after the SDK patch bump. |

## 2. Findings
| Sev | File:line | Issue | Fix |
|---|---|---|---|
| blocker | `eas.json:15-24`, `index.ts:10` | `EXPO_PUBLIC_SENTRY_DSN` is not set in any EAS profile, so Sentry never initialises in prod. Crash reporting is silently OFF. (`docs/CURRENT_STATUS.md` also says none; it is stale.) | Set the DSN as an EAS env var or secret for `production`, and add the `@sentry/react-native/expo` plugin to `app.json` for source maps. Verify with a test crash on a preview build. |
| blocker | `app.json` | No `ios.buildNumber` or `android.versionCode` (OK only because `appVersionSource: remote` + `autoIncrement`). No `ios.config.usesNonExemptEncryption=false` (the TestFlight export-compliance prompt blocks every build). No `extra.eas.projectId` (run `eas init`). No iOS privacy manifest declarations (required-reason APIs: AsyncStorage/file timestamps). `submit.production` is empty. | Add `ITSAppUsesNonExemptEncryption=false`, run `eas init`, set the submit config (ascAppId, track) and `ios.privacyManifests`. |
| blocker | `src/context/AuthContext.tsx:61`, `AppLockContext.tsx:44` | Startup reads from SecureStore and `JSON.parse` have no try/catch. If the keystore read fails or the stored value is corrupt (a known Android keystore reset after restore or OS update), `loading` never becomes false. `Gate` returns `null` forever, so the user sees a permanent white screen with no recovery short of a reinstall. | Wrap in try/catch/finally: on error, clear the keys and set `loading=false`. |
| high | `src/api/client.ts:142` (all 11 `fetch` calls) | No request timeout or AbortController. On a bad factory-floor network a request hangs indefinitely, and spinners/`bulkBusy` never clear. Offline detection only triggers on a thrown error, so a hung request never queues the attendance mark. | Add a shared `fetchWithTimeout` (~20s). A timeout is a network error and goes into the offline queue. |
| high | `src/api/client.ts:139` | `body.detail` from FastAPI 422 is an array of objects, so `ApiError.message` becomes `[object Object]` in alerts. | If `detail` is not a string, map it to `msg` strings or use a fallback message. |
| high | `src/api/client.ts:502-518` | Flush drops every non-401 4xx mark, including 408/429. The backend rate-limits (`slowapi`), so a flood of replayed marks after reconnect is dropped permanently with no user notice: **silent attendance loss**. | Retry (keep in the queue) on 408/429/5xx. Only drop 400/404/409/422, and tell the user how many were dropped. |
| high | `src/api/client.ts:486-516` | The queue is read-modify-write on AsyncStorage with no lock. A `markAttendance` enqueue during `flushAttendanceQueue` is overwritten by the flush's final `setItem(remaining)`, so that mark is lost. Concurrent enqueues from bulk marking (`Promise.all`) race the same way. | Serialise queue ops with a promise-chain mutex, and re-read the queue before the final write. |
| high | `AuthContext.tsx:110`, `client.ts:473` | Logout and account delete do not clear `attendance_offline_queue_v1`. Account B logging in on the same device replays account A's pending marks with B's token. Worker IDs can collide across owners, so a mark could be written against B's wrong worker. | Clear the queue on logout, or scope the key by `owner.id`. |
| high | `AttendanceScreen.tsx:154`, `client.ts:538` | The queue is flushed only when AttendanceScreen loads. Marks queued offline never sync if the user doesn't reopen that screen, and the Home or Wages screens show stale totals. The queued row is optimistic with `id:-1`, and `pendingAttendanceCount` isn't surfaced anywhere. | Flush on app foreground and on network regain (`useAutoBiometricSync` is the pattern to copy). Show a "N pending" banner. |
| med | `AttendanceScreen.tsx:369-380, 447-452` | Bulk "Present" and "Copy yesterday" fire N unbounded parallel requests (200 workers is allowed). They can hit the rate limit and Render cold starts, giving partial success. The generic "Some workers may not have been updated" alert doesn't say which ones. `changedCount` is incremented before the request succeeds. | Use batched concurrency (5-10 at a time), or a bulk endpoint, and report the failure count. |
| med | `AttendanceScreen.tsx:361-400` | Undo can't restore "unmarked" (reverts to "absent"). It also recreates leave entries with `days:1` regardless of the original `days`. This writes wrong data. | Store the original `days`. Add a delete endpoint, or label the behaviour clearly. |
| med | `AppLockContext.tsx:73` | The PIN is stored in plaintext in SecureStore, compared with `===`, with no retry limit or lockout. A 4-digit PIN is brute-forceable on the lock screen. | Hash the PIN with a salt. Add attempt limits plus a backoff, and optionally `expo-local-authentication`. |
| med | `components/ErrorBoundary.tsx:22` | `componentDidCatch` only logs in `__DEV__`. Because it swallows render errors, `Sentry.wrap` never sees them, so there is no prod visibility of crashes. | Call `Sentry.captureException(error)` (DSN-gated). |
| med | `AuthContext.tsx:107-114, 70-76` | Logout doesn't call the server to revoke the token (it is only deleted locally), and login/signup store tokens with no expiry handling beyond 401. Delete-account calls `logout()` un-awaited. There is no cache clearing between accounts on this device (the PIN also persists across logout; this is documented). | Add a server-side logout or token revocation if the backend supports it. Await `logout()`. |
| med | `AddWorkerScreen.tsx:428-436`, `ErrorBoundary.tsx` | The `console.log/warn/error` photo diagnostics are left in prod code (no PII, but they should be removed per the debug-log rule). | Delete the size-logging block, or gate it behind `__DEV__`. |
| med | `package.json` | Sentry plus Expo SDK patch versions are loose, and npm audit shows 36 vulns (build-time). `react-native-web`/`react-dom` ship in a native-only app. | Run `npx expo install --fix`, re-audit, and remove the web deps if unused. |
| med | `client.ts:13` | The API base URL falls back to `http://localhost:8010` if the env var is missing, and the default build would then ship with a cleartext, non-functional endpoint. The EAS profiles set the HTTPS URL, so production is OK. | Fail fast or fall back to the prod HTTPS URL, and assert `https://` in release (`!__DEV__`). |
| med | `docs/CURRENT_STATUS.md` | Open pilot blockers still marked OPEN: offline write buffer (actually implemented, see above), CI gate (`ci.yml` now exists), no supervisor RBAC (DECISION-NEEDED), backend dependency CVEs unverified (`cryptography==44.0.0`, `pyjwt==2.10.1`; run `pip-audit`). | Update the doc, and run `pip-audit` on the backend before the release. |
| low | `app.json` | `supportsTablet: true` without any tablet layout testing. `userInterfaceStyle: light` only. No Android adaptive-icon safe-zone check. `slug: "mobile"` and the app name are generic. | Set `supportsTablet:false`, or test on iPad (App Store review often runs on iPad). |
| low | `.env.example` | The WhatsApp sales number (`EXPO_PUBLIC_SALES_WHATSAPP`) is a real business number, committed to the repo and bundled into the app by design. The number isn't a secret, but confirm it is intended. | Confirm. No API keys, tokens or keystores found in repo or config. |
| low | `pdfShare.ts:32-36` | Exported PDFs (Form registers, with PII like names and wages) are written to the cache dir and never deleted. They are shared via the system share sheet. | Delete the file after sharing, in a `finally`. |
| low | `src/screens/*` | Whole-app lists use `FlatList` (OK); Home/Reports use plain maps on small arrays; there are no virtualisation issues found at 200 workers. Mobile has no unit tests for validators (Verhoeff) or the queue. | Add jest tests for `validators.ts` and the queue before the next release. |

## 3. Flows reviewed
Login/signup/forgot password/consent, logout, delete account, App Lock, attendance (mark, offline queue, bulk, copy, undo), PDF export/share, auto biometric sync: reviewed (findings above).
Not verified end to end (no device, no backend run): OCR/Aadhaar scan, the biometric-device connector (mock only, no real ZKTeco hardware), the Portal sync, statutory form PDF contents/calculation correctness, real-device camera/gallery permissions.

## 4. Release readiness checklist
- **ID/version:** `com.labourlens.app` on both platforms, version 1.0.0, build numbers remote-managed. OK once `eas init` is done.
- **Permissions:** the Camera and Photos usage strings are present and used (Aadhaar scan, worker photo). No unused permissions seen. Verify the merged Android manifest from the EAS build, as `expo-image-picker` can add `READ_MEDIA_*`. Play Console will want data-safety answers (Aadhaar, bank, biometric consent).
- **Privacy:** the policy is served at `/privacy-policy` and in-app, with signup consent. Both stores need the public URL entered in the console.
- **Secrets:** none in the repo (`.env` is not tracked, `*.jks/*.p8/*.p12/*.key` ignored). The EAS URL points at the Render prod host. Signing is EAS-managed (nothing local).
- **Backend:** a push to master auto-deploys to Render. Any backend change is production the moment it merges.

## Verdict: **NO-GO** (until the 3 blockers and the 6 high items above are closed)
- Required: Sentry DSN in the prod build, the app.json export-compliance/projectId/submit config, the startup white-screen guard.
- Required before real factory data: the offline-queue bugs (429 drop, race, cross-account replay, flush triggers), and request timeouts.
- Then: a real EAS preview build, tested on a physical Android and iPhone (offline marking, camera scan, PDF share, logout/login as two accounts), and `pip-audit` on the backend.
