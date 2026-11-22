# Personal Messenger — Android

A Capacitor shell around the shared React UI. There is no UI code here; the
screens are the same `packages/ui` build the desktop app renders.

## Build the APK

Requirements: JDK 21 and an Android SDK with platform 35 + build-tools 35.
`ANDROID_HOME` defaults to `C:\Android` on this machine.

```bash
npm install
npm run apk -w @pm/mobile
```

That builds the UI, copies it to `www/`, syncs Capacitor, and assembles
`apps/mobile/release/personal-messenger-debug.apk`. The first run downloads
Gradle into `apps/mobile/.gradle-user-home`; later builds take about a minute.

The server address is baked into the bundle at build time. By default the build
picks this machine's LAN IPv4 and port 8787. If the laptop's address changes,
rebuild with:

```powershell
$env:PM_API_URL = "http://192.168.1.20:8787"
npm run apk -w @pm/mobile
```

The phone and laptop must be on the same network, the server must be running
(`npm run server:dev`), and the firewall must allow inbound TCP 8787.

## Install

```bash
adb install -r apps/mobile/release/personal-messenger-debug.apk
```

Or copy the APK to the phone and allow "install unknown apps" for the file
manager. This is a debug build signed with the local debug keystore — fine for
sideloading among friends, not for Play Store distribution.

## Notes

- The app uses plain HTTP to the LAN server, so `usesCleartextTraffic` and
  `allowMixedContent` are enabled in the generated Android project.
- Android's back gesture closes the settings sheet first, then returns from a
  conversation to the list.
- Push notifications for a closed app need a Firebase project and
  `google-services.json`; they are not part of this build. While the app is
  open, messages arrive over the live socket.
- Launcher icons and splash screens are generated from the brand mark with
  `powershell -File apps/mobile/scripts/make-icons.ps1`.
