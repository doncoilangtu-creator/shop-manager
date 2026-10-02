import type { Bot, Context } from "grammy";
import { authenticateCustomer } from "../lib/auth";
import { getSupabase, appLink } from "../lib/supabase";
import { commandArgs, esc, fmtVND } from "../lib/text";
import { vnDate, vnDateTime } from "../lib/time";
import { generateCode } from "../lib/codes";
import { dbErrorMessage } from "../lib/errors";

const DENIED = "⛔ Bạn chưa được đăng ký.";
const HTML = { parse_mode: "HTML" as const };

export const TICKET_STATUS_LABELS: Record<string, string> = {
  received: "Tiếp nhận", assigned: "Đã phân công", in_progress: "Đang xử lý", waiting_parts: "Chờ phụ tùng",
  completed: "Hoàn thành", awaiting_signature: "Chờ ký xác nhận", signed: "Đã ký", closed: "Đóng",
};
const PRIORITY_LABELS: Record<string, string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };

export function registerCustomerCommands(bot: Bot) {
  // /hopdong <mã>
  bot.command("hopdong", async (ctx: Context) => {
    const u = await authenticateCustomer(ctx);
    if (!u) return ctx.reply(DENIED);
    const code = commandArgs(ctx.message?.text, "hopdong");
    if (!code) return ctx.reply("Cú pháp: /hopdong <mã HĐ>");

    const { data, error } = await getSupabase()
      .from("maintenance_contracts")
      .select("code, start_date, end_date, scope, monthly_fee, status, sla_hours")
      .eq("code", code)
      .eq("customer_id", u.customer_id!)
      .maybeSingle();
    if (error) return ctx.reply(dbErrorMessage(error.message));
    if (!data) return ctx.reply(`Không tìm thấy HĐ <code>${esc(code)}</code> của bạn.`, HTML);
    await ctx.reply(
      `📋 <b>HĐ ${esc(data.code)}</b> [${esc(data.status)}]\n` +
        `Từ: ${esc(data.start_date)} → ${esc(data.end_date)}\n` +
        `Phạm vi: ${esc(data.scope || "—")}\n` +
        `Phí/tháng: ${fmtVND(Number(data.monthly_fee ?? 0))}\n` +
        `SLA: ${data.sla_hours ?? "—"}h`,
      HTML,
    );
  });

  // /yeucaubt <mô tả>
  bot.command("yeucaubt", async (ctx: Context) => {
    const u = await authenticateCustomer(ctx);
    if (!u) return ctx.reply(DENIED);
    const desc = commandArgs(ctx.message?.text, "yeucaubt");
    if (!desc) return ctx.reply("Cú pháp: /yeucaubt <mô tả sự cố>");
    if (desc.length > 2000) return ctx.reply("Mô tả quá dài (tối đa 2000 ký tự).");

    const sb = getSupabase();
    // HĐ còn hiệu lực: end_date là kiểu date -> so với NGÀY (giờ VN), không phải chuỗi ISO có giờ.
    const { data: contract, error: ce } = await sb
      .from("maintenance_contracts")
      .select("id, code, sla_hours")
      .eq("customer_id", u.customer_id!)
      .eq("status", "active")
      .gte("end_date", vnDate())
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ce) return ctx.reply(dbErrorMessage(ce.message));
    if (!contract) return ctx.reply("Bạn chưa có hợp đồng bảo trì còn hiệu lực. Vui lòng liên hệ shop.");

    const slaHours = Number(contract.sla_hours) > 0 ? Number(contract.sla_hours) : 24;
    const slaDueAt = new Date(Date.now() + slaHours * 3600_000).toISOString();
    let ticket: { id: string } | null = null;
    let code = "";
    for (let attempt = 0; attempt < 4 && !ticket; attempt++) {
      code = generateCode("TK");
      const { data, error } = await sb
        .from("maintenance_tickets")
        .insert({
          code, contract_id: contract.id, customer_id: u.customer_id!, title: desc.slice(0, 100), description: desc,
          priority: "medium", status: "received", sla_due_at: slaDueAt,
        })
        .select("id")
        .single();
      if (!error) { ticket = data as { id: string }; break; }
      if (error.code !== "23505") return ctx.reply(dbErrorMessage(error.message));   // only a code collision is retried
    }
    if (!ticket) return ctx.reply("Không tạo được mã ticket, vui lòng thử lại.");

    await ctx.reply(`✅ Đã tạo yêu cầu bảo trì <b>${esc(code)}</b>\nSLA: xử lý trong ${slaHours}h\n\nTheo dõi: /ticket ${esc(code)}`, HTML);

    const { data: owners } = await sb.from("bot_users").select("telegram_chat_id").eq("role", "owner").eq("active", true);
    for (const o of owners ?? []) {
      try {
        await ctx.api.sendMessage(
          o.telegram_chat_id,
          `🆕 <b>Yêu cầu bảo trì mới</b>\nMã: ${esc(code)}\nKhách: ${esc(u.name ?? "—")}\nMô tả: ${esc(desc)}\nSLA: ${esc(vnDateTime(slaDueAt))}\n\nXử lý: ${appLink(`/maintenance/tickets/${ticket.id}`)}`,
          HTML,
        );
      } catch (e) {
        console.error("notify owner failed:", (e as Error).message);
      }
    }
    const { error: ne } = await sb.from("notifications").insert({ type: "ticket_created", payload: { ticket_id: ticket.id, code, customer_id: u.customer_id } });
    if (ne) console.error("notification insert failed:", ne.message);
  });

  // /ticket <mã>
  bot.command("ticket", async (ctx: Context) => {
    const u = await authenticateCustomer(ctx);
    if (!u) return ctx.reply(DENIED);
    const code = commandArgs(ctx.message?.text, "ticket");
    if (!code) return ctx.reply("Cú pháp: /ticket <mã ticket>");

    const { data, error } = await getSupabase()
      .from("maintenance_tickets")
      .select("code, title, status, priority, sla_due_at, created_at")
      .eq("code", code)
      .eq("customer_id", u.customer_id!)
      .maybeSingle();
    if (error) return ctx.reply(dbErrorMessage(error.message));
    if (!data) return ctx.reply(`Không tìm thấy ticket <code>${esc(code)}</code>.`, HTML);
    await ctx.reply(
      `🎫 <b>${esc(data.code)}</b> [${esc(TICKET_STATUS_LABELS[data.status] ?? data.status)}]\n` +
        `${esc(data.title)}\n` +
        `Ưu tiên: ${esc(PRIORITY_LABELS[data.priority] ?? data.priority)}\n` +
        `Tạo: ${esc(vnDateTime(data.created_at))}\n` +
        `SLA: ${esc(vnDateTime(data.sla_due_at))}`,
      HTML,
    );
  });
}
