# Labour Lens — mobile app

Expo (React Native + TypeScript). Targets Android and iOS from one
codebase. See root [SPEC.md](../SPEC.md) for why Expo — no Mac is
available for this project, and Expo is the path to real iOS testing
without one.

## Expo SDK is pinned to 54, not latest — deliberately

As of 2026-08-17, the Expo Go app you get from the Play Store/App Store is
stuck on **SDK 54** — Apple hasn't approved Expo's newer Expo Go
submissions in months, so the store build hasn't caught up. This project
was briefly on SDK 57 (Day 1's default scaffold) and hit "project is
incompatible with this version of Expo Go" as a result. Downgraded via
`npx expo install expo@^54.0.0 && npx expo install --fix` on Day 2.

**Don't casually bump this back to "latest"** — check whether the
store-published Expo Go has actually caught up first (see
[expo.dev/changelog](https://expo.dev/changelog) for Expo Go/App Store
updates), or you'll hit this same error again.

## Running it on your own phone

1. Install **Expo Go** from the Play Store (Android) or App Store (iOS).
2. Find this computer's LAN IP: open PowerShell, run `ipconfig`, look for
   "IPv4 Address" under your active network adapter (e.g. `192.168.1.23`).
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to that IP
   and the backend's port (`http://192.168.1.23:8010`) — not `localhost`,
   since your phone is a separate device on the network, not this machine.
4. Make sure the backend (`../backend`) is running and reachable on that
   IP (`uvicorn main:app --host 0.0.0.0 --port 8010` — `0.0.0.0`, not
   `127.0.0.1`, so it accepts connections from your phone, not just this
   machine).
5. From this folder: `npm install` then `npx expo start`.
6. Scan the QR code Expo prints with Expo Go (Android: in-app scanner;
   iOS: the Camera app, then tap the notification).

Your phone and this computer need to be on the **same Wi-Fi network** for
this to work.

## What exists today (Day 1)

- Login screen, wired to the real backend (`POST /owners/login`) — not a
  mock, an actual network call.
- Token persisted via AsyncStorage — closing and reopening the app stays
  logged in.
- Navigation shell with placeholder screens for Dashboard, Worker List,
  New Worker Scan, and Mark Attendance — proves routing works, not the
  real screens yet (Days 2 and 4 build those).

## What's not here yet

- Aadhaar camera scan + OCR (Day 2)
- Real worker list, attendance marking, dashboard, reports (Days 2, 4)
- Signup screen (backend endpoint exists, `POST /owners/signup` — no UI
  for it yet; today's Day 1 test data was created directly against the
  API, see the root Day 1 summary)
