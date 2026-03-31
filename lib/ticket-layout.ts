import type { EposTextLine } from "@/lib/epos"

export type TicketItemRow = {
  label: string
  amount: number
  complimentary?: boolean
  note?: string
  flag?: string
}

export type TicketTaxRow = {
  rate: number
  ht: number
  tva: number
  ttc: number
}

export type TicketPaymentRow = {
  label: string
  amount: number
}

export type TicketPrintLine = {
  content: string
  align?: EposTextLine["align"]
  font?: EposTextLine["font"]
  fontScale?: number
}

export type TicketLayoutData = {
  documentTitle: string
  metaDate: string
  serviceLine: string
  tableLine: string
  items: TicketItemRow[]
  perPersonAmount: number
  totalTtc: number
  discountsIncluded: number
  alreadyPaid: number
  dueAmount: number
  taxRows: TicketTaxRow[]
  payments: TicketPaymentRow[]
  ticketRef: string
  printedAt: string
}

const TICKET_TEXT_WIDTH = 48
const SEPARATOR_LINE = "-".repeat(TICKET_TEXT_WIDTH)
const SHORT_SEPARATOR_LINE = "-".repeat(31)
const TICKET_HEADER = [
  "Sophia",
  "67 BOULEVARD DE LA PLAGE",
  "33970 LEGE-CAP-FERRET",
  "+33615578419",
  "SARL LILY",
  "SIRET : 94077148800027",
] as const

