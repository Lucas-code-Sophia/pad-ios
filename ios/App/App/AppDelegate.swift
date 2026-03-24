import UIKit
import Capacitor
import Foundation
import Darwin

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

@objc(SophiaBridgeViewController)
class SophiaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrinterBridgePlugin())
    }
}

@objc(PrinterBridgePlugin)
public class PrinterBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrinterBridgePlugin"
    public let jsName = "PrinterBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discoverPrinters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printTicket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPrinterStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printAirPrint", returnType: CAPPluginReturnPromise)
    ]

    private let serviceTypes = ["_ipp._tcp.", "_ipps._tcp.", "_printer._tcp.", "_pdl-datastream._tcp."]
    private var discoverySession: PrinterDiscoverySession?

    @objc func discoverPrinters(_ call: CAPPluginCall) {
        let timeoutMs = max(call.getInt("timeoutMs") ?? 4000, 1000)
        let timeout = TimeInterval(timeoutMs) / 1000

        DispatchQueue.main.async {
            self.discoverySession?.stop()
            let session = PrinterDiscoverySession(serviceTypes: self.serviceTypes) { [weak self] printers in
                self?.resolve(call, data: ["printers": printers])
                self?.discoverySession = nil
            }
            self.discoverySession = session
            session.start(timeout: timeout)
        }
    }

    @objc func printTicket(_ call: CAPPluginCall) {
        guard let ip = call.getString("ip"), !ip.isEmpty else {
            resolve(call, data: [
                "ok": false,
                "code": "invalid_args",
                "message": "IP imprimante manquante."
            ])
            return
        }

        guard let xml = call.getString("xml"), !xml.isEmpty else {
            resolve(call, data: [
                "ok": false,
                "code": "invalid_args",
                "message": "Payload XML manquant."
            ])
            return
        }

        let timeoutMs = max(call.getInt("timeoutMs") ?? 7000, 1000)
        guard let url = URL(string: "http://\(ip)/cgi-bin/epos/service.cgi?devid=local_printer&timeout=\(timeoutMs)") else {
            resolve(call, data: [
                "ok": false,
                "code": "invalid_args",
                "message": "IP imprimante invalide."
            ])
            return
        }

        var request = URLRequest(url: url, timeoutInterval: TimeInterval(timeoutMs) / 1000)
        request.httpMethod = "POST"
        request.setValue("text/xml; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue("\"\"", forHTTPHeaderField: "SOAPAction")
        request.httpBody = buildSoapEnvelope(from: xml).data(using: .utf8)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                let mapped = self.mapNetworkError(error)
                self.resolve(call, data: [
                    "ok": false,
                    "code": mapped.code,
                    "message": mapped.message
                ])
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                self.resolve(call, data: [
                    "ok": false,
                    "code": "unknown",
                    "message": "Aucune reponse imprimante."
                ])
                return
            }

            let body = String(data: data ?? Data(), encoding: .utf8) ?? ""
            let parsed = self.parseEposResponse(body)

            if (200...299).contains(httpResponse.statusCode), parsed.success == false {
                self.resolve(call, data: [
                    "ok": false,
                    "code": parsed.code ?? "epos_error",
                    "message": self.messageForEposCode(parsed.code, status: parsed.status),
                    "status": httpResponse.statusCode,
                    "body": body
                ])
                return
            }

            if (200...299).contains(httpResponse.statusCode) {
                self.resolve(call, data: [
                    "ok": true,
                    "status": httpResponse.statusCode,
                    "body": body
                ])
                return
            }

            self.resolve(call, data: [
                "ok": false,
                "code": "http_error",
                "message": "Imprimante a retourne HTTP \(httpResponse.statusCode).",
                "status": httpResponse.statusCode,
                "body": body
            ])
        }.resume()
    }

    @objc func getPrinterStatus(_ call: CAPPluginCall) {
        guard let ip = call.getString("ip"), !ip.isEmpty else {
            resolve(call, data: [
                "ok": false,
                "reachable": false,
                "code": "invalid_args",
                "message": "IP imprimante manquante."
            ])
            return
        }

        guard let url = URL(string: "http://\(ip)/") else {
            resolve(call, data: [
                "ok": false,
                "reachable": false,
                "code": "invalid_args",
                "message": "IP imprimante invalide."
            ])
            return
        }

        var request = URLRequest(url: url, timeoutInterval: 4)
        request.httpMethod = "GET"

        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            if let error {
                let mapped = self.mapNetworkError(error)
                self.resolve(call, data: [
                    "ok": false,
                    "reachable": false,
                    "code": mapped.code,
                    "message": mapped.message
                ])
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                self.resolve(call, data: [
                    "ok": false,
                    "reachable": false,
                    "code": "unknown",
                    "message": "Aucune reponse imprimante."
                ])
                return
            }

            self.resolve(call, data: [
                "ok": true,
                "reachable": true,
                "status": httpResponse.statusCode
            ])
        }.resume()
    }

    @objc func printAirPrint(_ call: CAPPluginCall) {
        let html = call.getString("html") ?? ""
        let jobName = call.getString("jobName") ?? "SophiaPad Ticket"

        DispatchQueue.main.async {
            guard let _ = self.bridge?.viewController else {
                self.resolve(call, data: [
                    "ok": false,
                    "code": "unknown",
                    "message": "UI iOS indisponible pour AirPrint."
                ])
                return
            }

            let printInfo = UIPrintInfo(dictionary: nil)
            printInfo.outputType = .general
            printInfo.jobName = jobName

            let controller = UIPrintInteractionController.shared
            controller.printInfo = printInfo
            controller.printFormatter = UIMarkupTextPrintFormatter(markupText: html)

            controller.present(animated: true) { _, completed, error in
                if let error {
                    self.resolve(call, data: [
                        "ok": false,
                        "code": "airprint_error",
                        "message": error.localizedDescription
                    ])
                    return
                }

                if completed {
                    self.resolve(call, data: ["ok": true])
                    return
                }

                self.resolve(call, data: [
                    "ok": false,
                    "code": "cancelled",
                    "message": "Impression annulee."
                ])
            }
        }
    }

    private func buildSoapEnvelope(from xml: String) -> String {
        let cleanedXml = xml.replacingOccurrences(
            of: "^\\s*<\\?xml[^>]*\\?>\\s*",
            with: "",
            options: .regularExpression
        )

        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
          <soapenv:Body>
            \(cleanedXml)
          </soapenv:Body>
        </soapenv:Envelope>
        """
    }

    private func parseEposResponse(_ body: String) -> (success: Bool?, code: String?, status: String?) {
        let successRaw = firstRegexMatch(in: body, pattern: "success=\\\"(true|false)\\\"", options: [.caseInsensitive])
        let success = successRaw.map { $0.lowercased() == "true" }
        let code = firstRegexMatch(in: body, pattern: "code=\\\"([^\\\"]+)\\\"", options: [])
        let status = firstRegexMatch(in: body, pattern: "status=\\\"([^\\\"]+)\\\"", options: [])
        return (success: success, code: code, status: status)
    }

    private func firstRegexMatch(in text: String, pattern: String, options: NSRegularExpression.Options) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else {
            return nil
        }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range), match.numberOfRanges > 1 else {
            return nil
        }
        guard let captureRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[captureRange])
    }

    private func messageForEposCode(_ code: String?, status: String?) -> String {
        let normalizedCode = (code ?? "epos_error").lowercased()
        let statusSuffix = status != nil ? " (status \(status!))" : ""

        switch normalizedCode {
        case "schemaerror":
            return "Format XML Epson invalide.\(statusSuffix)"
        case "paperend":
            return "Imprimante sans papier.\(statusSuffix)"
        case "coveropen":
            return "Capot imprimante ouvert.\(statusSuffix)"
        case "autocuttererror":
            return "Erreur autocutter imprimante.\(statusSuffix)"
        case "mechanicalerror":
            return "Erreur mecanique imprimante.\(statusSuffix)"
        default:
            return "Impression Epson echouee (\(code ?? "epos_error")).\(statusSuffix)"
        }
    }

    private func mapNetworkError(_ error: Error) -> (code: String, message: String) {
        guard let urlError = error as? URLError else {
            return ("unknown", error.localizedDescription)
        }

        switch urlError.code {
        case .timedOut:
            return ("timeout", "Delai depasse lors de la communication imprimante.")
        case .notConnectedToInternet, .networkConnectionLost:
            return ("offline", "Connexion reseau indisponible.")
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return ("unreachable", "Imprimante non joignable sur le reseau local.")
        default:
            return ("unknown", urlError.localizedDescription)
        }
    }

    private func resolve(_ call: CAPPluginCall, data: [String: Any]) {
        DispatchQueue.main.async {
            call.resolve(data)
        }
    }
}

private final class PrinterDiscoverySession: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let serviceTypes: [String]
    private let completion: ([[String: Any]]) -> Void

    private var timeoutTimer: Timer?
    private var browsers: [NetServiceBrowser] = []
    private var services: [NetService] = []
    private var resolved: [String: [String: Any]] = [:]
    private var finished = false

    init(serviceTypes: [String], completion: @escaping ([[String: Any]]) -> Void) {
        self.serviceTypes = serviceTypes
        self.completion = completion
        super.init()
    }

    func start(timeout: TimeInterval) {
        for type in serviceTypes {
            let browser = NetServiceBrowser()
            browser.delegate = self
            browsers.append(browser)
            browser.searchForServices(ofType: type, inDomain: "local.")
        }

        timeoutTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            self?.finish()
        }
    }

    func stop() {
        finish()
    }

    private func finish() {
        if finished { return }
        finished = true

        timeoutTimer?.invalidate()
        timeoutTimer = nil

        for browser in browsers {
            browser.stop()
        }
        browsers.removeAll()

        for service in services {
            service.stop()
        }
        services.removeAll()

        let printers = resolved.values.sorted { left, right in
            let leftName = (left["name"] as? String) ?? ""
            let rightName = (right["name"] as? String) ?? ""
            if leftName == rightName {
                return ((left["ip"] as? String) ?? "") < ((right["ip"] as? String) ?? "")
            }
            return leftName < rightName
        }

        completion(printers)
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 2.5)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let ip = sender.firstIPv4Address else { return }

        let normalizedType = sender.type.hasSuffix(".") ? String(sender.type.dropLast()) : sender.type
        let key = "\(ip)-\(normalizedType)"
        resolved[key] = [
            "name": sender.name,
            "ip": ip,
            "service": normalizedType,
            "port": sender.port
        ]
    }
}

private extension NetService {
    var firstIPv4Address: String? {
        guard let addresses else { return nil }

        for addressData in addresses {
            var detectedIp: String?
            addressData.withUnsafeBytes { rawBufferPointer in
                guard let baseAddress = rawBufferPointer.baseAddress else { return }
                let address = baseAddress.assumingMemoryBound(to: sockaddr.self)

                guard address.pointee.sa_family == sa_family_t(AF_INET) else { return }

                var ipv4Address = baseAddress.assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr
                var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                if inet_ntop(AF_INET, &ipv4Address, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil {
                    detectedIp = String(cString: buffer)
                }
            }

            if let detectedIp, !detectedIp.isEmpty {
                return detectedIp
            }
        }

        return nil
    }
}
