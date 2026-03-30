export interface User {
  id: string
  name: string
  pin: string
  role: "server" | "manager"
  disabled?: boolean
  can_access_bill?: boolean
  created_at: string
}

export interface Applicant {
  id: string
  created_at: string
  first_name: string
  last_name: string
  email: string
  phone: string
  position: string
  start_date: string
  end_date: string
  notes: string
  cv_file_name: string
  cv_file_path: string  // Chemin dans Supabase Storage
  status: "NEW" | "REVIEWED" | "INTERVIEW_SCHEDULED" | "INTERVIEWED" | "ACCEPTED" | "REJECTED"
  ai_summary: string | null
  ai_score: number | null
}

export interface Table {
  id: string
  table_number: string // Changed to string to support T1, I1, C1 format
  seats: number
  position_x: number
  position_y: number
  status: "available" | "occupied" | "reserved"
  location: "T" | "I" | "C" | "H" | "O" | "B" // T=Terrace, I=Interior, C=Canapé, H=Table d'Hote, O=Olivier, B=Bar
  opened_by?: string // UUID du serveur qui a ouvert la table
  opened_by_name?: string // Nom du serveur qui a ouvert la table
  current_covers?: number | null // Nombre de couverts de la commande en cours
  has_to_follow?: boolean // True si la commande ouverte contient des plats en à suivre 1/2
  archived?: boolean
  created_at: string
}

export interface Reservation {
  id: string
  table_id: string
  table_ids?: string[]
  table_numbers?: string[]
  total_seats?: number
  customer_name: string
  customer_phone?: string
  reservation_date: string
  reservation_time: string
  party_size: number
  notes?: string
  status: "pending" | "confirmed" | "seated" | "cancelled" | "completed"
  duration_minutes?: number
  created_at: string
  created_by?: string
  whatsapp_confirmation_requested?: boolean
  whatsapp_confirmation_sent?: boolean
  whatsapp_review_requested?: boolean
  whatsapp_review_sent?: boolean
}

export interface MenuCategory {
  id: string
  name: string
  type: "food" | "drink"
  sort_order: number
  created_at: string
}

export interface Inventory {
  id: string
  menu_item_id: string
  quantity: number
  last_updated: string
  created_by?: string
  created_at: string
}

export interface MenuItem {
  id: string
  category_id: string
  name: string
  details?: string | null
  price: number
  type: "food" | "drink"
  tax_rate: number
  routing: "kitchen" | "bar"
  status?: boolean
  button_color?: string | null
  created_at: string
  out_of_stock?: boolean
  out_of_stock_date?: string
  category?: string
  stock_quantity?: number // Current stock level from inventory
  is_piatto_del_giorno?: boolean // Suggestion du chef / Menu du jour
}

export interface Order {
  id: string
  table_id: string
  server_id: string
  status: "open" | "closed"
  covers?: number | null
  created_at: string
  closed_at?: string
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string
  cart_item_id?: string // ← NOUVEAU
  quantity: number
  price: number
  status: "pending" | "to_follow_1" | "to_follow_2" | "fired" | "completed"
  course_number: number
  notes?: string
  is_complimentary: boolean
  complimentary_reason?: string
  created_by_server_id?: string // UUID du serveur qui a ajouté cet article
  created_at: string
  fired_at?: string
  printed_plan_at?: string | null
  printed_fired_at?: string | null
}

export interface Payment {
  id: string
  order_id: string
  amount: number
  tip_amount?: number
  payment_method: "cash" | "card" | "other"
  created_at: string
}

export interface PaymentItem {
  id: string
  payment_id: string
  order_item_id: string
  quantity: number
  amount: number
  created_at: string
}

export interface OrderItemWithPayments extends OrderItem {
  paid_quantity: number
  remaining_quantity: number
}

export interface KitchenTicket {
  id: string
  order_id: string
  table_number: string // Changed from number to string to match table_number format
  server_name?: string
  covers?: number | null
  type: "kitchen" | "bar"
  items: Array<{
    name: string
    quantity: number
    notes?: string
    phase?: "direct" | "to_follow_1" | "to_follow_2"
  }>
  status: "pending" | "completed"
  created_at: string
}

export interface PrintSettings {
  id: string
  setting_key: string
  setting_value: {
    enabled: boolean
    printer_name: string
    copies: number
  }
  updated_at: string
}

export interface SalesRecord {
  id: string
  order_id: string
  total_amount: number
  tax_amount: number
  sale_date: string
  created_at: string
}

export interface DailySales {
  date: string
  total_sales: number
  total_sales_ht: number
  total_tax: number
  order_count: number
  average_ticket: number
}

export interface DailySalesRecord {
  id: string
  date: string
  table_id: string
  table_number: string
  order_id: string
  server_id: string
  server_name: string
  total_amount: number
  complimentary_amount: number // Montant total des articles offerts
  complimentary_count: number  // Nombre d'articles offerts
  payment_method: string
  created_at: string
}

export interface Supplement {
  id: string
  order_id: string
  name: string
  amount: number
  tax_rate?: number
  notes?: string
  is_complimentary: boolean
  complimentary_reason?: string
  created_at: string
}

export interface Allergen {
  id: string
  name: string
  emoji: string
  sort_order: number
  created_at: string
}

export interface MenuItemAllergen {
  id: string
  menu_item_id: string
  allergen_id: string
  created_at: string
}

export interface PlanningFolder {
  id: string
  name: string
  date_start: string
  date_end: string
  status: "draft" | "validated"
  created_at: string
  updated_at: string
}

export interface PlanningMain {
  id: string
  folder_id: string
  title: string
  week_start: string
  week_end: string
  status: "draft" | "validated"
  created_at: string
  updated_at: string
}

export interface PlanningAssignment {
  id: string
  planning_id: string
  date: string
  service: "lunch" | "dinner"
  employee_id: string
  work_start: string | null
  work_end: string | null
  created_at: string
}
