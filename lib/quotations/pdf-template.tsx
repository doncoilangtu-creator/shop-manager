import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { formatVND, formatDate } from "@/lib/utils";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 80,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1f2937",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: "#1e40af",
    borderBottomStyle: "solid",
  },
  brand: { flexDirection: "row", alignItems: "center", maxWidth: "60%" },
  logoBox: {
    width: 44,
    height: 44,
    backgroundColor: "#1e40af",
    color: "#ffffff",
    borderRadius: 6,
    fontSize: 22,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 9,
    marginRight: 10,
  },
  brandName: { fontSize: 14, fontWeight: 700, color: "#1e3a8a" },
  brandInfo: { fontSize: 9, color: "#4b5563", marginTop: 2 },
  brandInfoBold: { fontWeight: 700, color: "#1f2937" },
  docMeta: { textAlign: "right", minWidth: 170 },
  docTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#1e3a8a",
    letterSpacing: 2,
  },
  docCode: { fontSize: 10, marginTop: 4, color: "#374151" },
  docDate: { fontSize: 10, color: "#6b7280" },

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#1e3a8a",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    borderBottomStyle: "solid",
  },

  // Customer card
  customerCard: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderStyle: "solid",
    borderRadius: 4,
    padding: 10,
  },
  customerRow: { flexDirection: "row", marginBottom: 2 },
  customerLabel: { width: 90, color: "#6b7280" },
  customerValue: { flex: 1, color: "#1f2937" },

  // Items table
  table: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderStyle: "solid",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#1e3a8a",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 10,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    borderBottomStyle: "solid",
  },
  tableRowAlt: { backgroundColor: "#f9fafb" },
  th: { padding: 6, color: "#ffffff" },
  td: { padding: 6 },
  colStt: { width: "6%" },
  colName: { width: "38%" },
  colQty: { width: "10%", textAlign: "right" },
  colPrice: { width: "16%", textAlign: "right" },
  colDiscount: { width: "10%", textAlign: "right" },
  colTotal: { width: "20%", textAlign: "right" },

  // Totals
  totalsBlock: {
    marginTop: 12,
    alignSelf: "flex-end",
    width: "50%",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 4,
    backgroundColor: "#1e3a8a",
    color: "#ffffff",
    borderRadius: 4,
  },
  totalsLabel: { color: "#374151" },
  totalsValue: { color: "#1f2937", fontWeight: 700 },
  totalsLabelFinal: { color: "#ffffff", fontWeight: 700, fontSize: 11 },
  totalsValueFinal: { color: "#ffffff", fontWeight: 700, fontSize: 12 },

  // Terms
  terms: {
    marginTop: 18,
    padding: 10,
    backgroundColor: "#fef3c7",
    borderRadius: 4,
    fontSize: 9,
    color: "#78350f",
  },
  termsTitle: { fontWeight: 700, marginBottom: 4 },

  // Notes
  notes: { marginTop: 14, fontSize: 10, color: "#374151" },
  notesTitle: { fontWeight: 700, marginBottom: 4, color: "#1f2937" },

  // Signatures
  signatures: {
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigBlock: { width: "45%", textAlign: "center" },
  sigLabel: { fontWeight: 700, marginBottom: 4, color: "#1e3a8a" },
  sigHint: { fontSize: 9, color: "#6b7280", marginBottom: 50 },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: "#9ca3af",
    borderTopStyle: "solid",
    paddingTop: 4,
    fontSize: 9,
    color: "#6b7280",
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    borderTopStyle: "solid",
    paddingTop: 8,
  },
});

const STATUS_LABEL: Record<string, string> = {
  draft: "NHÁP",
  sent: "ĐÃ GỬI",
  approved: "ĐÃ DUYỆT",
  rejected: "TỪ CHỐI",
};

export interface PdfQuotationItem {
  name: string;
  sku?: string | null;
  unit?: string | null;
  qty: number;
  unit_price: number;
  discount: number; // %
  line_total: number;
  notes?: string | null;
}

