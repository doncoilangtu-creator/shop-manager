export type QuotationStatus = "draft" | "sent" | "approved" | "rejected";
export const STATUS_LABEL: Record<string, string> = { draft: "Nháp", sent: "Đã gửi", approved: "Đã duyệt", rejected: "Từ chối" };
export const STATUS_VARIANT: Record<string, "secondary" | "outline" | "success" | "destructive" | "default"> = {
  draft: "outline", sent: "secondary", approved: "success", rejected: "destructive",
};
