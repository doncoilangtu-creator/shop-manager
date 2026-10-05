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
