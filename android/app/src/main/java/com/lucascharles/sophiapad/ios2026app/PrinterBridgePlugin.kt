package com.lucascharles.sophiapad.ios2026app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

@CapacitorPlugin(name = "PrinterBridge")
class PrinterBridgePlugin : Plugin() {
    private val serviceTypes = listOf("_ipp._tcp.", "_ipps._tcp.", "_printer._tcp.", "_pdl-datastream._tcp.")

    @PluginMethod
    fun discoverPrinters(call: PluginCall) {
        val timeoutMs = max(call.getInt("timeoutMs") ?: 4000, 1000)
        val appContext = context
        if (appContext == null) {
            call.resolve(
                JSObject().put("printers", JSArray()).put("ok", false).put("code", "unknown")
                    .put("message", "Contexte Android indisponible.")
            )
            return
        }

        val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
        if (nsdManager == null) {
            call.resolve(
                JSObject().put("printers", JSArray()).put("ok", false).put("code", "unavailable")
                    .put("message", "Service de decouverte Android indisponible.")
            )
            return
        }

        val handler = Handler(Looper.getMainLooper())
        val listeners = CopyOnWriteArrayList<NsdManager.DiscoveryListener>()
        val printers = ConcurrentHashMap<String, JSObject>()
        val finished = AtomicBoolean(false)

        val finish: () -> Unit = finish@{
            if (!finished.compareAndSet(false, true)) {
                return@finish
            }
            listeners.forEach { listener ->
                try {
                    nsdManager.stopServiceDiscovery(listener)
                } catch (_: Exception) {
                }
            }
            listeners.clear()

            val sortedPrinters = printers.values.sortedWith(
                compareBy<JSObject> { it.getString("ip") ?: "" }.thenBy { it.getString("name") ?: "" }
            )
            val array = JSArray()
            sortedPrinters.forEach { array.put(it) }

            call.resolve(JSObject().put("printers", array).put("ok", true))
        }

        val resolveService: (NsdServiceInfo) -> Unit = { service ->
            try {
                nsdManager.resolveService(
                    service,
                    object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                            // ignore a single failed resolve and continue discovery
                        }

                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            val hostAddress = serviceInfo.host?.hostAddress ?: return
                            if (hostAddress.contains(":")) return // keep IPv4 only for Epson LAN IPs

                            val serviceType = normalizeServiceType(serviceInfo.serviceType)
                            val key = "$hostAddress|$serviceType|${serviceInfo.port}"
                            val printer = JSObject()
                            printer.put("name", serviceInfo.serviceName ?: "Imprimante")
                            printer.put("ip", hostAddress)
                            printer.put("service", serviceType)
                            printer.put("port", serviceInfo.port)
                            printers[key] = printer
                        }
                    }
                )
            } catch (_: Exception) {
            }
        }

        serviceTypes.forEach { serviceType ->
            val listener = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(regType: String) {}

                override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                    resolveService(serviceInfo)
                }

                override fun onServiceLost(serviceInfo: NsdServiceInfo) {}

                override fun onDiscoveryStopped(serviceTypeStopped: String) {}

                override fun onStartDiscoveryFailed(serviceTypeFailed: String, errorCode: Int) {
                    try {
                        nsdManager.stopServiceDiscovery(this)
                    } catch (_: Exception) {
                    }
                }

                override fun onStopDiscoveryFailed(serviceTypeFailed: String, errorCode: Int) {
                    try {
                        nsdManager.stopServiceDiscovery(this)
                    } catch (_: Exception) {
                    }
                }
            }
            listeners.add(listener)
            try {
                nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
            } catch (_: Exception) {
            }
        }

        handler.postDelayed({ finish() }, timeoutMs.toLong())
    }

    @PluginMethod
    fun printTicket(call: PluginCall) {
        val ip = call.getString("ip")?.trim().orEmpty()
        val xml = call.getString("xml")?.trim().orEmpty()
        val timeoutMs = max(call.getInt("timeoutMs") ?: 7000, 1000)

        if (ip.isEmpty()) {
            call.resolve(errorResult("invalid_args", "IP imprimante manquante."))
            return
        }
        if (xml.isEmpty()) {
            call.resolve(errorResult("invalid_args", "Payload XML manquant."))
            return
        }

        bridge.execute {
            try {
                val soapBody = buildSoapEnvelope(xml)
                val response = executeHttpRequest(
                    url = "http://$ip/cgi-bin/epos/service.cgi?devid=local_printer&timeout=$timeoutMs",
                    method = "POST",
                    timeoutMs = timeoutMs,
                    body = soapBody,
                    headers = mapOf(
                        "Content-Type" to "text/xml; charset=utf-8",
                        "SOAPAction" to "\"\""
                    )
                )
                val parsed = parseEposResponse(response.body)

                if (response.status in 200..299 && parsed.success == false) {
                    call.resolve(
                        JSObject()
                            .put("ok", false)
                            .put("code", parsed.code ?: "epos_error")
                            .put("message", messageForEposCode(parsed.code, parsed.status))
                            .put("status", response.status)
                            .put("body", response.body)
                    )
                    return@execute
                }

                if (response.status in 200..299) {
                    call.resolve(
                        JSObject()
                            .put("ok", true)
                            .put("status", response.status)
                            .put("body", response.body)
                    )
                    return@execute
                }

                call.resolve(
                    JSObject()
                        .put("ok", false)
                        .put("code", "http_error")
                        .put("message", "Imprimante a retourne HTTP ${response.status}.")
                        .put("status", response.status)
                        .put("body", response.body)
                )
            } catch (error: Throwable) {
                val mapped = mapNetworkError(error)
                call.resolve(errorResult(mapped.first, mapped.second))
            }
        }
    }

    @PluginMethod
    fun getPrinterStatus(call: PluginCall) {
        val ip = call.getString("ip")?.trim().orEmpty()
        if (ip.isEmpty()) {
            call.resolve(errorResult("invalid_args", "IP imprimante manquante.").put("reachable", false))
            return
        }

        bridge.execute {
            try {
                val response = executeHttpRequest(url = "http://$ip/", method = "GET", timeoutMs = 4000)
                call.resolve(
                    JSObject()
                        .put("ok", true)
                        .put("reachable", true)
                        .put("status", response.status)
                )
            } catch (error: Throwable) {
                val mapped = mapNetworkError(error)
                call.resolve(errorResult(mapped.first, mapped.second).put("reachable", false))
            }
        }
    }

    @PluginMethod
    fun printEscPos(call: PluginCall) {
        val ip = call.getString("ip")?.trim().orEmpty()
        val timeoutMs = max(call.getInt("timeoutMs") ?: 7000, 1000)
        val cut = call.getBoolean("cut") ?: true
        val encodingName = (call.getString("encoding") ?: "cp437").trim().ifBlank { "cp437" }
        val linesArray = call.getArray("lines")
        val lines = mutableListOf<String>()
        if (linesArray != null) {
            for (index in 0 until linesArray.length()) {
                val line = linesArray.optString(index, "").trimEnd()
                lines.add(line)
            }
        }

        if (ip.isEmpty()) {
            call.resolve(errorResult("invalid_args", "IP imprimante manquante."))
            return
        }
        if (lines.isEmpty()) {
            call.resolve(errorResult("invalid_args", "Lignes ESC/POS manquantes."))
            return
        }

        bridge.execute {
            try {
                Socket().use { socket ->
                    socket.tcpNoDelay = true
                    socket.soTimeout = timeoutMs
                    socket.connect(InetSocketAddress(ip, 9100), timeoutMs)

                    val payload = buildEscPosPayload(lines, cut, encodingName)
                    socket.getOutputStream().use { output ->
                        output.write(payload)
                        output.flush()
                    }
                }
                call.resolve(JSObject().put("ok", true))
            } catch (error: Throwable) {
                val mapped = mapNetworkError(error)
                call.resolve(errorResult(mapped.first, mapped.second))
            }
        }
    }

    @PluginMethod
    fun checkEscPosPort(call: PluginCall) {
        val ip = call.getString("ip")?.trim().orEmpty()
        val timeoutMs = max(call.getInt("timeoutMs") ?: 4000, 1000)
        if (ip.isEmpty()) {
            call.resolve(errorResult("invalid_args", "IP imprimante manquante.").put("reachable", false))
            return
        }

        bridge.execute {
            try {
                Socket().use { socket ->
                    socket.soTimeout = timeoutMs
                    socket.connect(InetSocketAddress(ip, 9100), timeoutMs)
                }
                call.resolve(JSObject().put("ok", true).put("reachable", true))
            } catch (error: Throwable) {
                val mapped = mapNetworkError(error)
                call.resolve(errorResult(mapped.first, mapped.second).put("reachable", false))
            }
        }
    }

    @PluginMethod
    fun printAirPrint(call: PluginCall) {
        val html = call.getString("html").orEmpty()
        val jobName = call.getString("jobName") ?: "SophiaPad Ticket"
        val currentActivity = activity

        if (currentActivity == null) {
            call.resolve(errorResult("unknown", "UI Android indisponible pour l'impression systeme."))
            return
        }

        currentActivity.runOnUiThread {
            val webView = WebView(currentActivity)
            val resolved = AtomicBoolean(false)

            fun resolveOnce(data: JSObject) {
                if (resolved.compareAndSet(false, true)) {
                    call.resolve(data)
                }
            }

            webView.settings.javaScriptEnabled = false
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    val printManager = currentActivity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
                    if (printManager == null) {
                        resolveOnce(errorResult("unavailable", "Service d'impression Android indisponible."))
                        view.destroy()
                        return
                    }

                    try {
                        val adapter = view.createPrintDocumentAdapter(jobName)
                        printManager.print(jobName, adapter, PrintAttributes.Builder().build())
                        resolveOnce(JSObject().put("ok", true))
                    } catch (error: Throwable) {
                        resolveOnce(errorResult("airprint_error", error.message ?: "Echec impression systeme Android."))
                    } finally {
                        view.postDelayed({ view.destroy() }, 1000)
                    }
                }

                @Suppress("DEPRECATION")
                override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                    resolveOnce(errorResult("airprint_error", description ?: "Echec impression systeme Android."))
                    view.destroy()
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (!request.isForMainFrame) return
                    resolveOnce(errorResult("airprint_error", error.description?.toString() ?: "Echec impression systeme Android."))
                    view.destroy()
                }
            }

            webView.loadDataWithBaseURL(null, html, "text/html", StandardCharsets.UTF_8.name(), null)
        }
    }

    private fun buildSoapEnvelope(xml: String): String {
        val cleanedXml = xml.replace(Regex("^\\s*<\\?xml[^>]*\\?>\\s*", RegexOption.IGNORE_CASE), "")
        return """
            <?xml version="1.0" encoding="UTF-8"?>
            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
              <soapenv:Body>
                $cleanedXml
              </soapenv:Body>
            </soapenv:Envelope>
        """.trimIndent()
    }

    private fun normalizeServiceType(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw.trim().trimEnd('.')
    }

    private fun parseEposResponse(body: String): ParsedEposResponse {
        val success = Regex("success=\"(true|false)\"", RegexOption.IGNORE_CASE)
            .find(body)
            ?.groupValues
            ?.getOrNull(1)
            ?.lowercase(Locale.ROOT)
            ?.let { it == "true" }
        val code = Regex("code=\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
        val status = Regex("status=\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
        return ParsedEposResponse(success = success, code = code, status = status)
    }

    private fun messageForEposCode(code: String?, status: String?): String {
        val normalizedCode = (code ?: "epos_error").lowercase(Locale.ROOT)
        val suffix = if (!status.isNullOrBlank()) " (status $status)" else ""

        return when (normalizedCode) {
            "schemaerror" -> "Format XML Epson invalide.$suffix"
            "paperend" -> "Imprimante sans papier.$suffix"
            "coveropen" -> "Capot imprimante ouvert.$suffix"
            "autocuttererror" -> "Erreur autocutter imprimante.$suffix"
            "mechanicalerror" -> "Erreur mecanique imprimante.$suffix"
            else -> "Impression Epson echouee (${code ?: "epos_error"}).$suffix"
        }
    }

    private fun buildEscPosPayload(lines: List<String>, cut: Boolean, encodingName: String): ByteArray {
        val charset = resolveEscPosCharset(encodingName)
        val output = ByteArrayOutputStream()
        output.write(byteArrayOf(0x1B.toByte(), 0x40.toByte())) // ESC @ init
        lines.forEach { line ->
            output.write(line.toByteArray(charset))
            output.write(byteArrayOf(0x0A.toByte()))
        }
        if (cut) {
            output.write(byteArrayOf(0x1D.toByte(), 0x56.toByte(), 0x41.toByte(), 0x00.toByte())) // GS V A 0
        }
        return output.toByteArray()
    }

    private fun resolveEscPosCharset(encodingName: String): Charset {
        val normalized = encodingName.lowercase(Locale.ROOT)
        val target = if (normalized == "cp437" || normalized == "ibm437") "CP437" else encodingName
        return try {
            Charset.forName(target)
        } catch (_: Exception) {
            Charset.forName("CP437")
        }
    }

    private fun executeHttpRequest(
        url: String,
        method: String,
        timeoutMs: Int,
        body: String? = null,
        headers: Map<String, String> = emptyMap()
    ): HttpResponse {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            doInput = true
            useCaches = false
            instanceFollowRedirects = false
            headers.forEach { (name, value) -> setRequestProperty(name, value) }
        }

        try {
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { output ->
                    output.write(body.toByteArray(StandardCharsets.UTF_8))
                    output.flush()
                }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else (connection.errorStream ?: connection.inputStream)
            val responseBody = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() } ?: ""
            return HttpResponse(status = status, body = responseBody)
        } finally {
            connection.disconnect()
        }
    }

    private fun mapNetworkError(error: Throwable): Pair<String, String> {
        if (error is SocketTimeoutException) {
            return "timeout" to "Delai depasse lors de la communication imprimante."
        }

        if (!isNetworkConnected()) {
            return "offline" to "Connexion reseau indisponible."
        }

        return when (error) {
            is UnknownHostException, is ConnectException, is NoRouteToHostException ->
                "unreachable" to "Imprimante non joignable sur le reseau local."

            is SocketException -> {
                val message = error.message ?: ""
                if (message.contains("ENETUNREACH", ignoreCase = true)) {
                    "offline" to "Connexion reseau indisponible."
                } else {
                    "unknown" to message.ifBlank { "Erreur reseau inconnue." }
                }
            }

            is IOException -> "unknown" to (error.message ?: "Erreur reseau inconnue.")
            else -> "unknown" to (error.message ?: "Erreur inconnue.")
        }
    }

    private fun isNetworkConnected(): Boolean {
        val appContext = context ?: return false
        val connectivityManager = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = connectivityManager.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun errorResult(code: String, message: String): JSObject {
        return JSObject().put("ok", false).put("code", code).put("message", message)
    }

    private data class ParsedEposResponse(
        val success: Boolean?,
        val code: String?,
        val status: String?
    )

    private data class HttpResponse(
        val status: Int,
        val body: String
    )
}
