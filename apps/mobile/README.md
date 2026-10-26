# @meld/mobile

Expo app (web, iOS, Android). See the root README for setup; run from the repo root with `npm run dev:web`.

- Routes live in `src/app/` (Expo Router); non-route code in `src/components`, `src/lib`, `src/hooks`.
- Point the app at a different API with `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` (e.g. your LAN IP when testing on a phone).
- Add packages with `npx expo install <pkg>` so versions match the Expo SDK.
- Native-only modules (e.g. the Plaid Link SDK) need a development build: `npx expo run:ios`.
