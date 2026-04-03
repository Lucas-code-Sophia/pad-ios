"use client"

import { buildEposXml, sampleTicket, sendToEpos, type EposTicket } from "@/lib/epos"
import {
  getNativeCapacitorPlatform,
  hasNativePrinterBridge,
  isNativeCapacitorRuntime,
  nativeCheckEscPosPort,
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
  kitchen_print_mode: PrintMode
  bar_print_mode: PrintMode
  caisse_print_mode: PrintMode
}

export type PrintResult = {
  ok: boolean
  mode: PrintMode
  message?: string
  diagnostics?: PrintDiagnostics
}

export type PrintDiagnosticsEntry = {
  at: string
  step: string
  ok: boolean
  code?: string
  message?: string
  status?: number
  bodySnippet?: string
  durationMs?: number
}

export type PrintDiagnostics = {
  kind: PrintKind
  mode: PrintMode
  ip?: string
  runtime: "native" | "web"
  startedAt: string
  finishedAt: string
  durationMs: number
  entries: PrintDiagnosticsEntry[]
}

const normalizePrintMode = (value: unknown): PrintMode => {
  if (value === "direct_epos") return "direct_epos"
  if (value === "escpos_tcp") return "escpos_tcp"
  if (value === "airprint") return "direct_epos"
  return "server"
}

const BODY_SNIPPET_LIMIT = 200

const bodyToSnippet = (value?: string) => {
  if (!value) return undefined
  const singleLine = value.replace(/\s+/g, " ").trim()
  if (!singleLine) return undefined
  return singleLine.length > BODY_SNIPPET_LIMIT ? `${singleLine.slice(0, BODY_SNIPPET_LIMIT)}...` : singleLine
}

const createDiagnostics = (kind: PrintKind, mode: PrintMode, ip?: string) => {
  const startedAt = Date.now()
  const runtime: "native" | "web" = isNativeCapacitorRuntime() ? "native" : "web"
  const entries: PrintDiagnosticsEntry[] = []

  const addEntry = (entry: Omit<PrintDiagnosticsEntry, "at">) => {
    entries.push({
      at: new Date().toISOString(),
      ...entry,
    })
  }

  const finalize = (): PrintDiagnostics => {
    const finishedAtMs = Date.now()
    return {
      kind,
      mode,
      ip: ip || undefined,
      runtime,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAt),
      entries,
    }
  }

  return { addEntry, finalize }
}

const toNativeRole = (kind: PrintKind): NativePrinterRole => kind

const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  kitchen_ip: "",
  bar_ip: "",
  caisse_ip: "",
  print_mode: "server",
  kitchen_print_mode: "server",
  bar_print_mode: "server",
  caisse_print_mode: "server",
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
  const globalMode = normalizePrintMode(json?.print_mode)
  const kitchenMode = normalizePrintMode(json?.kitchen_print_mode ?? globalMode)
  const barMode = normalizePrintMode(json?.bar_print_mode ?? globalMode)
  const caisseMode = normalizePrintMode(json?.caisse_print_mode ?? globalMode)
  return {
    kitchen_ip: String(json?.kitchen_ip || ""),
    bar_ip: String(json?.bar_ip || ""),
    caisse_ip: String(json?.caisse_ip || ""),
    print_mode: globalMode,
    kitchen_print_mode: kitchenMode,
    bar_print_mode: barMode,
    caisse_print_mode: caisseMode,
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
  const diagnostics = createDiagnostics(kind, "server")
  const startedAt = Date.now()
  const response = await fetch("/api/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ticket }),
  })
  const json = await response.json().catch(() => ({}))

  diagnostics.addEntry({
    step: "api_print",
    ok: response.ok && json?.ok !== false,
    status: response.status,
    message: String(json?.error || json?.message || response.statusText || ""),
    durationMs: Date.now() - startedAt,
  })

  if (!response.ok || json?.ok === false) {
    return {
      ok: false,
      mode: "server",
      message: String(json?.error || "Échec impression serveur"),
      diagnostics: diagnostics.finalize(),
    }
  }

  return { ok: true, mode: "server", diagnostics: diagnostics.finalize() }
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

