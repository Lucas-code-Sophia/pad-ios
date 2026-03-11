type TicketTemplateParams = {
  lines: string[]
  logoDataUri: string
  title?: string
}

type EmailTemplateParams = {
  logoDataUri: string
  reviewUrl: string
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const sanitizeLine = (value: string) => (value || "").replace(/\r?\n/g, " ").trim()

const wrapLine = (line: string, maxChars: number) => {
  const text = sanitizeLine(line)
  if (text.length <= maxChars) return [text]

  const words = text.split(" ")
  const wrapped: string[] = []
  let current = ""

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`
    } else {
      wrapped.push(current)
      current = word
    }
  }

  if (current) wrapped.push(current)
  return wrapped.length ? wrapped : [text.slice(0, maxChars)]
}

export const buildTicketSvgTemplate = ({ lines, logoDataUri, title = "Ticket Client" }: TicketTemplateParams) => {
  const normalized = (lines || []).map((line) => sanitizeLine(line)).filter(Boolean)
  const wrapped = normalized.flatMap((line) => wrapLine(line, 44)).slice(0, 280)
  const isSeparator = (line: string) => /^-+$/.test(line)

  const width = 800
  const cardX = 86
  const cardW = 628
  const lineHeight = 20
  const textStartY = 166
  const textH = Math.max(1, wrapped.length) * lineHeight
  const cardH = textStartY + textH - 108 + 56
  const height = cardH + 54

  const textNodes = wrapped
    .map((line, index) => {
      const y = textStartY + index * lineHeight

      if (isSeparator(line)) {
        return `<line x1="${cardX + 30}" y1="${y - 8}" x2="${cardX + cardW - 30}" y2="${y - 8}" stroke="#b8c7d2" stroke-dasharray="5 4" stroke-width="1"/>`
      }

      const upper = line.toUpperCase()
      const strong =
        upper.includes("TOTAL") ||
        upper.includes("SOUS TOTAL") ||
        upper.includes("RESTAURANT SOPHIA") ||
        upper.includes("TICKET REPAS")
      const color = strong ? "#0f172a" : "#334155"
      const weight = strong ? 700 : 500

      return `<text x="${cardX + 30}" y="${y}" font-family="Menlo, Monaco, 'Courier New', monospace" font-size="15" font-weight="${weight}" fill="${color}">${escapeHtml(
        line,
      )}</text>`
    })
    .join("\n")

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#daf6fc" />
      <stop offset="100%" stop-color="#bfe9f8" />
    </linearGradient>
    <linearGradient id="head" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0f4b69" />
      <stop offset="100%" stop-color="#0b3551" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.22"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="${cardX}" y="20" width="${cardW}" height="${cardH}" rx="14" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="${cardX}" y="20" width="${cardW}" height="96" rx="14" fill="url(#head)"/>
  <rect x="${cardX}" y="96" width="${cardW}" height="20" fill="url(#head)"/>

  ${
    logoDataUri
      ? `<image href="${logoDataUri}" x="${cardX + 26}" y="38" width="58" height="58" preserveAspectRatio="xMidYMid meet" />`
      : ""
  }
  <text x="${cardX + 100}" y="62" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" fill="#ffffff">SOPHIA</text>
  <text x="${cardX + 100}" y="88" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="500" fill="#d9f2ff">${escapeHtml(
    title,
  )}</text>

  ${textNodes}
</svg>`
}

export const buildSophiaEmailTemplate = ({ logoDataUri, reviewUrl }: EmailTemplateParams) => `
<div style="margin:0;padding:0;background:#daf6fc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#daf6fc;padding:26px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #c8e8f5;">
          <tr>
            <td style="padding:24px 22px;background:linear-gradient(135deg,#daf6fc 0%,#bfe9f8 100%);text-align:center;">
              ${
                logoDataUri
                  ? `<img src="${logoDataUri}" alt="SOPHIA" style="width:110px;height:auto;display:block;margin:0 auto 10px auto;border-radius:10px;" />`
                  : ""
              }
              <div style="font-family:Arial,Helvetica,sans-serif;color:#081E3E;font-size:28px;font-weight:800;">SOPHIA</div>
              <div style="font-family:Arial,Helvetica,sans-serif;color:#0f4b69;font-size:14px;margin-top:4px;">Restaurant - Cap-Ferret</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:17px;font-weight:700;">Bonjour,</p>
              <p style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;line-height:1.65;">
                Merci pour votre visite chez <strong>SOPHIA</strong>.
              </p>
              <p style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;line-height:1.65;">
                Vous trouverez votre ticket en pièce jointe.
              </p>
              <div style="margin:16px 0 0 0;padding:14px 16px;border-radius:10px;background:#eef9fe;border:1px solid #d3edf8;font-family:Arial,Helvetica,sans-serif;color:#0f4b69;font-size:14px;">
                Toute l'équipe vous remercie et espère vous revoir très bientôt.
              </div>
              <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;">
                Si vous avez 30 secondes, vous pouvez laisser un avis :
                <a href="${escapeHtml(
                  reviewUrl,
                )}" target="_blank" rel="noopener noreferrer" style="color:#0284c7;font-weight:700;text-decoration:none;">donner votre avis</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px 22px 24px;border-top:1px solid #e2f2f9;font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;text-align:center;">
              Restaurant SOPHIA - 67 Boulevard de la plage, 33970 Cap-Ferret
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`
