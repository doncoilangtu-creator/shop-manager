import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { BOOK_FONT } from "@/lib/books/pdf-fonts";
import { periodLabel, signDateText, vnDateText, type Period } from "@/lib/books/period";
import { S1A_FORM, s1aTotal, type BookHeader, type S1aRow } from "@/lib/books/s1a";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);

export const bookPdfStyles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 40, fontSize: 11, fontFamily: BOOK_FONT, lineHeight: 1.35 },
  top: { flexDirection: "row", justifyContent: "space-between" },
  topLeft: { width: "58%" },
  topRight: { width: "40%", textAlign: "center" },
  bold: { fontWeight: 700 },
  italic: { fontStyle: "italic" },
  title: { marginTop: 16, fontSize: 14, fontWeight: 700, textAlign: "center" },
  center: { textAlign: "center" },
  unit: { textAlign: "right", fontStyle: "italic", marginTop: 4, marginBottom: 4 },
  table: {},
  row: { flexDirection: "row", borderLeftWidth: 0.7, borderColor: "#000" },
  headRow: { borderTopWidth: 0.7 },
  cell: { borderRightWidth: 0.7, borderBottomWidth: 0.7, borderColor: "#000", paddingVertical: 3, paddingHorizontal: 4 },
  sign: { marginTop: 14, marginLeft: "45%", width: "55%", textAlign: "center" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, fontSize: 9, textAlign: "center", color: "#444" },
});
const S = bookPdfStyles;
const W = ["16%", "62%", "22%"];

export function S1aPdfDocument({ header: h, period: p, rows }: { header: BookHeader; period: Period; rows: S1aRow[] }) {
  return (
    <Document title={`${S1A_FORM.code} — ${periodLabel(p)}`} author={h.businessName} creator="Shop Manager">
      <Page size="A4" style={S.page} wrap>
        <View style={S.top}>
          <View style={S.topLeft}>
            <Text style={S.bold}>HỘ, CÁ NHÂN KINH DOANH: {h.businessName}</Text>
            <Text>Địa chỉ: {h.address || "………………"}</Text>
            <Text>Mã số thuế: {h.taxCode || "………………"}</Text>
          </View>
          <View style={S.topRight}>
            <Text style={S.bold}>{S1A_FORM.code}</Text>
            {S1A_FORM.basis.map((t) => <Text key={t} style={S.italic}>{t}</Text>)}
          </View>
        </View>
        <Text style={S.title}>{S1A_FORM.title}</Text>
        <Text style={S.center}>Địa điểm kinh doanh: {h.locationLabel}</Text>
        <Text style={S.center}>Kỳ kê khai: {periodLabel(p)}</Text>
        <Text style={S.unit}>Đơn vị tính: đồng</Text>
        <View style={S.table}>
          <View style={[S.row, S.headRow]} fixed>
            {["Ngày tháng", "Diễn giải", "Số tiền"].map((t, i) => <Text key={t} style={[S.cell, S.bold, S.center, { width: W[i] }]}>{t}</Text>)}
          </View>
          <View style={S.row}>
            {["A", "B", "1"].map((t, i) => <Text key={t} style={[S.cell, S.bold, S.center, { width: W[i] }]}>{t}</Text>)}
          </View>
          {rows.length === 0 && (
            <View style={S.row}><Text style={[S.cell, { width: W[0] }]} /><Text style={[S.cell, { width: W[1] }]}>Không phát sinh doanh thu trong kỳ</Text><Text style={[S.cell, { width: W[2], textAlign: "right" }]}>0</Text></View>
          )}
          {rows.map((r, i) => (
            <View key={i} style={S.row} wrap={false}>
              <Text style={[S.cell, S.center, { width: W[0] }]}>{vnDateText(r.line_date)}</Text>
              <Text style={[S.cell, { width: W[1] }]}>{r.description}</Text>
              <Text style={[S.cell, { width: W[2], textAlign: "right" }]}>{fmt(r.amount)}</Text>
            </View>
          ))}
          <View style={S.row} wrap={false}>
            <Text style={[S.cell, { width: W[0] }]} />
            <Text style={[S.cell, S.bold, S.center, { width: W[1] }]}>Tổng cộng</Text>
            <Text style={[S.cell, S.bold, { width: W[2], textAlign: "right" }]}>{fmt(s1aTotal(rows))}</Text>
          </View>
        </View>
        <View style={S.sign} wrap={false}>
          <Text style={S.italic}>{signDateText(h.createdOn)}</Text>
          <Text style={S.bold}>{S1A_FORM.signer[0]}</Text>
          <Text style={S.bold}>{S1A_FORM.signer[1]}</Text>
          <Text style={S.italic}>{S1A_FORM.signer[2]}</Text>
          <Text style={[S.bold, { marginTop: 48 }]}>{h.signer}</Text>
        </View>
        <Text style={S.footer} render={({ pageNumber, totalPages }) => `${S1A_FORM.code} · ${periodLabel(p)} · Trang ${pageNumber}/${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
