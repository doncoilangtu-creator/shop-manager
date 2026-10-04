/** Map stock_adjust() RPC errors to a user-facing Vietnamese message. */
export function stockErrorMessage(msg: string): string {
  if (msg.includes("insufficient_stock")) return "Tồn kho không đủ";
  if (msg.includes("product_not_found")) return "Không tìm thấy sản phẩm";
  if (msg.includes("qty_invalid")) return "Số lượng không hợp lệ";
  if (msg.includes("forbidden")) return "Không có quyền";
  return msg;
}

