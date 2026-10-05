import { Document, Page, Text, View } from "@react-pdf/renderer";
import { signDateText } from "@/lib/books/period";
import { bookPdfStyles as S } from "@/lib/books/s1a-pdf";
import type { BookHeader } from "@/lib/books/s1a";
import { BK_STATUS_VI, TKN_INDICATORS, bkStkMissingVi, tknMap, tknPeriod, type BkStkRow, type TknPeriodKind, type TknRow } from "@/lib/books/tax-forms";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
const COMMIT = "Tôi cam đoan những nội dung kê khai trên là đúng và chịu trách nhiệm trước pháp luật về những nội dung đã khai./.";

function SignBlock({ h, left = "50%" }: { h: BookHeader; left?: string }) {
  return (
    <View style={[S.sign, { marginLeft: left, width: "50%" }]} wrap={false}>
      <Text style={S.italic}>{signDateText(h.createdOn)}</Text>
      <Text style={S.bold}>NGƯỜI NỘP THUẾ hoặc</Text>
      <Text style={S.bold}>ĐẠI DIỆN HỢP PHÁP CỦA NGƯỜI NỘP THUẾ</Text>
      <Text style={S.italic}>(Ký, ghi rõ họ tên/ Ký điện tử)</Text>
      <Text style={[S.bold, { marginTop: 44 }]}>{h.signer}</Text>
    </View>
  );
}

function NationalHeader({ code, basis }: { code: string; basis: string[] }) {
  return (
    <View style={S.top}>
      <View style={[S.topLeft, { textAlign: "center" }]}>
        <Text style={S.bold}>CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</Text>
        <Text style={S.bold}>Độc lập - Tự do - Hạnh phúc</Text>
      </View>
      <View style={S.topRight}>
        <Text style={S.bold}>{code}</Text>
        {basis.map((t) => <Text key={t} style={S.italic}>{t}</Text>)}
      </View>
    </View>
  );
}

