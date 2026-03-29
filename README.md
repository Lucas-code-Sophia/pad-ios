# SophiaPad Mobile Shell (Capacitor)

Repo mobile canonique (iOS + Android) pour charger `https://pad-ios.vercel.app/` et exposer un bridge natif `PrinterBridge`:
- `discoverPrinters(timeoutMs)`
- `printTicket({ ip, xml, role })`
- `getPrinterStatus({ ip })`
- `printAirPrint({ html, jobName })`

## Setup

```bash
npm install
npm run sync:ios
npm run sync:android
npm run open:ios
npm run open:android
```

## Configuration incluse

- `server.url`: `https://pad-ios.vercel.app/`
- App id (iOS + Android): `com.lucascharles.sophiapad.ios2026app`
- iOS deployment target: `15.0`
- Permissions iOS:
  - `NSLocalNetworkUsageDescription`
  - `NSBonjourServices` (`_ipp._tcp`, `_ipps._tcp`, `_printer._tcp`, `_pdl-datastream._tcp`)
  - `NSAppTransportSecurity > NSAllowsArbitraryLoadsInLocalNetworking = true`
- Permissions Android:
  - `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`
  - `android:usesCleartextTraffic="true"`
  - `@xml/network_security_config` pour HTTP LAN Epson

## Fichiers importants

- `ios/App/App/AppDelegate.swift`
  - registration plugin natif iOS
- `android/app/src/main/java/com/lucascharles/sophiapad/ios2026app/PrinterBridgePlugin.kt`
  - plugin natif Android (scan/print/status/print systeme)
- `android/app/src/main/java/com/lucascharles/sophiapad/ios2026app/MainActivity.java`
  - registration plugin Android
- `lib/capacitor-printer.ts`
  - bridge JS commun iOS + Android
- `lib/print-client.ts`
  - choix runtime web vs natif

## Build local

```bash
npm run sync:ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
npm run build:android:debug
```

Si `xcodebuild` signale un probleme de plugin CoreSimulator, executer:

```bash
xcodebuild -runFirstLaunch
```

puis relancer le build.

## Workflow updates

- Changement web uniquement: push + deploy Vercel.
- Changement natif iOS/Android: `npm run sync:mobile`, rebuild et nouveau build store.
