"use client"

import { buildEposXml, sampleTicket, sendToEpos, type EposTicket } from "@/lib/epos"
import {
  hasNativePrinterBridge,
  isIosCapacitorRuntime,
  nativePrintAirPrint,
  nativePrintTicket,
  type NativePrinterRole,
} from "@/lib/capacitor-printer"

export type PrintKind = "bar" | "kitchen" | "suites" | "caisse"
export type PrintMode = "server" | "direct_epos" | "airprint"

type PrintSettings = {
  kitchen_ip: string
  bar_ip: string
  caisse_ip: string
  print_mode: PrintMode
}

export type PrintResult = {
  ok: boolean
  mode: PrintMode
  message?: string
}

const normalizePrintMode = (value: unknown): PrintMode => {
  if (value === "direct_epos") return "direct_epos"
  if (value === "airprint") return "airprint"
  return "server"
}

const toNativeRole = (kind: PrintKind): NativePrinterRole => kind

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const buildAirPrintHtml = (ticket: EposTicket) => {
  const linesHtml = ticket.lines
    .map((line) => {
      const alignClass = line.align === "center" ? "center" : line.align === "right" ? "right" : "left"
      const weightClass = line.bold ? "bold" : ""
      return `<div class="line ${alignClass} ${weightClass}">${escapeHtml(line.content)}</div>`
    })
    .join("")

  const title = ticket.title ? `<h1>${escapeHtml(ticket.title)}</h1>` : ""

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Impression Ticket</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
        color: #111827;
      }
      .ticket {
        width: 72mm;
        margin: 0 auto;
        font-size: 13px;
        line-height: 1.4;
        white-space: pre-wrap;
      }
      h1 {
        margin: 0 0 8px 0;
        font-size: 16px;
        text-align: center;
      }
      .line { margin: 0; }
      .line.left { text-align: left; }
      .line.center { text-align: center; }
      .line.right { text-align: right; }
      .line.bold { font-weight: 700; }
    </style>
  </head>
  <body>
    <main class="ticket">
      ${title}
      ${linesHtml}
    </main>
    <script>
      setTimeout(function () { window.print(); }, 200);
      window.onafterprint = function () { window.close(); };
    </script>
  </body>
