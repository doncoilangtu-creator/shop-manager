/** Chọn hóa đơn gốc khi ghi HĐĐT thay thế / điều chỉnh (khớp kiểm tra trong RPC record_sale_einvoice, 0019). */
export type EinvMode = "original" | "replace" | "adjust";
export type EinvoiceOption = { id: string; kind: string; status: string; symbol: string | null; number: string; replaces_id?: string | null };

/** Hóa đơn gốc hợp lệ cho từng chế độ: điều chỉnh → bản còn hiệu lực; thay thế → bản còn hiệu lực, hoặc bản đã hủy chưa có thay thế (khi đơn không còn bản hiệu lực). */
export function einvoiceOriginalChoices(invoices: EinvoiceOption[], mode: EinvMode): EinvoiceOption[] {
  const main = invoices.filter((e) => e.kind === "original" || e.kind === "replace");
  if (mode === "adjust") return main.filter((e) => e.status === "issued");
  if (mode === "replace") {
    const hasActive = main.some((e) => e.status === "issued");
    const replacedIds = new Set(invoices.filter((e) => e.kind === "replace" && e.status !== "cancelled" && e.replaces_id).map((e) => e.replaces_id));
    return main.filter((e) => e.status === "issued" || (!hasActive && e.status === "cancelled" && !replacedIds.has(e.id)));
  }
  return [];
}
