export type EposTextLine = {
  content: string
  align?: "left" | "center" | "right"
  bold?: boolean
  underline?: boolean
  width?: number
  height?: number
}

export type EposTicket = {
  title?: string
  lines: EposTextLine[]
  cut?: boolean
  beep?: boolean
}

const stripXmlDeclaration = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "")

const buildEposSoapEnvelope = (eposXml: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n` +
  `  <soapenv:Body>\n${stripXmlDeclaration(eposXml)}\n  </soapenv:Body>\n` +
  `</soapenv:Envelope>`

const parseEposResponse = (body: string) => {
  const successMatch = body.match(/success="(true|false)"/i)
  const codeMatch = body.match(/code="([^"]+)"/i)
  const statusMatch = body.match(/status="([^"]+)"/i)
  return {
    success: successMatch ? successMatch[1].toLowerCase() === "true" : undefined,
    code: codeMatch?.[1],
    status: statusMatch?.[1],
  }
}

// Build conservative ePOS-Print XML payload (avoid unsupported attrs that trigger SchemaError).
export function buildEposXml(ticket: EposTicket): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const header = `<?xml version="1.0" encoding="utf-8"?>\n<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`
  const footer = `</epos-print>`

  const parts: string[] = []
  let currentAlign: "left" | "center" | "right" = "left"

  if (ticket.title) {
    currentAlign = "center"
    parts.push(`<text align="center" />`)
    parts.push(`<text>${esc(ticket.title)}</text>`)
    parts.push(`<feed line="1" />`)
  }

  for (const line of ticket.lines) {
    const align = line.align ?? "left"
    if (align !== currentAlign) {
      parts.push(`<text align="${align}" />`)
      currentAlign = align
    }
    parts.push(`<text>${esc(line.content)}</text>`)
    parts.push(`<feed line="1" />`)
  }

  // Small spacing before cut.
  parts.push(`<feed line="3" />`)

  // NOTE: sound command is intentionally skipped to stay compatible with broader TM configs.
  if (ticket.cut) parts.push(`<cut type="feed" />`)

  return `${header}\n${parts.join("\n")}\n${footer}`
}

export async function sendToEpos(
  ip: string,
  xml: string,
  opts?: { timeoutMs?: number }
): Promise<{ ok: boolean; status: number; body: string; code?: string; printerStatus?: string }> {
  const timeoutMs = Math.max(opts?.timeoutMs ?? 7000, 1000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const soapBody = buildEposSoapEnvelope(xml)
    const res = await fetch(`http://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=${timeoutMs}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "\"\"",
      },
      body: soapBody,
      signal: controller.signal,
    })
    const text = await res.text()
    const parsed = parseEposResponse(text)
    const eposFailure = parsed.success === false
    return {
      ok: res.ok && !eposFailure,
      status: res.status,
      body: text,
      code: parsed.code,
      printerStatus: parsed.status,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function sampleTicket(kind: "bar" | "kitchen" | "suites" | "caisse"): EposTicket {
  const now = new Date().toLocaleString("fr-FR")
  const title =
    kind === "bar"
      ? "BAR"
      : kind === "kitchen"
        ? "CUISINE"
        : kind === "caisse"
          ? "CAISSE"
          : "SUIVANTS"
  return {
    title,
    lines: [
      { content: `Test d'impression - ${now}`, align: "center" },
      { content: "Table 12", align: "center" },
      { content: "-------------------------------", align: "center" },
      { content: "2x Mojito", align: "left" },
      { content: "1x Burger Classic", align: "left" },
      { content: "Note: sans oignon", align: "left" },
      { content: "-------------------------------", align: "center" },
      { content: "Merci !", align: "center" },
    ],
    cut: true,
    beep: false,
  }
}