const isRecoverableDirectEposError = (result: { code?: string; message?: string }) => {
  const code = String(result.code || "").toLowerCase()
  const message = String(result.message || "").toLowerCase()
  if (code === "timeout" || code === "unreachable" || code === "offline") return true
  return (
    message.includes("delai depasse") ||
    message.includes("timed out") ||
    message.includes("non joignable") ||
    message.includes("cannot connect") ||
    message.includes("connection lost")
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const wakePrinterTcp = async (ip: string) => {
  try {
    await nativeCheckEscPosPort({ ip, port: 9100, timeoutMs: 1200 })
  } catch {
    // Best effort wake-up probe only
  }
}

const runDirectEposPrint = async (kind: PrintKind, ip: string, ticket: EposTicket): Promise<PrintResult> => {
  const diagnostics = createDiagnostics(kind, "direct_epos", ip)

  if (!ip) {
    diagnostics.addEntry({
      step: "validate_ip",
      ok: false,
      code: "missing_ip",
      message: "IP imprimante manquante",
    })
    return { ok: false, mode: "direct_epos", message: "IP imprimante manquante", diagnostics: diagnostics.finalize() }
  }

  if (isNativeCapacitorRuntime()) {
    const nativePlatform = getNativeCapacitorPlatform()
    const nativeLabel = nativePlatform === "android" ? "Android" : "iOS"

    if (!hasNativePrinterBridge()) {
      diagnostics.addEntry({
        step: "bridge_check",
        ok: false,
        code: "bridge_unavailable",
        message: `Plugin PrinterBridge ${nativeLabel} indisponible.`,
      })
      return {
        ok: false,
        mode: "direct_epos",
        message: `Plugin PrinterBridge ${nativeLabel} indisponible.`,
        diagnostics: diagnostics.finalize(),
      }
    }

    const buildNativeResult = async () => {
      const xml = buildEposXml(ticket)
      const rawNativeResult = await nativePrintTicket({ ip, xml, role: toNativeRole(kind) })
      const nativeBodyError = readNativeEposErrorFromBody(rawNativeResult.body)
      return nativeBodyError
        ? {
            ...rawNativeResult,
            ok: false,
            code: rawNativeResult.code || nativeBodyError.code || "epos_error",
            message: rawNativeResult.message || nativeBodyError.message,
          }
        : rawNativeResult
    }

    try {
      const wakeStart1 = Date.now()
      await wakePrinterTcp(ip)
      diagnostics.addEntry({
        step: "wake_probe_1",
        ok: true,
        durationMs: Date.now() - wakeStart1,
      })

      const printStart1 = Date.now()
      let nativeResult = await buildNativeResult()
      diagnostics.addEntry({
        step: "native_print_1",
        ok: nativeResult.ok,
        code: nativeResult.code,
        message: nativeResult.message,
        status: nativeResult.status,
        bodySnippet: bodyToSnippet(nativeResult.body),
        durationMs: Date.now() - printStart1,
      })
      if (!nativeResult.ok && isRecoverableDirectEposError(nativeResult)) {
        await wait(350)
        const wakeStart2 = Date.now()
        await wakePrinterTcp(ip)
        diagnostics.addEntry({
          step: "wake_probe_2",
          ok: true,
          durationMs: Date.now() - wakeStart2,
        })
        const printStart2 = Date.now()
        nativeResult = await buildNativeResult()
        diagnostics.addEntry({
          step: "native_print_2",
          ok: nativeResult.ok,
          code: nativeResult.code,
          message: nativeResult.message,
          status: nativeResult.status,
          bodySnippet: bodyToSnippet(nativeResult.body),
          durationMs: Date.now() - printStart2,
        })
      }
      if (nativeResult.ok) return { ok: true, mode: "direct_epos", diagnostics: diagnostics.finalize() }
      const nativeMessage = nativeResult.message || "Échec impression Epson native"
      return { ok: false, mode: "direct_epos", message: nativeMessage, diagnostics: diagnostics.finalize() }
    } catch (error) {
      const nativeMessage = error instanceof Error ? error.message : "Échec impression Epson native"
      diagnostics.addEntry({
        step: "native_exception",
        ok: false,
        code: "exception",
        message: nativeMessage,
      })
      return { ok: false, mode: "direct_epos", message: nativeMessage, diagnostics: diagnostics.finalize() }
    }
  }

  try {
    const httpStart = Date.now()
    const xml = buildEposXml(ticket)
    const response = await sendToEpos(ip, xml)
    diagnostics.addEntry({
      step: "web_epos_http",
      ok: response.ok,
      status: response.status,
      code: response.code,
      message: response.ok ? "HTTP ePOS OK" : `Imprimante non joignable (${response.status})`,
      bodySnippet: bodyToSnippet(response.body),
      durationMs: Date.now() - httpStart,
    })
    if (!response.ok) {
      return {
        ok: false,
        mode: "direct_epos",
        message: `Imprimante non joignable (${response.status})`,
        diagnostics: diagnostics.finalize(),
      }
    }

    return { ok: true, mode: "direct_epos", diagnostics: diagnostics.finalize() }
  } catch (error) {
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:"
    const baseMessage = error instanceof Error ? error.message : "Échec impression directe"
    const message = isHttps
      ? "Le navigateur bloque l'accès HTTP local depuis HTTPS (mode direct Epson)."
      : baseMessage

    diagnostics.addEntry({
      step: "web_epos_exception",
      ok: false,
      code: "exception",
      message,
    })
    return { ok: false, mode: "direct_epos", message, diagnostics: diagnostics.finalize() }
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
  const kind = _kind
  const diagnostics = createDiagnostics(kind, "escpos_tcp", ip)

  if (!ip) {
    diagnostics.addEntry({
      step: "validate_ip",
      ok: false,
      code: "missing_ip",
      message: "IP imprimante manquante",
    })
    return { ok: false, mode: "escpos_tcp", message: "IP imprimante manquante", diagnostics: diagnostics.finalize() }
  }

  if (!isNativeCapacitorRuntime()) {
    diagnostics.addEntry({
      step: "runtime_check",
      ok: false,
      code: "non_native_runtime",
      message: "Mode ESC/POS TCP (9100) disponible uniquement dans l'app native iOS/Android.",
    })
    return {
      ok: false,
      mode: "escpos_tcp",
      message: "Mode ESC/POS TCP (9100) disponible uniquement dans l'app native iOS/Android.",
      diagnostics: diagnostics.finalize(),
    }
  }

  const nativePlatform = getNativeCapacitorPlatform()
  const nativeLabel = nativePlatform === "android" ? "Android" : "iOS"
  if (!hasNativePrinterBridge()) {
    diagnostics.addEntry({
      step: "bridge_check",
      ok: false,
      code: "bridge_unavailable",
      message: `Plugin PrinterBridge ${nativeLabel} indisponible.`,
    })
    return {
      ok: false,
      mode: "escpos_tcp",
      message: `Plugin PrinterBridge ${nativeLabel} indisponible.`,
      diagnostics: diagnostics.finalize(),
    }
  }

  try {
    const lines = toEscPosLines(ticket)
    const attemptPrint = async (step: "native_escpos_print_1" | "native_escpos_print_2") => {
      const printStart = Date.now()
      const nativeResult = await nativePrintEscPos({
        ip,
        port: 9100,
        lines,
        cut: true,
        encoding: "cp437",
      })
      diagnostics.addEntry({
        step,
        ok: nativeResult.ok,
        code: nativeResult.code,
        message: nativeResult.message,
        status: nativeResult.status,
        bodySnippet: bodyToSnippet(nativeResult.body),
        durationMs: Date.now() - printStart,
      })
      return nativeResult
    }

    let nativeResult = await attemptPrint("native_escpos_print_1")
    const shouldRetry =
      !nativeResult.ok &&
      ["timeout", "unreachable", "offline", "unknown"].includes(String(nativeResult.code || "").toLowerCase())

    if (shouldRetry) {
      const wakeStart = Date.now()
      const probe = await nativeCheckEscPosPort({ ip, port: 9100, timeoutMs: 1200 })
      diagnostics.addEntry({
        step: "escpos_probe_retry",
        ok: probe.ok && probe.reachable,
        code: probe.code,
        message: probe.message,
        durationMs: Date.now() - wakeStart,
      })
      await wait(220)
      nativeResult = await attemptPrint("native_escpos_print_2")
    }

    if (nativeResult.ok) return { ok: true, mode: "escpos_tcp", diagnostics: diagnostics.finalize() }
    return {
      ok: false,
      mode: "escpos_tcp",
      message: nativeResult.message || "Echec impression ESC/POS TCP",
      diagnostics: diagnostics.finalize(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Echec impression ESC/POS TCP"
    diagnostics.addEntry({
      step: "native_escpos_exception",
      ok: false,
      code: "exception",
      message,
    })
    return { ok: false, mode: "escpos_tcp", message, diagnostics: diagnostics.finalize() }
  }
}

type PrintTicketParams = {
  kind: PrintKind
  ticket?: EposTicket
  modeOverride?: PrintMode
  ipOverride?: string
}

const getKindPrintModeFromSettings = (kind: PrintKind, settings: PrintSettings): PrintMode => {
  if (kind === "bar") return settings.bar_print_mode || settings.print_mode
  if (kind === "caisse" || kind === "suites") return settings.caisse_print_mode || settings.print_mode
  return settings.kitchen_print_mode || settings.print_mode
}

export const getPrintModeForKind = (
  kind: PrintKind,
  settings: Pick<PrintSettings, "print_mode" | "kitchen_print_mode" | "bar_print_mode" | "caisse_print_mode">,
  modeOverride?: PrintMode,
): PrintMode => {
  if (modeOverride) return modeOverride
  if (kind === "bar") return settings.bar_print_mode || settings.print_mode
  if (kind === "caisse" || kind === "suites") return settings.caisse_print_mode || settings.print_mode
  return settings.kitchen_print_mode || settings.print_mode
}

export async function printTicketWithConfiguredMode(params: PrintTicketParams): Promise<PrintResult> {
  const { kind, modeOverride, ipOverride } = params
  const ticket = params.ticket || sampleTicket(kind)

  const settings = await getConfiguredPrintSettings()

  const mode = modeOverride || getKindPrintModeFromSettings(kind, settings)
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
