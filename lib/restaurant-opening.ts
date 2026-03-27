export const RESTAURANT_OPENING_DATE = "2026-04-01"
export const RESTAURANT_OPENING_TIMESTAMP = `${RESTAURANT_OPENING_DATE}T00:00:00.000Z`

export const isBeforeRestaurantOpeningDate = (date: string) => date < RESTAURANT_OPENING_DATE

export const clampDateToRestaurantOpening = (date: string) =>
  isBeforeRestaurantOpeningDate(date) ? RESTAURANT_OPENING_DATE : date
