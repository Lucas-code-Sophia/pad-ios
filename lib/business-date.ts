export const BUSINESS_TIME_ZONE = "Europe/Paris"

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
})

export const getBusinessDateIso = (value: Date | string | number = new Date()) => {
  const sourceDate = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(sourceDate.getTime())) {
    return businessDateFormatter.format(new Date())
  }
  return businessDateFormatter.format(sourceDate)
}

export const shiftIsoDate = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10))
  if (!year || !month || !day) return isoDate
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().split("T")[0]
}
