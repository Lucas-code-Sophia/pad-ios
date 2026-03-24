import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error: "Missing Supabase environment variables",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !supabaseUrl,
            SUPABASE_SERVICE_ROLE_KEY: !serviceRoleKey,
          },
        },
        { status: 500 }
      )
    }

    // Utiliser la clé service role pour bypasser RLS (temporaire pour debug)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    console.log("[DEBUG] Using service role key to bypass RLS")
    
    // Vérifier si la table existe
    const { data: tables, error: tablesError } = await supabaseAdmin
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'applicants')
    
    console.log("[DEBUG] Table exists:", tables)
    console.log("[DEBUG] Table error:", tablesError)
    
    // Compter les lignes
    const { count, error: countError } = await supabaseAdmin
      .from("applicants")
      .select("*", { count: 'exact', head: true })
    
    console.log("[DEBUG] Row count:", count)
    console.log("[DEBUG] Count error:", countError)
    
    // Récupérer toutes les données
    const { data, error } = await supabaseAdmin
      .from("applicants")
      .select("*")
      .order("created_at", { ascending: false })

    console.log("[DEBUG] All data:", data)
    console.log("[DEBUG] Data error:", error)

    if (error) {
      console.error("[DEBUG] Error:", error)
      return NextResponse.json({ 
        error: "Failed to fetch candidates", 
        details: error,
        tableExists: !!tables?.length,
        rowCount: count 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      data,
      tableExists: !!tables?.length,
      rowCount: count 
    })
  } catch (error) {
    console.error("[DEBUG] Exception:", error)
    return NextResponse.json({ 
      error: "Internal server error", 
      details: error 
    }, { status: 500 })
  }
}
