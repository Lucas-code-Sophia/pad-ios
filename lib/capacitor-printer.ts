"use client"

export type NativePrinterRole = "bar" | "kitchen" | "suites" | "caisse"

export type DiscoveredNativePrinter = {
  name: string
  ip: string
  service: string
  port: number
}

type NativeBridgeResult = {
  ok?: boolean
  code?: string
  message?: string
  status?: number
  body?: string
}

type PrinterBridgePlugin = {
  discoverPrinters: (options?: { timeoutMs?: number }) => Promise<{ printers?: Array<Partial<DiscoveredNativePrinter>> }>
  printTicket: (payload: { ip: string; xml: string; role: NativePrinterRole }) => Promise<NativeBridgeResult>
  getPrinterStatus: (payload: { ip: string }) => Promise<NativeBridgeResult & { reachable?: boolean }>
  printAirPrint: (payload: { html: string; jobName?: string }) => Promise<NativeBridgeResult>
}

type CapacitorGlobal = {
  getPlatform?: () => string
  isNativePlatform?: () => boolean
  platform?: string
  Plugins?: {
    PrinterBridge?: PrinterBridgePlugin
  }
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal
  }
}

const getCapacitor = (): CapacitorGlobal | null => {
  if (typeof window === "undefined") return null
  return window.Capacitor || null
}

const getBridge = (): PrinterBridgePlugin | null => {
  const capacitor = getCapacitor()
  return capacitor?.Plugins?.PrinterBridge || null
}

const normalizeNativeResult = (value: NativeBridgeResult | null | undefined) => ({
  ok: value?.ok === true,
  code: value?.code,
  message: value?.message,
  status: value?.status,
  body: value?.body,
})

const toMessage = (error: unknown) => (error instanceof Error ? error.message : "Erreur plugin iOS")

export const isIosCapacitorRuntime = (): boolean => {
  const capacitor = getCapacitor()
  if (!capacitor) return false

  const platform = typeof capacitor.getPlatform === "function" ? capacitor.getPlatform() : capacitor.platform
  const isNative = typeof capacitor.isNativePlatform === "function" ? capacitor.isNativePlatform() : Boolean(capacitor.Plugins)

  return platform === "ios" && isNative
}

export const hasNativePrinterBridge = (): boolean => Boolean(getBridge())

export async function discoverNativePrinters(timeoutMs = 4000): Promise<{
  ok: boolean
  printers: DiscoveredNativePrinter[]
  message?: string
}> {
  if (!isIosCapacitorRuntime()) {
    return { ok: false, printers: [], message: "Scan iOS disponible uniquement dans l'app native Capacitor." }
  }

  const bridge = getBridge()
  if (!bridge?.discoverPrinters) {
    return { ok: false, printers: [], message: "Plugin iOS PrinterBridge indisponible." }
  }

  try {
    const response = await bridge.discoverPrinters({ timeoutMs })
    const rawPrinters = Array.isArray(response?.printers) ? response.printers : []
    const printers: DiscoveredNativePrinter[] = rawPrinters
      .map((printer) => ({
        name: String(printer.name || "Imprimante"),
        ip: String(printer.ip || ""),
        service: String(printer.service || ""),
        port: Number(printer.port || 0),
      }))
      .filter((printer) => printer.ip.length > 0)

    return { ok: true, printers }
  } catch (error) {
    return { ok: false, printers: [], message: toMessage(error) }
  }
}

export async function nativePrintTicket(payload: {
  ip: string
  xml: string
  role: NativePrinterRole
}): Promise<{
  ok: boolean
  code?: string
  message?: string
  status?: number
  body?: string
}> {
  const bridge = getBridge()
  if (!bridge?.printTicket) {
    return { ok: false, code: "bridge_unavailable", message: "Plugin iOS PrinterBridge indisponible." }
  }

  try {
    return normalizeNativeResult(await bridge.printTicket(payload))
  } catch (error) {
    return { ok: false, code: "unknown", message: toMessage(error) }
  }
}

export async function nativeGetPrinterStatus(payload: { ip: string }): Promise<{
  ok: boolean
  reachable: boolean
  code?: string
  message?: string
}> {
  const bridge = getBridge()
  if (!bridge?.getPrinterStatus) {
    return { ok: false, reachable: false, code: "bridge_unavailable", message: "Plugin iOS PrinterBridge indisponible." }
  }

  try {
    const result = await bridge.getPrinterStatus(payload)
    const normalized = normalizeNativeResult(result)
    return {
      ...normalized,
      reachable: result?.reachable === true,
    }
  } catch (error) {
    return { ok: false, reachable: false, code: "unknown", message: toMessage(error) }
  }
}

export async function nativePrintAirPrint(payload: {
  html: string
  jobName?: string
}): Promise<{
  ok: boolean
  code?: string
  message?: string
}> {
  const bridge = getBridge()
  if (!bridge?.printAirPrint) {
    return { ok: false, code: "bridge_unavailable", message: "Plugin iOS PrinterBridge indisponible." }
  }

  try {
    const result = normalizeNativeResult(await bridge.printAirPrint(payload))
    return { ok: result.ok, code: result.code, message: result.message }
  } catch (error) {
    return { ok: false, code: "unknown", message: toMessage(error) }
  }
}