const TW = ["62%", "13%", "25%"];
export function TknPdfDocument({ header: h, year, kind, rows }: { header: BookHeader; year: number; kind: TknPeriodKind; rows: TknRow[] }) {
  const m = tknMap(rows);
  const { label } = tknPeriod(year, kind);
  return (
    <Document title={`01/TKN-CNKD — ${label}`} author={h.businessName} creator="Shop Manager">
      <Page size="A4" style={[S.page, { fontSize: 10.5 }]} wrap>
        <NationalHeader code="Mẫu số: 01/TKN-CNKD" basis={["(Kèm theo Thông tư số 50/2026/TT-BTC", "ngày 13/5/2026 của Bộ trưởng Bộ Tài chính)"]} />
        <Text style={S.title}>THÔNG BÁO DOANH THU/TỜ KHAI THUẾ NĂM</Text>
        <Text style={[S.center, S.italic]}>(Áp dụng đối với hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống)</Text>
        <Text style={{ marginTop: 6 }}>☑ Hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống</Text>
        <Text style={{ marginTop: 4 }}>[01] Kỳ tính thuế: {label}</Text>
        <Text>[02] Lần đầu: ☑      [03] Bổ sung lần thứ: ……</Text>
        <Text>[04] Người nộp thuế: {h.businessName}</Text>
        <Text>[05] Mã số thuế: {h.taxCode || "………………"}</Text>
        <Text>[06] Tổ chức/cá nhân kê khai, nộp thuế thay theo ủy quyền (nếu có): ………………</Text>
        <Text>[07] Tên đại lý thuế (nếu có): ………………</Text>
        <View style={[S.top, { marginTop: 8 }]}>
          <Text style={S.bold}>A. XÁC ĐỊNH NGHĨA VỤ THUẾ GTGT, TNCN</Text>
          <Text style={S.italic}>Đơn vị tiền: Đồng Việt Nam</Text>
        </View>
        <Text style={[S.italic, { fontSize: 9, marginBottom: 4 }]}>HKD có doanh thu năm từ 01 tỷ đồng trở xuống chỉ thông báo doanh thu; không khai số thuế GTGT, TNCN phải nộp.</Text>
        <View>
          <View style={[S.row, S.headRow]} fixed>
            {["Chỉ tiêu", "Mã chỉ tiêu", "Tổng doanh thu (1)"].map((t, i) => <Text key={t} style={[S.cell, S.bold, S.center, { width: TW[i] }]}>{t}</Text>)}
          </View>
          {TKN_INDICATORS.map((ind) => {
            const strong = !ind.indent;
            return (
              <View key={ind.code} style={S.row} wrap={false}>
                <Text style={[S.cell, strong ? S.bold : {}, { width: TW[0], paddingLeft: ind.indent ? 14 : 4 }]}>{ind.label.replace(/^\[\w+\]\s*/, "")}</Text>
                <Text style={[S.cell, S.center, { width: TW[1] }]}>[{ind.code}]</Text>
                <Text style={[S.cell, strong ? S.bold : {}, { width: TW[2], textAlign: "right" }]}>{fmt(m.get(ind.code) ?? 0)}</Text>
              </View>
            );
          })}
        </View>
        <Text style={[S.italic, { marginTop: 10 }]}>{COMMIT}</Text>
        <SignBlock h={h} />
        <Text style={S.footer} render={({ pageNumber, totalPages }) => `01/TKN-CNKD · ${label} · Trang ${pageNumber}/${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

const BW = ["6%", "16%", "10%", "17%", "16%", "21%", "14%"];
export function BkStkPdfDocument({ header: h, rows }: { header: BookHeader; rows: BkStkRow[] }) {
  return (
    <Document title="01/BK-STK — Bảng kê tài khoản" author={h.businessName} creator="Shop Manager">
      <Page size="A4" orientation="landscape" style={[S.page, { fontSize: 10 }]} wrap>
        <NationalHeader code="Mẫu số: 01/BK-STK" basis={["(Kèm theo Thông tư số 18/2026/TT-BTC)"]} />
        <Text style={S.title}>BẢNG KÊ TÀI KHOẢN</Text>
        <Text style={{ marginTop: 6 }}>[01] Người nộp thuế: {h.businessName}</Text>
        <Text style={{ marginBottom: 6 }}>[02] Mã số thuế: {h.taxCode || "………………"}</Text>
        <View>
          <View style={[S.row, S.headRow]} fixed>
            {["[03] STT", "[04] Tên địa điểm kinh doanh", "[05] Mã địa điểm KD", "[06] Số tài khoản ngân hàng / Số hiệu ví điện tử", "[07] Tên chủ tài khoản", "[08] Mở tại tổ chức cung ứng dịch vụ thanh toán / trung gian thanh toán", "[09] Trạng thái"]
              .map((t, i) => <Text key={t} style={[S.cell, S.bold, S.center, { width: BW[i] }]}>{t}</Text>)}
          </View>
          {rows.length === 0 && <View style={S.row}><Text style={[S.cell, { width: "100%" }]}>Không có tài khoản cần kê khai</Text></View>}
          {rows.map((r, i) => (
            <View key={r.account_id} style={S.row} wrap={false}>
              <Text style={[S.cell, S.center, { width: BW[0] }]}>{i + 1}</Text>
              <Text style={[S.cell, { width: BW[1] }]}>{r.location_name ?? ""}</Text>
              <Text style={[S.cell, S.center, { width: BW[2] }]}>{r.location_code ?? ""}</Text>
              <Text style={[S.cell, { width: BW[3] }]}>{r.account_no ?? "(thiếu số tài khoản)"}</Text>
              <Text style={[S.cell, { width: BW[4] }]}>{r.holder ?? ""}</Text>
              <Text style={[S.cell, { width: BW[5] }]}>{r.provider ?? ""}</Text>
              <Text style={[S.cell, S.center, { width: BW[6] }]}>{BK_STATUS_VI[r.status] ?? r.status}</Text>
            </View>
          ))}
        </View>
        {rows.some((r) => r.missing.length) && (
          <Text style={[S.italic, { fontSize: 9, marginTop: 4 }]}>
            Còn thiếu: {rows.filter((r) => r.missing.length).map((r) => `${r.label} (${bkStkMissingVi(r.missing)})`).join("; ")}
          </Text>
        )}
        <Text style={[S.italic, { marginTop: 10 }]}>{COMMIT}</Text>
        <SignBlock h={h} left="55%" />
        <Text style={S.footer} render={({ pageNumber, totalPages }) => `01/BK-STK · Trang ${pageNumber}/${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
