"use client"

import { buildEposXml, sampleTicket, sendToEpos, type EposTicket } from "@/lib/epos"
import {
  getNativeCapacitorPlatform,
  hasNativePrinterBridge,
  isNativeCapacitorRuntime,
  nativePrintEscPos,
  nativePrintTicket,
  type NativePrinterRole,
} from "@/lib/capacitor-printer"

export type PrintKind = "bar" | "kitchen" | "suites" | "caisse"
export type PrintMode = "server" | "direct_epos" | "escpos_tcp"

export type PrintSettings = {
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
  if (value === "escpos_tcp") return "escpos_tcp"
  if (value === "airprint") return "direct_epos"
  return "server"
}

const toNativeRole = (kind: PrintKind): NativePrinterRole => kind

const DEFAULT_PRINT_SETTINGS: PrintSettings = { kitchen_ip: "", bar_ip: "", caisse_ip: "", print_mode: "server" }

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

export const getConfiguredPrintSettings = async (): Promise<PrintSettings> => {
  try {
    return await fetchPrintSettings()
  } catch {
    return DEFAULT_PRINT_SETTINGS
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

  if (isNativeCapacitorRuntime()) {
    const nativePlatform = getNativeCapacitorPlatform()
    const nativeLabel = nativePlatform === "android" ? "Android" : "iOS"

    if (!hasNativePrinterBridge()) {
      return { ok: false, mode: "direct_epos", message: `Plugin PrinterBridge ${nativeLabel} indisponible.` }
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
      const nativeMessage = nativeResult.message || "Échec impression Epson native"
      return { ok: false, mode: "direct_epos", message: nativeMessage }
    } catch (error) {
      const nativeMessage = error instanceof Error ? error.message : "Échec impression Epson native"
      return { ok: false, mode: "direct_epos", message: nativeMessage }
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

const toEscPosLines = (ticket: EposTicket): string[] => {
  const lines: string[] = []
  if (ticket.title) {
    lines.push(ticket.title)
    lines.push("")
  }
  for (const line of ticket.lines) {
    lines.push(line.content)
  }
  return lines
}

const runEscPosPrint = async (_kind: PrintKind, ip: string, ticket: EposTicket): Promise<PrintResult> => {
  if (!ip) {
    return { ok: false, mode: "escpos_tcp", message: "IP imprimante manquante" }
  }

  if (!isNativeCapacitorRuntime()) {
    return {
      ok: false,
      mode: "escpos_tcp",
      message: "Mode ESC/POS TCP (9100) disponible uniquement dans l'app native iOS/Android.",
    }
  }

  const nativePlatform = getNativeCapacitorPlatform()
  const nativeLabel = nativePlatform === "android" ? "Android" : "iOS"
  if (!hasNativePrinterBridge()) {
    return {
      ok: false,
      mode: "escpos_tcp",
      message: `Plugin PrinterBridge ${nativeLabel} indisponible.`,
    }
  }

  try {
    const nativeResult = await nativePrintEscPos({
      ip,
      port: 9100,
      lines: toEscPosLines(ticket),
      cut: true,
      encoding: "cp437",
    })
    if (nativeResult.ok) return { ok: true, mode: "escpos_tcp" }
    return {
      ok: false,
      mode: "escpos_tcp",
      message: nativeResult.message || "Echec impression ESC/POS TCP",
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Echec impression ESC/POS TCP"
    return { ok: false, mode: "escpos_tcp", message }
  }
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

  const settings = await getConfiguredPrintSettings()

  const mode = modeOverride || settings.print_mode
  const ipFromSettings =
    kind === "bar" ? settings.bar_ip : kind === "caisse" || kind === "suites" ? settings.caisse_ip : settings.kitchen_ip
  const resolvedIp = ipOverride || ipFromSettings

  if (mode === "direct_epos") {
    return runDirectEposPrint(kind, resolvedIp, ticket)
  }
  if (mode === "escpos_tcp") {
    return runEscPosPrint(kind, resolvedIp, ticket)
  }

  return runServerPrint(kind, ticket)
}