</html>`
}

const fetchPrintSettings = async (): Promise<PrintSettings> => {
  const response = await fetch("/api/admin/print-settings", {
    method: "GET",
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error("Impossible de charger les paramètres d'impression")
  }

  const json = await response.json()
  return {
    kitchen_ip: String(json?.kitchen_ip || ""),
    bar_ip: String(json?.bar_ip || ""),
    caisse_ip: String(json?.caisse_ip || ""),
    print_mode: normalizePrintMode(json?.print_mode),
  }
}

const runServerPrint = async (kind: PrintKind, ticket: EposTicket): Promise<PrintResult> => {
  const response = await fetch("/api/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ticket }),
  })
  const json = await response.json().catch(() => ({}))

  if (!response.ok || json?.ok === false) {
    return {
      ok: false,
      mode: "server",
      message: String(json?.error || "Échec impression serveur"),
    }
  }

  return { ok: true, mode: "server" }
}

const runNativeAirPrint = async (ticket: EposTicket, kind?: PrintKind): Promise<PrintResult> => {
  if (!hasNativePrinterBridge()) {
    return { ok: false, mode: "airprint", message: "Plugin AirPrint iOS indisponible." }
  }

  const response = await nativePrintAirPrint({
    html: buildAirPrintHtml(ticket),
    jobName: kind ? `SophiaPad ${kind.toUpperCase()}` : "SophiaPad Ticket",
  })

  if (response.ok) return { ok: true, mode: "airprint" }
  return { ok: false, mode: "airprint", message: response.message || "Échec AirPrint natif" }
}

const readNativeEposErrorFromBody = (body?: string): { code?: string; message?: string } | null => {
  if (!body) return null
  const successMatch = body.match(/success="(true|false)"/i)
  if (!successMatch || successMatch[1].toLowerCase() !== "false") return null

  const codeMatch = body.match(/code="([^"]+)"/i)
  const statusMatch = body.match(/status="([^"]+)"/i)
  const code = codeMatch?.[1]
  const status = statusMatch?.[1]
  const base = code ? `Epson error ${code}` : "Epson error"
  const message = status ? `${base} (status ${status})` : base
  return { code, message }
}

const runDirectEposPrint = async (kind: PrintKind, ip: string, ticket: EposTicket): Promise<PrintResult> => {
  if (!ip) {
    return { ok: false, mode: "direct_epos", message: "IP imprimante manquante" }
  }

  if (isIosCapacitorRuntime()) {
    if (!hasNativePrinterBridge()) {
      const fallbackNoBridge = await runAirPrint(ticket, kind)
      if (fallbackNoBridge.ok) {
        return {
          ok: true,
          mode: "airprint",
          message: "Plugin Epson iOS indisponible, AirPrint lancé.",
        }
      }
      return { ok: false, mode: "direct_epos", message: "Plugin iOS PrinterBridge indisponible." }
    }

    try {
      const xml = buildEposXml(ticket)
      const rawNativeResult = await nativePrintTicket({ ip, xml, role: toNativeRole(kind) })
      const nativeBodyError = readNativeEposErrorFromBody(rawNativeResult.body)
      const nativeResult = nativeBodyError
        ? {
            ...rawNativeResult,
            ok: false,
            code: rawNativeResult.code || nativeBodyError.code || "epos_error",
            message: rawNativeResult.message || nativeBodyError.message,
          }
        : rawNativeResult
      if (nativeResult.ok) return { ok: true, mode: "direct_epos" }

      const fallback = await runNativeAirPrint(ticket, kind)
      if (fallback.ok) {
        return {
          ok: true,
          mode: "airprint",
          message: nativeResult.message
            ? `Epson indisponible (${nativeResult.message}), fallback AirPrint lancé.`
            : "Epson indisponible, fallback AirPrint lancé.",
        }
      }

      const nativeMessage = nativeResult.message || "Échec impression Epson native"
      const fallbackMessage = fallback.message ? ` Fallback AirPrint: ${fallback.message}` : ""
      return { ok: false, mode: "direct_epos", message: `${nativeMessage}.${fallbackMessage}`.trim() }
    } catch (error) {
      const nativeMessage = error instanceof Error ? error.message : "Échec impression Epson native"
      const fallback = await runNativeAirPrint(ticket, kind)
      if (fallback.ok) {
        return {
          ok: true,
          mode: "airprint",
          message: `Epson indisponible (${nativeMessage}), fallback AirPrint lancé.`,
        }
      }
      return { ok: false, mode: "direct_epos", message: `${nativeMessage}. Fallback AirPrint échoué.` }
    }
  }

  try {
    const xml = buildEposXml(ticket)
    const response = await sendToEpos(ip, xml)
    if (!response.ok) {
      return {
        ok: false,
        mode: "direct_epos",
        message: `Imprimante non joignable (${response.status})`,
      }
    }

    return { ok: true, mode: "direct_epos" }
  } catch (error) {
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:"
    const baseMessage = error instanceof Error ? error.message : "Échec impression directe"
    const message = isHttps
      ? "Le navigateur bloque l'accès HTTP local depuis HTTPS (mode direct Epson)."
      : baseMessage

    return { ok: false, mode: "direct_epos", message }
  }
}

const runAirPrint = async (ticket: EposTicket, kind?: PrintKind): Promise<PrintResult> => {
  if (isIosCapacitorRuntime() && hasNativePrinterBridge()) {
    return runNativeAirPrint(ticket, kind)
  }

  if (typeof window === "undefined") {
    return { ok: false, mode: "airprint", message: "AirPrint indisponible sur ce terminal" }
  }

  const popup = window.open("", "_blank", "noopener,noreferrer")
  if (!popup) {
    return { ok: false, mode: "airprint", message: "Autorise les popups pour lancer AirPrint" }
  }

  popup.document.open()
  popup.document.write(buildAirPrintHtml(ticket))
  popup.document.close()

  return { ok: true, mode: "airprint" }
}

type PrintTicketParams = {
  kind: PrintKind
  ticket?: EposTicket
  modeOverride?: PrintMode
  ipOverride?: string
}

export async function printTicketWithConfiguredMode(params: PrintTicketParams): Promise<PrintResult> {
  const { kind, modeOverride, ipOverride } = params
  const ticket = params.ticket || sampleTicket(kind)

  let settings: PrintSettings = { kitchen_ip: "", bar_ip: "", caisse_ip: "", print_mode: "server" }
  try {
    settings = await fetchPrintSettings()
  } catch {
    // Fallback server mode if settings endpoint is unavailable
  }

  const mode = modeOverride || settings.print_mode
  const ipFromSettings =
    kind === "bar" ? settings.bar_ip : kind === "caisse" || kind === "suites" ? settings.caisse_ip : settings.kitchen_ip
  const resolvedIp = ipOverride || ipFromSettings

  if (mode === "airprint") {
    return runAirPrint(ticket, kind)
  }

  if (mode === "direct_epos") {
    return runDirectEposPrint(kind, resolvedIp, ticket)
  }

  return runServerPrint(kind, ticket)
}