export interface PdfQuotationProps {
  shop: {
    name: string;
    taxCode?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  quotation: {
    code: string;
    createdAt: string;
    validUntil?: string | null;
    status: keyof typeof STATUS_LABEL;
    notes?: string | null;
    subtotal: number;
    discount: number;
    vat: number;
    total: number;
  };
  customer: {
    name: string;
    type?: "retail" | "business";
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    taxCode?: string | null;
    contactPerson?: string | null;
  } | null;
  items: PdfQuotationItem[];
}

export function QuotationPdfDocument(props: PdfQuotationProps) {
  const { shop, quotation, customer, items } = props;
  const statusLabel = STATUS_LABEL[quotation.status] || quotation.status;
  const today = formatDate(quotation.createdAt);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : "";

  return (
    <Document
      title={`Bao gia ${quotation.code}`}
      author={shop.name}
      subject={`Báo giá ${quotation.code}`}
    >
      <Page size="A4" style={styles.page} wrap>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <Text style={styles.logoBox}>S</Text>
            <View>
              <Text style={styles.brandName}>{shop.name}</Text>
              {shop.taxCode ? (
                <Text style={styles.brandInfo}>
                  <Text style={styles.brandInfoBold}>MST: </Text>
                  {shop.taxCode}
                </Text>
              ) : null}
              {shop.address ? (
                <Text style={styles.brandInfo}>{shop.address}</Text>
              ) : null}
              {shop.phone ? (
                <Text style={styles.brandInfo}>
                  ĐT: {shop.phone}
                  {shop.email ? `  •  ${shop.email}` : ""}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>BÁO GIÁ</Text>
            <Text style={styles.docCode}>Số: {quotation.code}</Text>
            <Text style={styles.docDate}>Ngày: {today}</Text>
            <Text style={styles.docDate}>
              Hiệu lực đến: {validUntil || "-"}
            </Text>
            <Text
              style={[
                styles.docDate,
                { color: "#1e3a8a", fontWeight: 700, marginTop: 2 },
              ]}
            >
              Trạng thái: {statusLabel}
            </Text>
          </View>
        </View>

        {/* CUSTOMER */}
        <Text style={styles.sectionTitle}>Thông tin khách hàng</Text>
        <View style={styles.customerCard}>
          {customer ? (
            <>
              <View style={styles.customerRow}>
                <Text style={styles.customerLabel}>Khách hàng:</Text>
                <Text style={styles.customerValue}>
                  {customer.name}
                  {customer.type === "business" ? " (Doanh nghiệp)" : " (Lẻ)"}
                </Text>
              </View>
              {customer.taxCode ? (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>MST:</Text>
                  <Text style={styles.customerValue}>{customer.taxCode}</Text>
                </View>
              ) : null}
              {customer.contactPerson ? (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>Người liên hệ:</Text>
                  <Text style={styles.customerValue}>{customer.contactPerson}</Text>
                </View>
              ) : null}
              {customer.phone ? (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>Điện thoại:</Text>
                  <Text style={styles.customerValue}>{customer.phone}</Text>
                </View>
              ) : null}
              {customer.email ? (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>Email:</Text>
                  <Text style={styles.customerValue}>{customer.email}</Text>
                </View>
              ) : null}
              {customer.address ? (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>Địa chỉ:</Text>
                  <Text style={styles.customerValue}>{customer.address}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={{ color: "#9ca3af" }}>Khách lẻ — chưa chọn khách</Text>
          )}
        </View>

        {/* ITEMS */}
        <Text style={styles.sectionTitle}>Danh sách sản phẩm</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colStt]}>STT</Text>
            <Text style={[styles.th, styles.colName]}>Sản phẩm</Text>
            <Text style={[styles.th, styles.colQty]}>SL</Text>
            <Text style={[styles.th, styles.colPrice]}>Đơn giá</Text>
            <Text style={[styles.th, styles.colDiscount]}>CK %</Text>
            <Text style={[styles.th, styles.colTotal]}>Thành tiền</Text>
          </View>
          {items.map((it, idx) => (
            <View
              key={`row-${idx}`}
              style={[styles.tableRow, idx % 2 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              <Text style={[styles.td, styles.colStt]}>{idx + 1}</Text>
              <View style={[styles.td, styles.colName]}>
                <Text>{it.name}</Text>
                {it.sku ? (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>
                    SKU: {it.sku}
                    {it.notes ? ` • ${it.notes}` : ""}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.td, styles.colQty]}>
                {it.qty}
                {it.unit ? ` ${it.unit}` : ""}
              </Text>
              <Text style={[styles.td, styles.colPrice]}>{formatVND(it.unit_price)}</Text>
              <Text style={[styles.td, styles.colDiscount]}>
                {it.discount ? `${it.discount}%` : "-"}
              </Text>
              <Text style={[styles.td, styles.colTotal]}>
                {formatVND(it.line_total)}
              </Text>
            </View>
          ))}
        </View>

        {/* TOTALS */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Tạm tính:</Text>
            <Text style={styles.totalsValue}>{formatVND(quotation.subtotal)}</Text>
          </View>
          {quotation.discount > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Chiết khấu:</Text>
              <Text style={styles.totalsValue}>
                -{formatVND(quotation.discount)}
              </Text>
            </View>
          ) : null}
          {quotation.vat > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>VAT:</Text>
              <Text style={styles.totalsValue}>{formatVND(quotation.vat)}</Text>
            </View>
          ) : null}
          <View style={styles.totalsRowFinal}>
            <Text style={styles.totalsLabelFinal}>{quotation.vat > 0 ? "TỔNG CỘNG:" : "TỔNG CỘNG (đã gồm thuế):"}</Text>
            <Text style={styles.totalsValueFinal}>
              {formatVND(quotation.total)}
            </Text>
          </View>
        </View>

        {/* TERMS */}
        <View style={styles.terms} wrap={false}>
          <Text style={styles.termsTitle}>Điều khoản</Text>
          <Text>
            • Báo giá có hiệu lực đến{" "}
            <Text style={{ fontWeight: 700 }}>
              {validUntil || "—"}
            </Text>
            . Sau thời hạn trên, giá và điều kiện có thể thay đổi.
          </Text>
          <Text>
            • Thanh toán: 100% khi nhận hàng hoặc theo thỏa thuận riêng với khách
            doanh nghiệp có hợp đồng.
          </Text>
          <Text>
            • Bảo hành: theo chính sách của nhà sản xuất hoặc ghi trên phiếu bảo hành
            đi kèm sản phẩm.
          </Text>
          <Text>
            • Giá trên chưa bao gồm phí vận chuyển và lắp đặt (nếu có).
          </Text>
        </View>

        {/* NOTES */}
        {quotation.notes ? (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesTitle}>Ghi chú</Text>
            <Text>{quotation.notes}</Text>
          </View>
        ) : null}

        {/* SIGNATURES */}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>ĐẠI DIỆN BÊN BÁN</Text>
            <Text style={styles.sigHint}>(Ký, ghi rõ họ tên)</Text>
            <Text style={styles.sigLine}>{shop.name}</Text>
          </View>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>ĐẠI DIỆN BÊN MUA</Text>
            <Text style={styles.sigHint}>(Ký, ghi rõ họ tên)</Text>
            <Text style={styles.sigLine}>
              {customer?.name || "Khách hàng"}
            </Text>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${shop.name}  •  Báo giá ${quotation.code}  •  Trang ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
