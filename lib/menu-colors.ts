export const MENU_BUTTON_COLORS = [
  {
    value: "blue",
    label: "Bleu",
    swatchClassName: "bg-blue-500",
    cardClassName: "bg-slate-800 border-2 border-blue-500/80 hover:bg-slate-750",
  },
  {
    value: "emerald",
    label: "Vert",
    swatchClassName: "bg-emerald-500",
    cardClassName: "bg-slate-800 border-2 border-emerald-500/80 hover:bg-slate-750",
  },
  {
    value: "amber",
    label: "Ambre",
    swatchClassName: "bg-amber-500",
    cardClassName: "bg-slate-800 border-2 border-amber-500/80 hover:bg-slate-750",
  },
  {
    value: "orange",
    label: "Orange",
    swatchClassName: "bg-orange-500",
    cardClassName: "bg-slate-800 border-2 border-orange-500/80 hover:bg-slate-750",
  },
  {
    value: "red",
    label: "Rouge",
    swatchClassName: "bg-red-500",
    cardClassName: "bg-slate-800 border-2 border-red-500/80 hover:bg-slate-750",
  },
  {
    value: "rose",
    label: "Rose",
    swatchClassName: "bg-fuchsia-500",
    cardClassName: "bg-slate-800 border-2 border-fuchsia-400/80 hover:bg-slate-750",
  },
  {
    value: "violet",
    label: "Violet",
    swatchClassName: "bg-violet-500",
    cardClassName: "bg-slate-800 border-2 border-violet-500/80 hover:bg-slate-750",
  },
  {
    value: "cyan",
    label: "Cyan",
    swatchClassName: "bg-cyan-500",
    cardClassName: "bg-slate-800 border-2 border-cyan-500/80 hover:bg-slate-750",
  },
  {
    value: "white",
    label: "Blanc",
    swatchClassName: "bg-white",
    cardClassName: "bg-slate-800 border-2 border-slate-200/90 hover:bg-slate-750",
  },
] as const

export type MenuButtonColorValue = (typeof MENU_BUTTON_COLORS)[number]["value"]

const COLOR_ALIASES: Record<string, MenuButtonColorValue> = {
  blanc: "white",
  blanche: "white",
  white: "white",
  rouge: "red",
  red: "red",
  rose: "rose",
}

export const normalizeMenuButtonColor = (value?: string | null): MenuButtonColorValue | null => {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  const match = MENU_BUTTON_COLORS.find((color) => color.value === normalized)
  if (match) return match.value
  return COLOR_ALIASES[normalized] ?? null
}

export const getMenuButtonColorClasses = (value?: string | null) => {
  const normalized = normalizeMenuButtonColor(value)
  if (!normalized) return ""
  const match = MENU_BUTTON_COLORS.find((color) => color.value === normalized)
  return match?.cardClassName || ""
}
