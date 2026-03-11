import { promises as fs } from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { buildSophiaEmailTemplate, buildTicketSvgTemplate } from "@/lib/ticket-email-template"

type Body = {
  to?: string
  subject?: string
  html?: string
  pdfLines?: string[]
  ticketImageBase64?: string
  ticketType?: "addition" | "repas" | string
  tableNumber?: string
}

const REVIEW_URL = "https://g.page/r/CbOjHUpZBsNdEAE/review"

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const loadLogoDataUri = async () => {
  const candidates = ["placeholder-logo.png", "icon-192.png", "icon.png"]
  for (const fileName of candidates) {
    try {
      const logoPath = path.join(process.cwd(), "public", fileName)
      const file = await fs.readFile(logoPath)
      const mime = fileName.endsWith(".png") ? "image/png" : "image/jpeg"
      return `data:${mime};base64,${file.toString("base64")}`
    } catch {
      // try next candidate
    }
  }
  return ""
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body
    const to = (body.to || "").trim()
    const subject = (body.subject || "").trim()
    const pdfLines = Array.isArray(body.pdfLines) ? body.pdfLines : []
    const ticketImageBase64Raw = typeof body.ticketImageBase64 === "string" ? body.ticketImageBase64.trim() : ""
    const ticketImageBase64 = ticketImageBase64Raw.replace(/^data:image\/png;base64,/, "")
    const ticketType = body.ticketType || "addition"
    const tableNumber = body.tableNumber || "-"

    if (!to || !isValidEmail(to)) {
      return NextResponse.json({ error: "Adresse email invalide" }, { status: 400 })
    }

    if (!subject) {
      return NextResponse.json({ error: "Contenu du ticket manquant" }, { status: 400 })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: "Configuration email manquante (RESEND_API_KEY)" },
        { status: 500 },
      )
    }

    const from = process.env.BILL_EMAIL_FROM || "SOPHIA <onboarding@resend.dev>"
    const replyTo = process.env.BILL_EMAIL_REPLY_TO || undefined
    const now = new Date()
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`
    const cleanTable = String(tableNumber).replace(/[^a-zA-Z0-9_-]/g, "")
    const cleanTicketType = String(ticketType).replace(/[^a-zA-Z0-9_-]/g, "") || "addition"
    const pngFileName = `ticket-${cleanTicketType}-table-${cleanTable || "NA"}-${dateStamp}.png`
    const finalPdfLines =
      pdfLines.length > 0
        ? pdfLines
        : [
            "RESTAURANT SOPHIA",
            `Table ${tableNumber}`,
            new Date().toLocaleString("fr-FR"),
            "------------------------------",
            "Ticket en piece jointe",
          ]
    const logoDataUri = await loadLogoDataUri()
    let pngBase64 = ticketImageBase64

    if (!pngBase64) {
      const ticketSvg = buildTicketSvgTemplate({
        lines: finalPdfLines,
        logoDataUri,
        title: cleanTicketType === "repas" ? "Ticket repas" : "Ticket addition",
      })
      const sharpModule = await import("sharp")
      const pngBuffer = await sharpModule.default(Buffer.from(ticketSvg)).png({ compressionLevel: 9 }).toBuffer()
      pngBase64 = pngBuffer.toString("base64")
    }

    const friendlyHtml = buildSophiaEmailTemplate({ logoDataUri, reviewUrl: REVIEW_URL })

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: friendlyHtml,
        attachments: [
          {
            content: pngBase64,
            filename: pngFileName,
            content_type: "image/png",
          },
        ],
        reply_to: replyTo,
      }),
    })

    const resendData = await resendResponse.json().catch(() => ({}))
    if (!resendResponse.ok) {
      const message =
        (resendData && typeof resendData === "object" && "message" in resendData && String(resendData.message)) ||
        "Impossible d'envoyer l'email"
      return NextResponse.json({ error: message }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      id: resendData?.id,
      to,
      ticketType,
      tableNumber,
    })
  } catch (error) {
    console.error("[v0] Error sending bill email:", error)
    return NextResponse.json({ error: "Erreur lors de l'envoi du ticket par email" }, { status: 500 })
  }
}