export const formatTicketAmount = (value: number) =>
  Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export const formatTicketDateTime = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString("fr-FR")
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const escapeHtml = (value: string | undefined | null) =>
  (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const buildTicketHtml = (title: string, body: string) => `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; }
        body {
          font-family: "Helvetica Neue", Arial, sans-serif;
          color: #2f2f2f;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        #ticket-root {
          width: 76mm;
          margin: 0 auto;
          padding: 5mm 3.5mm 6mm;
          font-size: 13px;
          line-height: 1.25;
        }
        .head-center { text-align: center; }
        .head-title { font-size: 14px; font-weight: 500; line-height: 1.1; }
        .head-line { font-size: 14px; font-weight: 500; line-height: 1.1; text-transform: uppercase; }
        .specimen { font-size: 15px; font-weight: 700; margin-top: 1.5mm; }
        .meta-date { margin-top: 5mm; font-size: 16px; font-weight: 700; line-height: 1.1; }
        .meta-service { font-size: 16px; font-weight: 700; line-height: 1.1; margin-top: 1mm; }
        .meta-table { font-size: 14px; font-weight: 600; line-height: 1.15; margin-top: 0.8mm; }
        .price-label { font-size: 14px; margin-top: 1.8mm; margin-bottom: 2.4mm; }
        .item-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          column-gap: 2.8mm;
          align-items: baseline;
          margin: 0.6mm 0;
          font-size: 13px;
        }
        .item-name { min-width: 0; word-break: break-word; }
        .item-flag { min-width: 17mm; text-align: center; font-size: 12px; font-weight: 500; color: #444; }
        .item-price { min-width: 15mm; text-align: right; font-variant-numeric: tabular-nums; }
        .item-note {
          margin: 0.2mm 0 0.6mm 2mm;
          font-size: 12px;
          color: #444;
        }
        .summary-note {
          margin-top: 3.2mm;
          margin-bottom: 1.1mm;
          font-size: 12px;
        }
        .sum-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 14px;
          margin: 0.6mm 0;
          gap: 5mm;
        }
        .sum-row .sum-right { font-variant-numeric: tabular-nums; }
        .sum-row.muted { font-size: 13px; color: #3b3b3b; }
        .sum-row.due {
          font-size: 16px;
          font-weight: 700;
          margin-top: 1.6mm;
        }
        .dash {
          margin: 2.8mm auto;
          text-align: center;
          font-size: 11px;
          color: #5a5a5a;
        }
        .tax-head,
        .tax-row {
          display: grid;
          grid-template-columns: 1.1fr 1fr 1fr 1fr;
          column-gap: 2mm;
          align-items: baseline;
          font-variant-numeric: tabular-nums;
        }
        .tax-head {
          font-size: 13px;
          margin-bottom: 0.5mm;
        }
        .tax-row {
          font-size: 13px;
          margin: 0.4mm 0;
        }
        .tax-head span:not(:first-child),
        .tax-row span:not(:first-child) { text-align: right; }
        .payment-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 14px;
          margin: 0.6mm 0;
          font-variant-numeric: tabular-nums;
          gap: 5mm;
        }
        .ticket-ref {
          margin-top: 2mm;
          font-size: 10px;
          color: #4f4f4f;
        }
        .printed-at {
          text-align: right;
          margin-top: 1.8mm;
          font-size: 10px;
          color: #4f4f4f;
        }
        .final-dash {
          margin-top: 4mm;
          text-align: center;
          font-size: 11px;
          color: #5a5a5a;
        }
        @media print {
          #ticket-root { width: auto; padding: 4mm 2.5mm 5mm; }
        }
      </style>
    </head>
    <body><div id="ticket-root">${body}</div></body>
  </html>
`

const buildItemRowsHtml = (rows: TicketItemRow[]) =>
  rows
    .map((row) => {
      const rowFlag = [row.flag || "", row.complimentary ? "OFFERT" : ""].filter(Boolean).join(" • ")
      return `
        <div class="item-row">
          <span class="item-name">${escapeHtml(row.label)}</span>
          <span class="item-flag">${escapeHtml(rowFlag)}</span>
          <span class="item-price">${formatTicketAmount(row.amount)}</span>
        </div>
        ${row.note ? `<div class="item-note">+ ${escapeHtml(row.note)}</div>` : ""}
      `
    })
    .join("")

const buildTaxRowsHtml = (rows: TicketTaxRow[]) =>
  rows
    .map(
      (row) => `
        <div class="tax-row">
          <span>${formatTicketAmount(row.rate)} %</span>
          <span>${formatTicketAmount(row.ht)}</span>
          <span>${formatTicketAmount(row.tva)}</span>
          <span>${formatTicketAmount(row.ttc)}</span>
        </div>
      `,
    )
    .join("")

const buildPaymentRowsHtml = (rows: TicketPaymentRow[]) =>
  rows
    .map(
      (row) => `<div class="payment-row"><span>${escapeHtml(row.label)}</span><span>${formatTicketAmount(row.amount)}</span></div>`,
    )
    .join("")

export const buildTicketPaymentRows = (values: {
  cb?: number
  cash?: number
  tr?: number
  renderedChange?: number
}): TicketPaymentRow[] => {
  const rows: TicketPaymentRow[] = []
  const cb = Number(values.cb || 0)
  const cash = Number(values.cash || 0)
  const tr = Number(values.tr || 0)
  const renderedChange = Number(values.renderedChange || 0)

  if (cb > 0) rows.push({ label: "CB", amount: cb })
  if (cash > 0) rows.push({ label: "Cash", amount: cash })
  if (renderedChange > 0) rows.push({ label: "Rendu", amount: renderedChange })
  if (tr > 0) rows.push({ label: "TR", amount: tr })
  return rows
}

export const buildReceiptTicketHtml = (data: TicketLayoutData) => {
  const headerHtml = `
    <div class="head-center head-title">${TICKET_HEADER[0]}</div>
    <div class="head-center head-line">${TICKET_HEADER[1]}</div>
    <div class="head-center head-line">${TICKET_HEADER[2]}</div>
    <div class="head-center head-line">${TICKET_HEADER[3]}</div>
    <div class="head-center head-line">${TICKET_HEADER[4]}</div>
    <div class="head-center head-line">${TICKET_HEADER[5]}</div>
    <div class="head-center specimen">*** SPECIMEN ***</div>
  `

  const body = `
    ${headerHtml}
    <div class="meta-date">${escapeHtml(data.metaDate)}</div>
    <div class="meta-service">${escapeHtml(data.serviceLine)}</div>
    <div class="meta-table">${escapeHtml(data.tableLine)}</div>
    <div class="price-label">Prix en €</div>
    ${buildItemRowsHtml(data.items)}
    <div class="summary-note">(Total restant par personne : ${formatTicketAmount(data.perPersonAmount)})</div>
    <div class="sum-row"><span>Total TTC</span><span class="sum-right">${formatTicketAmount(data.totalTtc)}</span></div>
    <div class="sum-row muted"><span>(remises et offres inclus)</span><span class="sum-right">${formatTicketAmount(
      data.discountsIncluded,
    )}</span></div>
    <div class="sum-row"><span>Déjà encaissé</span><span class="sum-right">-${formatTicketAmount(data.alreadyPaid)}</span></div>
    <div class="sum-row due"><span>Total TTC Dû</span><span class="sum-right">${formatTicketAmount(data.dueAmount)}</span></div>
    <div class="dash">---------------------------------------------------</div>
    <div class="tax-head">
      <span>Taux</span><span>HT</span><span>TVA</span><span>TTC</span>
    </div>
    ${buildTaxRowsHtml(data.taxRows)}
    <div class="dash">---------------------------------------------------</div>
    ${buildPaymentRowsHtml(data.payments)}
    <div class="ticket-ref">${escapeHtml(data.ticketRef)}</div>
    <div class="printed-at">Imprimé le ${escapeHtml(data.printedAt)}</div>
    <div class="final-dash">-------------------------------</div>
  `

  return buildTicketHtml(data.documentTitle, body)
}

const formatTicketTextRow = (left: string, right: string, width = TICKET_TEXT_WIDTH) => {
  const safeLeft = (left || "").trim()
  const safeRight = (right || "").trim()
  const minSpacing = 1
  const maxLeftLength = Math.max(0, width - safeRight.length - minSpacing)
  const trimmedLeft = safeLeft.length > maxLeftLength ? `${safeLeft.slice(0, Math.max(0, maxLeftLength - 3))}...` : safeLeft
  const spaces = Math.max(minSpacing, width - trimmedLeft.length - safeRight.length)
  return `${trimmedLeft}${" ".repeat(spaces)}${safeRight}`
}

const formatTicketTextThreeCols = (left: string, middle: string, right: string, width = TICKET_TEXT_WIDTH) => {
  const safeMiddle = (middle || "").trim()
  const safeRight = (right || "").trim()
  const minGap = 1
  const maxLeftLength = Math.max(0, width - safeMiddle.length - safeRight.length - minGap * 2)
  const safeLeft = (left || "").trim()
  const trimmedLeft = safeLeft.length > maxLeftLength ? `${safeLeft.slice(0, Math.max(0, maxLeftLength - 3))}...` : safeLeft
  const middleAndRight = `${safeMiddle}${" ".repeat(minGap)}${safeRight}`
  const spaces = Math.max(minGap, width - trimmedLeft.length - middleAndRight.length)
  return `${trimmedLeft}${" ".repeat(spaces)}${middleAndRight}`
}

const formatTaxTextHeader = () => `${"Taux".padEnd(8)}${"HT".padStart(12)}${"TVA".padStart(12)}${"TTC".padStart(12)}`

const formatTaxTextRow = (row: TicketTaxRow) =>
  `${`${formatTicketAmount(row.rate)} %`.padEnd(8)}${formatTicketAmount(row.ht).padStart(12)}${formatTicketAmount(
    row.tva,
  ).padStart(12)}${formatTicketAmount(row.ttc).padStart(12)}`

export const buildReceiptPrintLines = (data: TicketLayoutData): TicketPrintLine[] => {
  const lines: TicketPrintLine[] = [
    { content: TICKET_HEADER[0], align: "center", font: "font_a", fontScale: 1.15 },
    { content: TICKET_HEADER[1], align: "center", font: "font_a" },
    { content: TICKET_HEADER[2], align: "center", font: "font_a" },
    { content: TICKET_HEADER[3], align: "center", font: "font_a" },
    { content: TICKET_HEADER[4], align: "center", font: "font_a" },
    { content: TICKET_HEADER[5], align: "center", font: "font_a" },
    { content: "*** SPECIMEN ***", align: "center", font: "font_a", fontScale: 1.15 },
    { content: "" },
    { content: data.metaDate, font: "font_a", fontScale: 1.15 },
    { content: data.serviceLine, font: "font_a", fontScale: 1.15 },
    { content: data.tableLine },
    { content: "Prix en EUR" },
    { content: "" },
  ]

  for (const row of data.items) {
    const amountLabel = formatTicketAmount(row.amount)
    const rowFlag = [row.flag || "", row.complimentary ? "OFFERT" : ""].filter(Boolean).join(" ")
    if (rowFlag) {
      lines.push({ content: formatTicketTextThreeCols(row.label, rowFlag, amountLabel) })
    } else {
      lines.push({ content: formatTicketTextRow(row.label, amountLabel) })
    }
    if (row.note) {
      lines.push({ content: `+ ${row.note}` })
    }
  }

  lines.push({ content: "" })
  lines.push({ content: `(Total restant par personne : ${formatTicketAmount(data.perPersonAmount)})` })
  lines.push({ content: formatTicketTextRow("Total TTC", formatTicketAmount(data.totalTtc)) })
  lines.push({ content: formatTicketTextRow("(remises et offres inclus)", formatTicketAmount(data.discountsIncluded)) })
  lines.push({ content: formatTicketTextRow("Deja encaisse", `-${formatTicketAmount(data.alreadyPaid)}`) })
  lines.push({
    content: formatTicketTextRow("Total TTC Du", formatTicketAmount(data.dueAmount)),
    font: "font_a",
    fontScale: 1.5,
  })
  lines.push({ content: SEPARATOR_LINE, align: "center" })
  lines.push({ content: formatTaxTextHeader() })
  for (const row of data.taxRows) {
    lines.push({ content: formatTaxTextRow(row) })
  }
  lines.push({ content: SEPARATOR_LINE, align: "center" })
  for (const payment of data.payments) {
    lines.push({ content: formatTicketTextRow(payment.label, formatTicketAmount(payment.amount)) })
  }
  lines.push({ content: data.ticketRef })
  lines.push({ content: `Imprime le ${data.printedAt}`, align: "right" })
  lines.push({ content: "" })
  lines.push({ content: SHORT_SEPARATOR_LINE, align: "center" })

  return lines
}
