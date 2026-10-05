# Hộ kinh doanh (HKD) — cách app xử lý, căn cứ và quyết định cần chủ xác nhận

Tài liệu sống, cập nhật theo từng cụm refactor A1–A4 (kế hoạch gốc: `misa-hkd-gap-plan.md`, kịch bản A = hộ kinh doanh
doanh thu **dưới 1 tỷ đồng/năm**, sổ **S1a-HKD** theo TT152/2025, giá bán **đã gồm VAT**, hóa đơn bán hàng **không tách VAT**).

> Đây không phải tư vấn pháp lý/thuế. Ngưỡng, tỷ lệ, mẫu biểu đã đổi nhiều lần trong 2025–2026, nên mọi con số pháp lý nằm trong bảng
> cấu hình có **ngày hiệu lực** (`legal_thresholds`, `tax_rates`), không hard-code trong code. Mỗi dòng ghi nguồn văn bản.

## A1 — Hồ sơ hộ kinh doanh & theo dõi ngưỡng doanh thu (migration `0012_hkd_profile_tax.sql`)

### Dữ liệu
| Bảng | Nội dung | Ai đọc | Ai ghi |
|---|---|---|---|
| `business_profile` (1 dòng) | tên HKD, chủ hộ, MST/số định danh, **CCCD**, địa chỉ, SĐT, email, ngành nghề, nhóm ngành chính, phương pháp thuế, ngày bắt đầu, người ký sổ | bảng: chỉ **owner**; staff/bot đọc qua `get_business_profile()` (không có CCCD) | RPC `set_business_profile` — **chỉ owner** |
| `business_locations` | địa điểm kinh doanh: tên, địa chỉ, nhóm ngành, trụ sở (tối đa 1 đang hoạt động), trạng thái (hoạt động / tạm ngừng / đóng), ngày mở–đóng, mã địa điểm thuế | staff | RPC `upsert_business_location` — chỉ owner |
| `tax_groups`, `tax_rates` | 4 nhóm ngành thuế (hàng hóa 1%/0,5%, dịch vụ 5%/2%, sản xuất–vận tải–dịch vụ gắn hàng hóa 3%/1,5%, khác 2%/1%) theo ngày hiệu lực | staff | migration |
| `legal_thresholds` | `exempt_revenue` = 1 tỷ (ND68/2026 sửa bởi ND141/2026, hiệu lực 01/01/2026), 3 tỷ, 50 tỷ, 50.000đ, 5 triệu, `revenue_warn_pct` = 80 | staff | RPC `set_legal_threshold` — chỉ owner (có nhật ký) |

Mọi bảng mới bật RLS, `anon` không có quyền, `authenticated` chỉ `select` (không DML trực tiếp). Mọi hàm `SECURITY DEFINER` có
`search_path` cố định; policy dùng `(select ...)`. Thay đổi hồ sơ/địa điểm/ngưỡng được ghi vào `accounting_audit` (không ghi số CCCD).

### Doanh thu năm & cảnh báo ngưỡng
* **Doanh thu tính thuế = tổng tiền ghi trên hóa đơn bán hàng (đã gồm thuế)**, không tính hóa đơn đã hủy (`v_revenue_events`; từ A2 trừ thêm hàng bán trả lại). Tính trên mọi địa điểm, mọi kênh.
* `revenue_ytd(năm)`, `revenue_by_month(năm)` (12 tháng + lũy kế), `threshold_status(năm)` → `level`:
  `ok` (< 80 %) · `warning` (≥ 80 %) · `exceeded` (≥ 100 % ngưỡng) · `none` (năm chưa có ngưỡng cấu hình).
