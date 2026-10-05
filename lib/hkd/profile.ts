import { z } from "zod";

export const TAX_METHODS = [
  { value: "exempt_notice", label: "Doanh thu dưới ngưỡng — chỉ thông báo doanh thu, không nộp GTGT/TNCN" },
  { value: "revenue_pct", label: "Nộp thuế theo tỷ lệ % trên doanh thu" },
  { value: "profit", label: "Nộp thuế TNCN theo thu nhập (doanh thu − chi phí)" },
] as const;

export type TaxMethod = (typeof TAX_METHODS)[number]["value"];

export const LOCATION_STATUSES = [
  { value: "active", label: "Đang hoạt động" },
  { value: "suspended", label: "Tạm ngừng" },
  { value: "closed", label: "Đã đóng" },
] as const;

export type TaxGroup = { code: string; name_vi: string };

export type BusinessProfile = {
  business_name: string;
  owner_name: string | null;
  tax_code: string | null;
  citizen_id?: string | null;
  residence_address: string | null;
  phone: string | null;
  email: string | null;
  industries: string | null;
  main_tax_group: string | null;
  tax_method: TaxMethod;
  start_date: string | null;
  ledger_signer: string | null;
  updated_at?: string;
};

export type BusinessProfileState = { exists: boolean; is_owner: boolean; profile: BusinessProfile | null };

export type BusinessLocation = {
  id: string;
  name: string;
  address: string;
  main_tax_group: string | null;
  is_hq: boolean;
  status: "active" | "suspended" | "closed";
  opened_on: string | null;
  closed_on: string | null;
  tax_location_code: string | null;
  notes: string | null;
};

export function parseProfileState(raw: unknown): BusinessProfileState {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    exists: o.exists === true,
    is_owner: o.is_owner === true,
    profile: o.profile && typeof o.profile === "object" ? (o.profile as BusinessProfile) : null,
  };
}

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ")
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const profileSchema = z.object({
  business_name: z.string().trim().min(1, "Nhập tên hộ kinh doanh").max(255),
  owner_name: optText(255),
  tax_code: z
    .string()
    .trim()
    .regex(/^([0-9]{10}(-[0-9]{3})?|[0-9]{12})$/, "Mã số thuế gồm 10 số (hoặc 13 số dạng 10-3) hoặc số định danh 12 số")
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  citizen_id: z
    .string()
    .trim()
    .regex(/^([0-9]{9}|[0-9]{12})$/, "CCCD gồm 12 số (CMND cũ 9 số)")
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  residence_address: optText(500),
  phone: optText(40),
  email: z
    .string()
    .trim()
    .max(255)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email không hợp lệ")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  industries: optText(1000),
  main_tax_group: optText(40),
  tax_method: z.enum(["exempt_notice", "revenue_pct", "profit"]).default("exempt_notice"),
  start_date: optDate,
  ledger_signer: optText(255),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const locationSchema = z
  .object({
    id: z.string().uuid().optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
    name: z.string().trim().min(1, "Nhập tên địa điểm").max(255),
    address: z.string().trim().min(1, "Nhập địa chỉ địa điểm").max(500),
    main_tax_group: optText(40),
    is_hq: z.coerce.boolean().default(false),
    status: z.enum(["active", "suspended", "closed"]).default("active"),
    opened_on: optDate,
    closed_on: optDate,
    tax_location_code: optText(60),
    notes: optText(1000),
  })
  .refine((v) => !v.opened_on || !v.closed_on || v.closed_on >= v.opened_on, {
    message: "Ngày đóng phải sau ngày mở",
    path: ["closed_on"],
  });

export type LocationInput = z.infer<typeof locationSchema>;

/** Checkbox values from FormData ("on" / "true" / "1") -> boolean; absent -> false. */
export function formBool(v: unknown): boolean {
  return v === true || v === "on" || v === "true" || v === "1";
}
