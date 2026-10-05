import type { Bot, Context } from "grammy";
import { findBotUser } from "../lib/auth";

export function registerStartCommand(bot: Bot) {
  bot.command("start", async (ctx: Context) => {
    const chatId = ctx.chatId;
    const u = chatId ? await findBotUser(chatId) : null;

    if (!u) {
      await ctx.reply(
        "👋 Xin chào! Bạn chưa được đăng ký với shop.\n\n" +
          "Vui lòng liên hệ chủ shop để được thêm vào hệ thống.\n" +
          "Bot chat_id của bạn: <code>" +
          chatId +
          "</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    if (u.role === "owner") {
      await ctx.reply(
        "👋 Chào anh chủ shop!\n\n" +
          "Các lệnh:\n" +
          "  /tien — Số dư tiền mặt / NH / ví (A4)\n" +
          "  /ton [sku|tên] — Tồn kho (sắp hết + top; hoặc tìm SP)\n" +
          "  /ban [tm|ck] SKU:SL … — Bán nhanh (thu đủ ngay)\n" +
          "  /baogia — Báo giá gần đây; /baogia tao … — tạo nháp\n" +
          "  /nhap <NCC> <SKU> <SL> <giá nhập> [số chứng từ] — Nhập hàng có chứng từ\n" +
          "  /khach <từ khóa> — Tìm khách\n" +
          "  /baotri — Lịch bảo trì 7 ngày tới\n" +
          "  /doanhthu YYYY-MM — Doanh thu tháng\n" +
          "  /top — Top 10 SP bán chạy\n\n" +
          "Gõ /ban hoặc /baogia không đối số để xem cú pháp chi tiết.",
      );
    } else {
      await ctx.reply(
        "👋 Xin chào " +
          (u.name ?? "bạn") +
          "!\n\n" +
          "Các lệnh:\n" +
          "  /hopdong <mã HĐ> — Xem hợp đồng bảo trì\n" +
          "  /yeucaubt <mô tả> — Tạo yêu cầu bảo trì\n" +
          "  /ticket <mã> — Xem trạng thái ticket",
      );
    }
  });
}
