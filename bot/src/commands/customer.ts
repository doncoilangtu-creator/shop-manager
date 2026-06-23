import type { Bot, Context } from "grammy";
import { authenticateCustomer } from "../lib/auth";
import { getSupabase, appLink } from "../lib/supabase";

export function registerCustomerCommands(bot: Bot) {
  // /hopdong <mã>
  bot.command("hopdong", async (ctx: Context) => {
    const u = await authenticateCustomer(ctx);
    if (!u) return ctx.reply("⛔ Bạn chưa được đăng ký.");

    const text = ctx.message?.text ?? "";
    const code = text.replace(/^\/hopdong\s+/, "").trim();
    if (!code) return ctx.reply("Cú pháp: /hopdong <mã HĐ>");

    const sb = getSupabase();
    const { data } = await sb
      .from("maintenance_contracts")
      .select("code, start_date, end_date, scope, monthly_fee, status, sla_hours, customers!inner(id)")
      .eq("code", code)
      .eq("customer_id", u.customer_id!)
      .maybeSingle();
    if (!data) return ctx.reply(`Không tìm thấy HĐ <code>${code}</code> của bạn.`, { parse_mode: "HTML" });

    const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + "₫";
    await ctx.reply(
      `📋 <b>HĐ ${data.code}</b> [${data.status}]\n` +
        `Từ: ${data.start_date} → ${data.end_date}\n` +
        `Phạm vi: ${data.scope || "—"}\n` +
        `Phí/tháng: ${fmtVND(data.monthly_fee ?? 0)}\n` +
        `SLA: ${data.sla_hours ?? "—"}h`,
      { parse_mode: "HTML" },
    );
  });

  // /yeucaubt <mô tả>
  bot.command("yeucaubt", async (ctx: Context) => {
    const u = await authenticateCustomer(ctx);
    if (!u) return ctx.reply("⛔ Bạn chưa được đăng ký.");

    const text = ctx.message?.text ?? "";
    const desc = text.replace(/^\/yeucaubt\s+/, "").trim();
    if (!desc) return ctx.reply("Cú pháp: /yeucaubt <mô tả sự cố>");

    const sb = getSupabase();
    // Tìm HĐ active của khách
    const { data: contract } = await sb
      .from("maintenance_contracts")
      .select("id, code, sla_hours")
      .eq("customer_id", u.customer_id!)
      .eq("status", "active")
      .gte("end_date", new Date().toISOString())
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!contract)
      return ctx.reply("Bạn chưa có hợp đồng bảo trì active. Vui lòng liên hệ shop.");

    const code = "TK-" + Date.now().toString(36).toUpperCase().slice(-6);
    const slaDueAt = new Date(Date.now() + (contract.sla_hours ?? 24) * 3600_000).toISOString();
    const { data: ticket, error } = await sb
      .from("maintenance_tickets")
      .insert({
        code,
        contract_id: contract.id,
        customer_id: u.customer_id!,
        title: desc.slice(0, 100),
        description: desc,
        priority: "medium",
        status: "received",
        sla_due_at: slaDueAt,
      })
      .select("id")
      .single();
    if (error) return ctx.reply("Lỗi tạo ticket: " + error.message);

    await ctx.reply(
      `✅ Đã tạo yêu cầu bảo trì <b>${code}</b>\nSLA: phản hồi trong ${contract.sla_hours ?? 24}h\n\nTheo dõi: /ticket ${code}`,
      { parse_mode: "HTML" },
    );

    // Thông báo owner
    const { data: owners } = await sb
      .from("bot_users")
      .select("telegram_chat_id")
      .eq("role", "owner")
      .eq("active", true);
    if (owners) {
      for (const o of owners) {
        try {
          await ctx.api.sendMessage(
            o.telegram_chat_id,
            `🆕 <b>Yêu cầu bảo trì mới</b>\n` +
              `Mã: ${code}\n` +
              `Khách: ${u.name ?? "—"}\n` +
              `Mô tả: ${desc}\n` +
              `SLA: ${slaDueAt}\n\n` +
              `Xử lý: ${appLink(`/maintenance/tickets/${ticket!.id}`)}`,
            { parse_mode: "HTML" },
          );
        } catch (e) {
          console.error("notify owner failed:", (e as Error).message);
        }
      }
    }
    await sb.from("notifications").insert({
      type: "ticket_created",
      payload: { ticket_id: ticket!.id, code, customer_id: u.customer_id },
    });
  });

  // /ticket <mã>
  bot.command("ticket", async (ctx: Context) => {
    const u = await authenticateCustomer(ctx);
    if (!u) return ctx.reply("⛔ Bạn chưa được đăng ký.");

    const text = ctx.message?.text ?? "";
    const code = text.replace(/^\/ticket\s+/, "").trim();
    if (!code) return ctx.reply("Cú pháp: /ticket <mã ticket>");

    const sb = getSupabase();
    const { data } = await sb
      .from("maintenance_tickets")
      .select("code, title, status, priority, sla_due_at, created_at")
      .eq("code", code)
      .eq("customer_id", u.customer_id!)
      .maybeSingle();
    if (!data) return ctx.reply(`Không tìm thấy ticket <code>${code}</code>.`, { parse_mode: "HTML" });
    const labels: Record<string, string> = {
      received: "Tiếp nhận",
      assigned: "Đã phân công",
      in_progress: "Đang xử lý",
      waiting_parts: "Chờ phụ tùng",
      completed: "Hoàn thành",
      awaiting_signature: "Chờ ký xác nhận",
      signed: "Đã ký",
      closed: "Đóng",
    };
    await ctx.reply(
      `🎫 <b>${data.code}</b> [${labels[data.status] ?? data.status}]\n` +
        `${data.title}\n` +
        `Ưu tiên: ${data.priority}\n` +
        `Tạo: ${new Date(data.created_at).toLocaleString("vi-VN")}\n` +
        `SLA: ${new Date(data.sla_due_at).toLocaleString("vi-VN")}`,
      { parse_mode: "HTML" },
    );
  });
}