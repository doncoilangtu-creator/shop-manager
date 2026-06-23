import type { Bot, Context } from "grammy";
import { authenticateOwner } from "../lib/auth";
import { getSupabase, appLink } from "../lib/supabase";

const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + "₫";

export function registerOwnerCommands(bot: Bot) {
  // /ton — sản phẩm sắp hết
  bot.command("ton", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");

    const sb = getSupabase();
    const { data, error } = await sb
      .from("products")
      .select("sku, name, stock_qty, min_stock")
      .order("stock_qty", { ascending: true })
      .limit(50);
    if (error) return ctx.reply("Lỗi: " + error.message);

    const low = (data ?? []).filter((p: any) => (p.stock_qty ?? 0) <= (p.min_stock ?? 0));
    if (low.length === 0) return ctx.reply("✅ Tất cả sản phẩm đều đủ hàng.");

    const lines = low.map(
      (p: any, i: number) =>
        `${i + 1}. <b>${p.name}</b> (${p.sku}) — tồn: ${p.stock_qty} / tối thiểu: ${p.min_stock}`,
    );
    await ctx.reply(`⚠️ <b>${low.length} SP sắp hết:</b>\n\n` + lines.join("\n"), {
      parse_mode: "HTML",
    });
  });

  // /nhap SKU SL GIA  — VD: /nhap HP-1234 5 4500000
  bot.command("nhap", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");

    const text = ctx.message?.text ?? "";
    const parts = text.replace(/^\/nhap\s+/, "").trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply("Cú pháp: /nhap <SKU> <SL> [giá nhập]\nVD: /nhap HP-1234 5 4500000");
    }
    const [sku, qtyRaw, costRaw] = parts;
    const qty = Number(qtyRaw);
    const unitCost = costRaw ? Number(costRaw) : 0;
    if (!Number.isFinite(qty) || qty <= 0) return ctx.reply("Số lượng phải > 0.");
    if (costRaw && (!Number.isFinite(unitCost) || unitCost < 0)) return ctx.reply("Giá nhập không hợp lệ.");

    const sb = getSupabase();
    const { data: prod } = await sb
      .from("products")
      .select("id, name, stock_qty")
      .eq("sku", sku)
      .maybeSingle();
    if (!prod) return ctx.reply(`Không tìm thấy SP với SKU <code>${sku}</code>`, { parse_mode: "HTML" });

    const { error: e1 } = await sb.from("stock_movements").insert({
      product_id: prod.id,
      type: "in",
      qty,
      unit_cost: unitCost,
      ref_type: "manual",
      notes: "Nhập qua Telegram bot",
      created_by: u.id,
    });
    if (e1) return ctx.reply("Lỗi ghi log: " + e1.message);

    const newQty = (prod.stock_qty ?? 0) + qty;
    const { error: e2 } = await sb
      .from("products")
      .update({ stock_qty: newQty })
      .eq("id", prod.id);
    if (e2) return ctx.reply("Lỗi cập nhật tồn: " + e2.message);

    await ctx.reply(`✅ Đã nhập <b>${qty}</b> ${prod.name} (${sku})\nTồn mới: <b>${newQty}</b>`, {
      parse_mode: "HTML",
    });
  });

  // /ban <khách/SĐT> <SKU> <SL>
  bot.command("ban", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");

    const text = ctx.message?.text ?? "";
    const parts = text.replace(/^\/ban\s+/, "").trim().split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply("Cú pháp: /ban <khách/SĐT> <SKU> <SL>\nVD: /ban \"Nguyen Van A\" HP-1234 2");
    }
    const [keyword, sku, qtyRaw] = parts;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) return ctx.reply("Số lượng phải > 0.");

    const sb = getSupabase();
    // Tìm khách
    const { data: cust } = await sb
      .from("customers")
      .select("id, name, phone")
      .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`)
      .limit(1)
      .maybeSingle();
    if (!cust) return ctx.reply(`Không tìm thấy khách: <code>${keyword}</code>`, { parse_mode: "HTML" });

    const { data: prod } = await sb
      .from("products")
      .select("id, name, sell_price, stock_qty")
      .eq("sku", sku)
      .maybeSingle();
    if (!prod) return ctx.reply(`Không tìm thấy SP: <code>${sku}</code>`, { parse_mode: "HTML" });
    if ((prod.stock_qty ?? 0) < qty) return ctx.reply(`Tồn không đủ (còn ${prod.stock_qty}).`);

    const code = "BG-" + Date.now().toString(36).toUpperCase().slice(-6);
    const { data: q, error } = await sb
      .from("quotations")
      .insert({
        code,
        customer_id: cust.id,
        status: "draft",
        subtotal: prod.sell_price * qty,
        discount: 0,
        vat: 0,
        total: prod.sell_price * qty,
        valid_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) return ctx.reply("Lỗi tạo BG: " + error.message);

    await sb.from("quotation_items").insert({
      quotation_id: q!.id,
      product_id: prod.id,
      qty,
      unit_price: prod.sell_price,
      discount: 0,
      line_total: prod.sell_price * qty,
    });

    await sb.from("stock_movements").insert({
      product_id: prod.id,
      type: "out",
      qty,
      unit_cost: 0,
      ref_type: "quotation",
      ref_id: q!.id,
      notes: "Bán qua Telegram bot",
      created_by: u.id,
    });
    await sb
      .from("products")
      .update({ stock_qty: (prod.stock_qty ?? 0) - qty })
      .eq("id", prod.id);

    await ctx.reply(
      `✅ BG <b>${code}</b>\nKhách: ${cust.name}\nSP: ${prod.name} × ${qty}\nTổng: ${fmtVND(prod.sell_price * qty)}\n\nXem: ${appLink(`/quotations/${q!.id}`)}`,
      { parse_mode: "HTML" },
    );
  });

  // /khach keyword
  bot.command("khach", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");
    const text = ctx.message?.text ?? "";
    const kw = text.replace(/^\/khach\s+/, "").trim();
    if (!kw) return ctx.reply("Cú pháp: /khach <từ khóa>");
    const sb = getSupabase();
    const { data } = await sb
      .from("customers")
      .select("id, name, phone, type")
      .or(`name.ilike.%${kw}%,phone.ilike.%${kw}%,email.ilike.%${kw}%`)
      .limit(10);
    const list = data ?? [];
    if (list.length === 0) return ctx.reply(`Không tìm thấy khách: <code>${kw}</code>`, { parse_mode: "HTML" });
    const lines = list.map(
      (c: any, i: number) =>
        `${i + 1}. <b>${c.name}</b> (${c.type === "business" ? "DN" : "lẻ"}) — ${c.phone ?? "—"}\n   ${appLink(`/customers/${c.id}`)}`,
    );
    await ctx.reply(`🔍 <b>${list.length} kết quả:</b>\n\n` + lines.join("\n"), {
      parse_mode: "HTML",
    });
  });

  // /baotri — tickets 7 ngày tới
  bot.command("baotri", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");
    const sb = getSupabase();
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 7 * 86400_000).toISOString();
    const { data } = await sb
      .from("maintenance_tickets")
      .select("code, title, status, sla_due_at, customers(name)")
      .gte("sla_due_at", now)
      .lte("sla_due_at", future)
      .not("status", "in", "(closed,signed)")
      .order("sla_due_at", { ascending: true })
      .limit(20);
    const list = data ?? [];
    if (list.length === 0) return ctx.reply("✅ Không có ticket nào đến hạn trong 7 ngày tới.");
    const lines = list.map((t: any) => {
      const cn = Array.isArray(t.customers) ? t.customers[0]?.name : t.customers?.name;
      const due = new Date(t.sla_due_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      return `• <b>${t.code}</b> [${t.status}] — ${t.title}\n   Khách: ${cn ?? "—"} | SLA: ${due}`;
    });
    await ctx.reply(`📅 <b>${list.length} ticket đến hạn:</b>\n\n` + lines.join("\n"), {
      parse_mode: "HTML",
    });
  });

  // /doanhthu YYYY-MM
  bot.command("doanhthu", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");
    const text = ctx.message?.text ?? "";
    const arg = text.replace(/^\/doanhthu\s+/, "").trim();
    const match = arg.match(/^(\d{4})-(\d{1,2})$/);
    if (!match) return ctx.reply("Cú pháp: /doanhthu YYYY-MM (vd: 2026-06)");
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const start = new Date(Date.UTC(year, month, 1)).toISOString();
    const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
    const sb = getSupabase();
    const { data } = await sb
      .from("quotations")
      .select("total")
      .eq("status", "approved")
      .gte("created_at", start)
      .lt("created_at", end);
    const total = (data ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0);
    const count = (data ?? []).length;
    await ctx.reply(
      `📊 Doanh thu <b>${match[1]}-${match[2]}</b>\nSố BG approved: <b>${count}</b>\nTổng: <b>${fmtVND(total)}</b>`,
      { parse_mode: "HTML" },
    );
  });

  // /top — top 10 SP bán chạy
  bot.command("top", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply("⛔ Lệnh chỉ dành cho chủ shop.");
    const sb = getSupabase();
    const { data } = await sb
      .from("quotation_items")
      .select("qty, line_total, products(name, sku), quotations!inner(status)")
      .eq("quotations.status", "approved")
      .limit(200);
    const items = data ?? [];
    const stats = new Map<string, { name: string; sku: string; qty: number; revenue: number }>();
    for (const it of items as any[]) {
      const p = Array.isArray(it.products) ? it.products[0] : it.products;
      if (!p) continue;
      const key = p.sku;
      const cur = stats.get(key) ?? { name: p.name, sku: p.sku, qty: 0, revenue: 0 };
      cur.qty += it.qty ?? 0;
      cur.revenue += it.line_total ?? 0;
      stats.set(key, cur);
    }
    const top = [...stats.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
    if (top.length === 0) return ctx.reply("Chưa có dữ liệu bán hàng.");
    const lines = top.map(
      (t, i) => `${i + 1}. <b>${t.name}</b> — ${t.qty} cái — ${fmtVND(t.revenue)}`,
    );
    await ctx.reply("🏆 <b>Top 10 SP bán chạy:</b>\n\n" + lines.join("\n"), {
      parse_mode: "HTML",
    });
  });
}