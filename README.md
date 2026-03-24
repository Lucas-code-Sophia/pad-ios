# SophiaPad iOS Shell (Capacitor)

Shell iOS natif pour charger `https://pad-jiavgvljh-charleslucas-projects.vercel.app/` et exposer un bridge natif `PrinterBridge`:
- `discoverPrinters(timeoutMs)`
- `printTicket({ ip, xml, role })`
- `getPrinterStatus({ ip })`
- `printAirPrint({ html, jobName })`

## Setup

```bash
npm install
npm run sync:ios
npm run open:ios
```

## Configuration incluse

- `server.url`: `https://pad-jiavgvljh-charleslucas-projects.vercel.app/`
- iOS deployment target: `15.0`
- Bundle id: `com.sophiapad.app`
- Permissions iOS:
  - `NSLocalNetworkUsageDescription`
  - `NSBonjourServices` (`_ipp._tcp`, `_ipps._tcp`, `_printer._tcp`, `_pdl-datastream._tcp`)
  - `NSAppTransportSecurity > NSAllowsArbitraryLoadsInLocalNetworking = true`

## Fichiers importants

- `ios/App/App/AppDelegate.swift`
  - `SophiaBridgeViewController`
  - `PrinterBridgePlugin`
- `ios/App/App/Base.lproj/Main.storyboard`
  - ViewController classe: `SophiaBridgeViewController`
- `ios/App/App/Info.plist`
  - Permissions Local Network / Bonjour

## Build local

```bash
npm run sync:ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
```

Si `xcodebuild` signale un probleme de plugin CoreSimulator, executer:

```bash
xcodebuild -runFirstLaunch
```

puis relancer le build.
