/** Map accounting RPC error codes (RAISE EXCEPTION 'code') to Vietnamese user messages. */
const MESSAGES: Array<[string, string]> = [
  ["period_closed", "Kỳ kế toán của ngày này đã khóa. Hãy chọn ngày trong kỳ đang mở hoặc nhờ chủ cửa hàng mở lại kỳ."],
  ["period_not_found", "Chưa có kỳ kế toán cho ngày này."],
  ["insufficient_stock_to_void", "Không thể hủy: hàng của phiếu nhập này đã bán/xuất, tồn không đủ để hoàn lại."],
  ["insufficient_stock", "Tồn kho không đủ."],
  ["debt_limit_exceeded", "Vượt hạn mức công nợ của khách hàng."],
  ["allocation_exceeds_outstanding", "Số tiền phân bổ lớn hơn số còn nợ của chứng từ."],
  ["allocation_exceeds_payment", "Tổng phân bổ lớn hơn số tiền của phiếu."],
  ["invoice_not_found_for_customer", "Hóa đơn không thuộc khách hàng này."],
  ["bill_not_found_for_supplier", "Phiếu nhập không thuộc nhà cung cấp này."],
  ["invoice_has_allocations", "Hóa đơn đã có thu tiền. Hãy hủy phiếu thu trước."],
  ["bill_has_allocations", "Phiếu nhập đã có chi tiền. Hãy hủy phiếu chi trước."],
  ["already_voided", "Chứng từ đã được hủy trước đó."],
  ["already_reversed", "Bút toán đã được đảo trước đó."],
  ["amount_invalid", "Số tiền phải lớn hơn 0."],
  ["method_invalid", "Phương thức thanh toán không hợp lệ."],
  ["total_must_be_positive", "Tổng tiền phải lớn hơn 0."],
  ["lines_required", "Cần ít nhất một dòng."],
  ["customer_not_found", "Không tìm thấy khách hàng."],
  ["supplier_not_found", "Không tìm thấy nhà cung cấp."],
  ["product_not_found", "Không tìm thấy sản phẩm."],
  ["reason_required", "Cần nhập lý do."],
  ["earlier_period_open", "Phải khóa các kỳ trước theo thứ tự."],
  ["period_unbalanced", "Kỳ không cân (Nợ ≠ Có), không thể khóa."],
  ["already_closed", "Kỳ này đã được khóa."],
  ["later_period_closed", "Chỉ được mở lại kỳ khóa gần nhất."],
  ["not_closed", "Kỳ này chưa khóa."],
  ["forbidden", "Bạn không có quyền thực hiện thao tác này."],
];

export function accountingErrorMessage(raw: string | null | undefined): string {
  const msg = raw ?? "";
  for (const [code, text] of MESSAGES) if (msg.includes(code)) return text;
  if (/permission denied/i.test(msg)) return "Bạn không có quyền thực hiện thao tác này.";
  return msg || "Có lỗi xảy ra";
}
