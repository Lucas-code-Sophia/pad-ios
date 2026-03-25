import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const EXPORT_HEADERS = [
  "name",
  "price",
  "tax_rate",
  "category",
  "routing",
  "button_color",
  "status",
  "details",
  "out_of_stock",
  "is_piatto_del_giorno",
] as const

const escapeCsvCell = (value: unknown) => {
  const text = String(value ?? "")
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export async function GET() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("menu_items")
      .select(`
        name,
        details,
        price,
        tax_rate,
        routing,
        button_color,
        status,
        out_of_stock,
        is_piatto_del_giorno,
        menu_categories!menu_items_category_id_fkey (
          name
        )
      `)
      .order("name", { ascending: true })

    if (error) {
      console.error("[v0] Error exporting menu:", error)
      return NextResponse.json({ error: "Failed to fetch menu items" }, { status: 500 })
    }

    const rows = (data || []).map((item: any) => ({
      name: item.name || "",
      price: Number(item.price || 0),
      tax_rate: Number(item.tax_rate || 0),
      category: item.menu_categories?.name || "",
      routing: item.routing || "",
      button_color: item.button_color || "",
      status: item.status === false ? "false" : "true",
      details: item.details || "",
      out_of_stock: item.out_of_stock ? "true" : "false",
      is_piatto_del_giorno: item.is_piatto_del_giorno ? "true" : "false",
    }))

    const today = new Date().toISOString().split("T")[0]
    const csvRows: string[] = []
    csvRows.push(EXPORT_HEADERS.join(";"))

    for (const row of rows) {
      const line = EXPORT_HEADERS.map((key) => escapeCsvCell((row as Record<string, unknown>)[key])).join(";")
      csvRows.push(line)
    }

    // BOM UTF-8 pour ouvrir correctement dans Excel (accents)
    const csvContent = `\uFEFF${csvRows.join("\n")}`

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="menu_export_${today}.csv"`,
      },
    })
  } catch (error) {
    console.error("[v0] Error exporting menu:", error)
    return NextResponse.json({ error: "Failed to export menu" }, { status: 500 })
  }
}