* UI: banner trên mọi trang khi `warning`/`exceeded`; trang **Báo cáo → Doanh thu năm & ngưỡng 1 tỷ** (`/reports/revenue`); thẻ tiến độ trong **Cài đặt**.
* Khi vượt ngưỡng giữa năm (kế hoạch mục 1.2 #3): đăng ký HĐĐT có mã/từ máy tính tiền trong 30 ngày, chuyển kê khai theo quý, ghi S2a — app chỉ **cảnh báo**, chưa tự chuyển chế độ.

### Cài đặt (UI)
`/settings` (có trong menu): form **Hồ sơ hộ kinh doanh** (Việt hóa, owner mới sửa được; staff xem, không thấy CCCD), danh sách **Địa điểm kinh doanh**.
Báo giá PDF lấy tên/MST/địa chỉ/SĐT/email từ hồ sơ; biến môi trường `SHOP_*` chỉ còn là **dự phòng** khi chưa có hồ sơ.

### Quyết định cần chủ xác nhận (A1)
1. **Cảnh báo ở ≥ 100 % (không phải > 100 %)**: luật chỉ coi là vượt khi doanh thu *lớn hơn* 1 tỷ; app báo sớm ngay khi chạm 100 % (thận trọng). Ngưỡng cảnh báo 80 % đổi được bằng `revenue_warn_pct`.
2. **Phương pháp thuế mặc định = “chỉ thông báo doanh thu” (`exempt_notice`)** cho doanh thu < 1 tỷ; `revenue_pct`/`profit` chỉ để ghi nhận khi chuyển kịch bản B/C — chưa có engine tính thuế.
3. **CCCD**: lưu dạng văn bản trong bảng chỉ owner đọc được (chưa mã hóa cột). Chủ có muốn bỏ hẳn CCCD và chỉ dùng MST/số định danh không?
4. **Chỉ 4 nhóm ngành** được seed. Cho thuê tài sản và nội dung số chưa seed vì tỷ lệ GTGT chưa xác minh (kế hoạch mục E.2). Phân loại “sửa chữa/cài đặt” = dịch vụ 5 %/2 % và “lắp ráp theo yêu cầu” = 3 %/1,5 % **cần kế toán thuế xác nhận**.
5. **Ngưỡng theo năm**: năm chưa có dòng cấu hình (trước 2026) hiển thị “chưa cấu hình ngưỡng”, không tự áp 1 tỷ.
6. **Doanh thu của hóa đơn cũ có VAT** (tạo trước khi chuyển sang chế độ HKD) tính theo **tổng tiền gồm VAT**.

## A2 — Bán hàng đúng chế độ HKD (migration `0013_hkd_sales.sql`)

### Nguyên tắc kế toán
* **Một đơn bán = một giao dịch DB** (`post_sale_hkd`, UI `/sales/new`, bot `/ban`): xuất kho (giá vốn bình quân) + các khoản thu + công nợ + **một bút toán cân**:
  `Nợ 111 (tiền mặt) · Nợ 112 (chuyển khoản) · Nợ 131 (phần còn nợ, chỉ khách có tên) · Có 511 = tổng tiền` và `Nợ 632 / Có 156`.
  Lỗi ở bất kỳ bước nào ⇒ không để lại dấu vết (không còn cơ chế “ghi hóa đơn rồi tự đảo nếu thu tiền lỗi” của bot).
* **Giá đã gồm thuế, không tách VAT**: `vat_amount = 0`, `subtotal = total`, **không có dòng TK 3331/133**. RPC từ chối dòng có `vat_rate ≠ 0` (`vat_not_allowed_hkd`).
* **Khách lẻ** (`customers.is_walkin`, một dòng hệ thống “Khách lẻ”, không sửa/xóa được): nếu không chọn khách thì bán cho Khách lẻ, **phải thanh toán đủ** (trigger chặn ở mọi đường tạo hóa đơn).
* **Nhiều phương thức thanh toán** trong một đơn (`sale_payments`: tiền mặt / chuyển khoản, kèm ghi chú). A4 sẽ gắn từng khoản với tài khoản tiền cụ thể.
* **Nhóm ngành thuế theo từng dòng**: dòng → sản phẩm (`products.tax_group`) → hồ sơ HKD (`main_tax_group`) → `goods`. Tỷ lệ GTGT/TNCN **chụp lại tại ngày bán** (`vat_pct_snapshot`, `pit_pct_snapshot`); đổi bảng `tax_rates` không làm đổi hóa đơn cũ.
* **Kênh bán** (cửa hàng / online / sàn TMĐT / khác), **địa điểm** (mặc định trụ sở), **thông tin người mua** tùy chọn (tên, MST, địa chỉ, email).

### Hàng bán trả lại / giảm giá hàng bán
`post_sale_return` ghi **TK 521** (không sửa 511 của đơn gốc): `Nợ 521 · Nợ 156 / Có 632 (nhập lại kho theo đúng giá vốn gốc) · Có 131 (phần trừ vào công nợ còn lại của chính đơn đó) · Có 111/112 (hoàn tiền)`.
Trả một phần/nhiều lần, giới hạn số lượng và số tiền theo từng dòng (lần trả cuối lấy phần còn lại, không lệch làm tròn), giảm giá không trả hàng (số lượng 0). `reverse_sales_return` hủy phiếu trả. Không hủy được đơn khi còn phiếu trả hàng hoặc hóa đơn điện tử còn hiệu lực. Đơn lập theo cách cũ có tách VAT chưa hỗ trợ trả hàng tự động.
Doanh thu tính ngưỡng 1 tỷ (`v_revenue_events`, `revenue_ytd`), P&L tháng, top sản phẩm/khách hàng, dashboard đều là **doanh thu thuần = 511 − 521**. `revenue_by_tax_group(năm)` chia doanh thu theo nhóm ngành (khớp tổng `revenue_ytd`), hiển thị ở `/reports/revenue`.

### Hóa đơn điện tử (chỉ lưu thông tin, không tích hợp API)
Bảng `einvoices` lưu **ký hiệu, số, mã tra cứu, đường dẫn tra cứu, nhà cung cấp, ngày lập** của hóa đơn do phần mềm HĐĐT bên ngoài phát hành; RPC `record_sale_einvoice` (gốc / thay thế / điều chỉnh) và `cancel_sale_einvoice` (bắt buộc lý do, có nhật ký). Ràng buộc: mỗi đơn chỉ 1 hóa đơn gốc/thay thế còn hiệu lực; (ký hiệu, số) không trùng; đường dẫn chỉ `http(s)://`. Số đơn nội bộ `INV-…` **khác** số hóa đơn điện tử. View `v_sales_missing_einvoice` + bộ lọc “Chưa có hóa đơn điện tử” ở `/sales`.

### Quyền & bảo mật
Bảng mới (`sales_returns`, `sales_return_lines`, `sale_payments`, `einvoices`) bật RLS, `anon` không có quyền, `authenticated` chỉ `select` (staff); ghi qua RPC `SECURITY DEFINER` có `search_path` cố định. Chứng từ bán/trả/thu bất biến (trigger `trg_doc_immutable`), sửa sai = `reverse_*`. Hàm trigger thu hồi EXECUTE của public/anon.

### Quyết định cần chủ xác nhận (A2)
1. **Một bút toán/đơn, không tạo phiếu thu riêng** cho phần thu lúc bán (`paid_at_sale`); thu nợ sau đó vẫn dùng phiếu thu/phân bổ cũ.
2. **Hàng bán trả lại ghi vào TK 521** (giảm doanh thu thuần) thay vì sửa/hủy đơn gốc, để vẫn có vết và doanh thu thuế tính trừ đúng kỳ phát sinh (ngày trả hàng).
3. **Khách lẻ phải thanh toán đủ**; không cho ghi nợ khách lẻ. Không ghi nhận “thu dư/tiền thối” (tổng thu > tổng tiền bị từ chối).
4. **Số hóa đơn điện tử tách khỏi số đơn nội bộ**; đơn có HĐĐT còn hiệu lực không hủy được cho tới khi đánh dấu hủy HĐĐT (chủ phải xử lý hủy/điều chỉnh ở phần mềm HĐĐT trước).
5. **Quy tắc nhóm ngành của dòng** (dòng → sản phẩm → hồ sơ → hàng hóa). Dịch vụ/lắp ráp cần kế toán thuế xác nhận nhóm.
6. **Hoàn tiền trả hàng**: tự trừ vào công nợ còn lại của chính đơn trước, phần còn lại hoàn bằng phương thức chọn (mặc định tiền mặt).
7. **Đơn cũ lập bằng `post_sales_invoice` (có VAT)** vẫn xem được, nhưng chưa hỗ trợ trả hàng tự động; A3 sẽ gỡ VAT khỏi luồng này.

## A3 — Gỡ xung đột VAT (migration `0014_hkd_vat_removal.sql`)

### Nguyên tắc
Hộ kinh doanh (nhóm nộp thuế theo tỷ lệ % trên doanh thu, TT152/2025) **không** kê khai, khấu trừ hay nộp thuế GTGT theo phương pháp khấu trừ. Vì vậy ở chế độ mặc định `hkd`:

- **TK 3331 / 133 không được ghi mới**: trigger trên `journal_lines` chặn dòng mới vào hai tài khoản này (`vat_account_not_allowed_hkd`). Bút toán *đảo* (`reverses_id`) của chứng từ cũ vẫn được phép để hủy được dữ liệu legacy.
- **Bán hàng/báo giá không có VAT**: `sales_invoices`/`sales_invoice_lines` không nhận `vat_amount`/`vat_rate` khác 0; `quotations.vat` phải = 0 (`vat_not_allowed_hkd`). Báo giá dùng **đơn giá đã gồm thuế**. `invoice_from_quotation` ở chế độ HKD gọi `post_sale_hkd` (đơn bán nguyên tử, ghi công nợ cho khách có tên, giữ liên kết `quotation_id`); báo giá cũ có VAT phải lập lại.
- **Mua hàng có chứng từ**: `post_purchase_bill` ghi `Nợ 156 = tiền hàng + VAT trên hóa đơn mua / Có 331`. VAT đầu vào **không** vào TK 133 mà cộng vào giá vốn hàng tồn (`stock_movements.value_delta`, giá vốn bình quân). `purchase_bills.vat_amount` vẫn lưu để tra cứu. `reverse_purchase_bill` hoàn kho đúng giá trị đã nhập.
- **Nhập kho tay bị chặn**: `stock_adjust(type 'in')` chỉ còn cho tồn đầu kỳ (`ref_type = 'opening'`, đối ứng vốn chủ sở hữu 411). Hàng mua phải có phiếu mua (web: **Mua hàng**; bot: `/nhap <NCC> <SKU> <SL> <giá nhập> [số chứng từ]`). Nhờ vậy **TK 711 không còn nhận “hàng mua” chưa có chứng từ**; 711/811 chỉ còn cho chênh lệch kiểm kê (`adjust` / `stocktake`).
- **Báo cáo**: thẻ “Thuế GTGT” (`vat_report`) ở `/reports/accounting` chỉ hiện khi chế độ = `enterprise`; ở HKD thay bằng thẻ **Doanh thu tính thuế năm so với ngưỡng** (liên kết `/reports/revenue`).

### Chế độ kế toán `accounting_mode`
Bảng `app_settings` (staff đọc, không ghi trực tiếp). `accounting_mode()` trả `'hkd'` (mặc định, an toàn) hoặc `'enterprise'` (luồng VAT 3331/133 cũ, giữ để tương thích và để chạy các test cũ). `set_accounting_mode(mode, lý do ≥ 5 ký tự)`: **chỉ owner**, ghi `accounting_audit`. Web không có nút đổi chế độ (chủ đổi bằng RPC có chủ ý); web luôn gửi VAT = 0.

### Di chuyển dữ liệu
Forward-only, không UPDATE dữ liệu cũ. Production hiện gần như trống (15 TK, 1 owner), nên không cần backfill; mọi chứng từ legacy có 3331/133 (nếu có) vẫn đọc và hủy được.

### Quyết định cần chủ xác nhận (A3)
1. **Mặc định `hkd`**, kèm công tắc legacy `enterprise` (chỉ owner, có lý do, có audit). Nếu không cần legacy, có thể bỏ công tắc ở bản sau.
2. **VAT trên hóa đơn mua được cộng vào giá vốn** (không khấu trừ, không ghi TK 133). Đây là cách xử lý an toàn cho HKD nộp thuế theo tỷ lệ; kế toán thuế cần xác nhận nếu HKD đăng ký khấu trừ.
3. **Chặn nhập kho tay** (không NCC/chứng từ). Tồn đầu kỳ vẫn nhập được qua `ref_type = 'opening'`; kiểm kê thừa vẫn ghi 711, thiếu ghi 811.
4. **Báo giá là giá đã gồm thuế**; báo giá cũ có VAT không xuất hóa đơn được ở chế độ HKD (lập lại báo giá).
5. **Bút toán đảo 3331/133 của chứng từ legacy vẫn được phép** để không làm kẹt dữ liệu cũ.
6. **`/nhap` đổi cú pháp**: bắt buộc NCC, giá nhập > 0 và (tùy chọn) số chứng từ; không còn `/nhap <SKU> <SL>`. Nhập nhiều dòng hoặc có VAT dùng web.
7. **Ẩn báo cáo Thuế GTGT** ở HKD (chỉ hiện ở chế độ enterprise).
