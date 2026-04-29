export const BUSINESS_TIME_ZONE = "Europe/Paris"

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
})

const businessHourFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  hour12: false,
})

const businessTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export const getBusinessDateIso = (value: Date | string | number = new Date()) => {
  const sourceDate = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(sourceDate.getTime())) {
    return businessDateFormatter.format(new Date())
  }
  return businessDateFormatter.format(sourceDate)
}

export const getBusinessHour = (value: Date | string | number): number | null => {
  const sourceDate = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(sourceDate.getTime())) return null
  const hourPart = businessHourFormatter.formatToParts(sourceDate).find((part) => part.type === "hour")
  if (!hourPart) return null
  const hour = Number.parseInt(hourPart.value, 10)
  return Number.isFinite(hour) ? hour : null
}

export const formatBusinessTime = (value: Date | string | number): string => {
  const sourceDate = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(sourceDate.getTime())) return "--:--"
  return businessTimeFormatter.format(sourceDate)
}

export const shiftIsoDate = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10))
  if (!year || !month || !day) return isoDate
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().split("T")[0]
}
