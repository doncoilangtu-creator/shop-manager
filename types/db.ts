// Convenience TypeScript types mirroring the database schema.
// These match the columns in supabase/migrations/0001_init.sql.
// For auto-generated types, run `supabase gen types typescript` later.

export type UUID = string;
export type ISODate = string;

export interface Category {
  id: UUID;
  name: string;
  slug: string;
  created_at: ISODate;
}

export interface Product {
  id: UUID;
  sku: string;
  name: string;
  category_id: UUID | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  unit: string;
  cost_price: number;
  sell_price: number;
  stock_qty: number;
  min_stock: number;
  location: string | null;
  warranty_months: number;
  image_urls: string[];
  created_at: ISODate;
  updated_at: ISODate;
}

export type CustomerType = "retail" | "business";

export interface Customer {
  id: UUID;
  type: CustomerType;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_code: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  debt_limit: number;
  notes: string | null;
  tags: string[];
  created_at: ISODate;
  updated_at: ISODate;
}

export interface Supplier {
  id: UUID;
  name: string;
  tax_code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contact_person: string | null;
  bank_account: string | null;
  notes: string | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface SupplierDebt {
  id: UUID;
  supplier_id: UUID;
  amount: number;
  due_date: string | null;
  paid: boolean;
  paid_at: ISODate | null;
  notes: string | null;
  created_at: ISODate;
}

export interface CustomerDebt {
  id: UUID;
  customer_id: UUID;
  amount: number;
  due_date: string | null;
  paid: boolean;
  paid_at: ISODate | null;
  notes: string | null;
  created_at: ISODate;
}

export type QuotationStatus = "draft" | "sent" | "approved" | "rejected";

export interface Quotation {
  id: UUID;
  code: string;
  customer_id: UUID | null;
  status: QuotationStatus;
  valid_until: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  pdf_url: string | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface QuotationItem {
  id: UUID;
  quotation_id: UUID;
  product_id: UUID | null;
  qty: number;
  unit_price: number;
  discount: number;
  line_total: number;
  notes: string | null;
}

export type StockMovementType = "in" | "out" | "adjust";

export interface StockMovement {
  id: UUID;
  product_id: UUID;
  type: StockMovementType;
  qty: number;
  unit_cost: number | null;
  ref_type: string | null;
  ref_id: UUID | null;
  notes: string | null;
  created_by: UUID | null;
  created_at: ISODate;
}

export type ContractStatus = "active" | "expired" | "cancelled";

export interface MaintenanceContract {
  id: UUID;
  customer_id: UUID;
  code: string;
  start_date: string;
  end_date: string;
  scope: string | null;
  devices_description: string | null;
  monthly_fee: number;
  sla_hours: number;
  signed_pdf_url: string | null;
  status: ContractStatus;
  created_at: ISODate;
  updated_at: ISODate;
}

export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus =
  | "received"
  | "assigned"
  | "in_progress"
  | "waiting_parts"
  | "completed"
  | "awaiting_signature"
  | "signed"
  | "closed";

export interface MaintenanceTicket {
  id: UUID;
  code: string;
  contract_id: UUID | null;
  customer_id: UUID;
  title: string;
  description: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: UUID | null;
  device_info: string | null;
  started_at: ISODate | null;
  completed_at: ISODate | null;
  sla_due_at: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export type MaintenanceLogType = "periodic" | "incident" | "note";

export interface MaintenanceLog {
  id: UUID;
  ticket_id: UUID;
  log_type: MaintenanceLogType;
  description: string | null;
  work_done: string | null;
  parts_used: string[];
  performed_by: UUID | null;
  performed_at: ISODate;
}

export type SignerRole = "customer" | "technician";

export interface Signature {
  id: UUID;
  ticket_id: UUID;
  signer_name: string;
  signer_role: SignerRole;
  signature_png: string;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: ISODate;
}

export interface SignatureToken {
  id: UUID;
  ticket_id: UUID;
  token: string;
  expires_at: ISODate;
  used_at: ISODate | null;
  created_at: ISODate;
}

export type BotRole = "owner" | "customer";

export interface BotUser {
  id: UUID;
  telegram_chat_id: string;
  role: BotRole;
  customer_id: UUID | null;
  name: string | null;
  active: boolean;
}

export interface Notification {
  id: UUID;
  type: string;
  payload: Record<string, unknown>;
  read_at: ISODate | null;
  created_at: ISODate;
}
