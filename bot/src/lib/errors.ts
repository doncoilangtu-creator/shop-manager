const MESSAGES: Array<[string, string]> = [
  ["period_closed", "Kỳ kế toán của ngày này đã khóa."],
  ["insufficient_stock", "Tồn kho không đủ."],
  ["debt_limit_exceeded", "Vượt hạn mức công nợ của khách."],
  ["customer_not_found", "Không tìm thấy khách hàng."],
  ["product_not_found", "Không tìm thấy sản phẩm."],
  ["walkin_must_pay_in_full", "Khách lẻ phải thanh toán đủ."],
  ["total_must_be_positive", "Tổng tiền phải lớn hơn 0."],
  ["qty_invalid", "Số lượng không hợp lệ."],
  ["forbidden", "Bot không có quyền (kiểm tra SUPABASE_SERVICE_ROLE_KEY)."],
];

/** Map DB error codes to a short Vietnamese message; unknown errors are NOT echoed back to the chat (logged instead). */
export function dbErrorMessage(raw: string | null | undefined): string {
  const msg = raw ?? "";
  for (const [code, text] of MESSAGES) if (msg.includes(code)) return text;
  console.error("db error:", msg);
  return "Có lỗi hệ thống, vui lòng thử lại sau.";
}
