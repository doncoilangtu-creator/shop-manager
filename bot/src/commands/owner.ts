import type { Bot, Context } from "grammy";
import { authenticateOwner } from "../lib/auth";
import { getSupabase, appLink } from "../lib/supabase";
import { commandArgs, esc, fmtVND, ilikeOr, parseArgs, parseMoney, parsePositiveInt } from "../lib/text";
import { addDaysYmd, monthRange, nowIso, vnDate, vnDateTime } from "../lib/time";
import { dbErrorMessage } from "../lib/errors";

const DENIED = "⛔ Lệnh chỉ dành cho chủ shop.";
const HTML = { parse_mode: "HTML" as const };
/** Bán nhanh thu ngay: tiền mặt = TK 111 (public._method_account('cash')); schema chỉ có 'cash' | 'bank'. */
const PAY_METHOD = "cash";

type ProductRow = { id: string; sku: string; name: string; sell_price: number; stock_qty: number; min_stock: number };
type CustomerRow = { id: string; name: string; phone: string | null; type?: string };
type TicketRow = { code: string; title: string; status: string; sla_due_at: string | null; customers: { name: string } | { name: string }[] | null };

export function registerOwnerCommands(bot: Bot) {
  // /ton — sản phẩm sắp hết (view low_stock_products: stock_qty <= min_stock)
  bot.command("ton", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const { data, error } = await getSupabase()
      .from("low_stock_products")
      .select("sku, name, stock_qty, min_stock")
      .order("stock_qty", { ascending: true })
      .limit(50);
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const low = (data ?? []) as Pick<ProductRow, "sku" | "name" | "stock_qty" | "min_stock">[];
    if (low.length === 0) return ctx.reply("✅ Tất cả sản phẩm đều đủ hàng.");
    const lines = low.map((p, i) => `${i + 1}. <b>${esc(p.name)}</b> (${esc(p.sku)}) — tồn: ${p.stock_qty} / tối thiểu: ${p.min_stock}`);
    await ctx.reply(`⚠️ <b>${low.length} SP sắp hết:</b>\n\n` + lines.join("\n"), HTML);
  });

  // /nhap SKU SL [GIÁ] — nhập kho nhanh qua RPC stock_adjust (sổ kho append-only, tồn cập nhật nguyên tử)
  bot.command("nhap", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const parts = parseArgs(commandArgs(ctx.message?.text, "nhap"));
    if (parts.length < 2 || parts.length > 3) return ctx.reply("Cú pháp: /nhap <SKU> <SL> [giá nhập]\nVD: /nhap HP-1234 5 4500000");
    const [sku, qtyRaw, costRaw] = parts;
    const qty = parsePositiveInt(qtyRaw);
    if (qty === null) return ctx.reply("Số lượng phải là số nguyên > 0.");
    const unitCost = costRaw === undefined ? 0 : parseMoney(costRaw);
    if (unitCost === null) return ctx.reply("Giá nhập không hợp lệ.");

    const sb = getSupabase();
    const { data: prod, error: pe } = await sb.from("products").select("id, name, stock_qty").eq("sku", sku).maybeSingle();
    if (pe) return ctx.reply(dbErrorMessage(pe.message));
    if (!prod) return ctx.reply(`Không tìm thấy SP với SKU <code>${esc(sku)}</code>`, HTML);

    const { data, error } = await sb.rpc("stock_adjust", {
      p_product_id: prod.id, p_type: "in", p_qty: qty, p_unit_cost: unitCost,
      p_ref_type: "manual", p_ref_id: null, p_notes: `Nhập qua Telegram bot (${u.name ?? u.id})`,
    });
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const newQty = Number((data as { stock_qty?: number } | null)?.stock_qty ?? NaN);
    await ctx.reply(`✅ Đã nhập <b>${qty}</b> ${esc(prod.name)} (${esc(sku)})\nTồn mới: <b>${Number.isFinite(newQty) ? newQty : "?"}</b>`, HTML);
  });

  // /ban <khách/SĐT> <SKU> <SL> — bán nhanh, THU TIỀN NGAY (hộ kinh doanh, giá bán đã gồm VAT):
  //   1) post_sales_invoice: vat_rate = 0 và unit_price = sell_price => tổng hóa đơn = giá bán x SL, thuế không tách riêng
  //      (giá niêm yết được coi là ĐÃ GỒM VAT; hộ kinh doanh không kê khai/khấu trừ VAT riêng). Hạn thanh toán = ngày bán
  //      (không còn hạn 7 ngày) và p_allow_over_limit = true vì hóa đơn được thu đủ ngay sau đó (không làm tăng công nợ).
  //   2) post_receipt: phiếu thu TIỀN MẶT (TK 111, mặc định) đúng bằng tổng hóa đơn, phân bổ thẳng vào hóa đơn này (KHÔNG dùng
  //      post_receipt_fifo vì FIFO sẽ trả nợ cũ của khách trước) => công nợ 131 của lần bán này = 0.
  //   Hai RPC là hai giao dịch riêng: nếu thu tiền lỗi thì bot đảo hóa đơn vừa ghi (reverse_sales_invoice) để không để lại công nợ treo.
  bot.command("ban", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const parts = parseArgs(commandArgs(ctx.message?.text, "ban"));
    if (parts.length !== 3) return ctx.reply('Cú pháp: /ban <khách/SĐT> <SKU> <SL>\nVD: /ban "Nguyen Van A" HP-1234 2');
    const [keyword, sku, qtyRaw] = parts;
    const qty = parsePositiveInt(qtyRaw);
    if (qty === null) return ctx.reply("Số lượng phải là số nguyên > 0.");
    const filter = ilikeOr(["name", "phone"], keyword);
    if (!filter) return ctx.reply("Từ khóa khách không hợp lệ.");

    const sb = getSupabase();
    const { data: custs, error: ce } = await sb.from("customers").select("id, name, phone").or(filter).limit(3);
    if (ce) return ctx.reply(dbErrorMessage(ce.message));
    const list = (custs ?? []) as CustomerRow[];
    if (list.length === 0) return ctx.reply(`Không tìm thấy khách: <code>${esc(keyword)}</code>`, HTML);
    const exact = list.filter((c) => c.phone === keyword || c.name.toLowerCase() === keyword.toLowerCase());
    const cust = exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
    if (!cust) {
      return ctx.reply("Có nhiều khách phù hợp, hãy nhập rõ hơn (SĐT hoặc tên đầy đủ):\n" + list.map((c) => `• ${esc(c.name)} — ${esc(c.phone ?? "—")}`).join("\n"), HTML);
    }

    const { data: prod, error: pe } = await sb.from("products").select("id, name, sell_price, stock_qty").eq("sku", sku).maybeSingle();
    if (pe) return ctx.reply(dbErrorMessage(pe.message));
    if (!prod) return ctx.reply(`Không tìm thấy SP: <code>${esc(sku)}</code>`, HTML);
    const p = prod as ProductRow;

    const today = vnDate();
    const memo = `Bán qua Telegram bot (${u.name ?? u.id})`;
    const { data, error } = await sb.rpc("post_sales_invoice", {
      p_customer_id: cust.id, p_invoice_date: today, p_due_date: today,
      p_lines: [{ product_id: p.id, qty, unit_price: p.sell_price, vat_rate: 0 }], // giá đã gồm VAT, VAT 0%
      p_memo: memo, p_quotation_id: null, p_allow_over_limit: true, // thu đủ ngay => không tạo công nợ mới
    });
    if (error) {
      if (error.message.includes("insufficient_stock")) return ctx.reply(`Tồn không đủ (còn ${p.stock_qty}).`);
      return ctx.reply(dbErrorMessage(error.message));
    }
    const r = (data ?? {}) as { invoice_id?: string; invoice_no?: string; total?: number };
    const total = Number(r.total ?? p.sell_price * qty);
    if (!r.invoice_id) return ctx.reply("Không nhận được mã hóa đơn từ hệ thống, hãy kiểm tra trên web trước khi bán lại.");

    // Thu tiền mặt đúng bằng tổng hóa đơn, phân bổ vào chính hóa đơn này.
    const { data: rc, error: re } = await sb.rpc("post_receipt", {
      p_customer_id: cust.id, p_amount: total, p_method: PAY_METHOD, p_date: today,
      p_allocations: [{ invoice_id: r.invoice_id, amount: total }], p_memo: `Thu tiền ngay ${r.invoice_no ?? ""} — ${memo}`,
    });
    if (re) {
      console.error("[/ban] post_receipt failed:", re.message);
      const { error: ve } = await sb.rpc("reverse_sales_invoice", { p_invoice_id: r.invoice_id, p_date: today, p_reason: "Bot: thu tiền ngay thất bại, tự động đảo hóa đơn" });
      return ctx.reply(
        ve
          ? `⚠️ Đã ghi hóa đơn <b>${esc(r.invoice_no)}</b> nhưng KHÔNG thu được tiền và cũng không tự đảo được. Hãy xử lý trên web (công nợ đang mở ${fmtVND(total)}).`
          : `❌ Không ghi được phiếu thu nên đã tự đảo hóa đơn <b>${esc(r.invoice_no)}</b> (kho và sổ được hoàn lại). Thử lại sau.`,
        HTML,
      );
    }
    const pay = (rc ?? {}) as { payment_no?: string };
    await ctx.reply(
      `✅ Hóa đơn <b>${esc(r.invoice_no)}</b> — đã thu đủ tiền mặt (TK 111)\nPhiếu thu: ${esc(pay.payment_no ?? "—")}\nKhách: ${esc(cust.name)}\nSP: ${esc(p.name)} × ${qty}\nTổng: ${fmtVND(total)} (giá đã gồm VAT, VAT 0%)\nCông nợ lần bán này: 0`,
      HTML,
    );
  });

  // /khach keyword
  bot.command("khach", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const kw = commandArgs(ctx.message?.text, "khach");
    const filter = ilikeOr(["name", "phone", "email"], kw);
    if (!filter) return ctx.reply("Cú pháp: /khach <từ khóa>");
    const { data, error } = await getSupabase().from("customers").select("id, name, phone, type").or(filter).limit(10);
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const list = (data ?? []) as CustomerRow[];
    if (list.length === 0) return ctx.reply(`Không tìm thấy khách: <code>${esc(kw)}</code>`, HTML);
    const lines = list.map((c, i) => `${i + 1}. <b>${esc(c.name)}</b> (${c.type === "business" ? "DN" : "lẻ"}) — ${esc(c.phone ?? "—")}\n   ${appLink(`/customers/${c.id}`)}`);
    await ctx.reply(`🔍 <b>${list.length} kết quả:</b>\n\n` + lines.join("\n"), HTML);
  });

  // /baotri — ticket đến hạn SLA trong 7 ngày tới (đã quá hạn cũng hiện)
  bot.command("baotri", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const future = new Date(Date.now() + 7 * 86400_000).toISOString();
    const { data, error } = await getSupabase()
      .from("maintenance_tickets")
      .select("code, title, status, sla_due_at, customers(name)")
      .lte("sla_due_at", future)
      .not("status", "in", "(closed,signed)")
      .order("sla_due_at", { ascending: true })
      .limit(20);
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const list = (data ?? []) as unknown as TicketRow[];
    if (list.length === 0) return ctx.reply("✅ Không có ticket nào đến hạn trong 7 ngày tới.");
    const now = nowIso();
    const lines = list.map((t) => {
      const cn = Array.isArray(t.customers) ? t.customers[0]?.name : t.customers?.name;
      const late = t.sla_due_at && t.sla_due_at < now ? " ⚠️ QUÁ HẠN" : "";
      return `• <b>${esc(t.code)}</b> [${esc(t.status)}] — ${esc(t.title)}\n   Khách: ${esc(cn ?? "—")} | SLA: ${esc(vnDateTime(t.sla_due_at))}${late}`;
    });
    await ctx.reply(`📅 <b>${list.length} ticket đến hạn:</b>\n\n` + lines.join("\n"), HTML);
  });

  // /doanhthu YYYY-MM — doanh thu ghi sổ (TK 511) và giá vốn (TK 632) của tháng
  bot.command("doanhthu", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const range = monthRange(commandArgs(ctx.message?.text, "doanhthu"));
    if (!range) return ctx.reply("Cú pháp: /doanhthu YYYY-MM (tháng 1–12, vd: 2026-06)");
    const { data, error } = await getSupabase().rpc("report_monthly_pnl", { p_from: range.from, p_to: range.to });
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const row = (Array.isArray(data) ? data : []).find((r: { month: string }) => String(r.month).startsWith(range.key)) as
      | { revenue: number; cogs: number; gross_profit: number } | undefined;
    const rev = Number(row?.revenue ?? 0), cogs = Number(row?.cogs ?? 0);
    await ctx.reply(`📊 Doanh thu <b>${range.key}</b> (sổ cái)\nDoanh thu: <b>${fmtVND(rev)}</b>\nGiá vốn: ${fmtVND(cogs)}\nLãi gộp: <b>${fmtVND(rev - cogs)}</b>`, HTML);
  });

  // /top — top 10 SP theo doanh thu 30 ngày gần nhất (hóa đơn chưa hủy, gộp theo sản phẩm trong SQL)
  bot.command("top", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const to = vnDate();
    const { data, error } = await getSupabase().rpc("report_top_products", { p_from: addDaysYmd(to, -29), p_to: to, p_limit: 10 });
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const top = (Array.isArray(data) ? data : []) as Array<{ name: string | null; qty: number; revenue: number }>;
    if (top.length === 0) return ctx.reply("Chưa có dữ liệu bán hàng trong 30 ngày qua.");
    const lines = top.map((t, i) => `${i + 1}. <b>${esc(t.name ?? "—")}</b> — ${t.qty} cái — ${fmtVND(Number(t.revenue))}`);
    await ctx.reply("🏆 <b>Top 10 SP bán chạy (30 ngày):</b>\n\n" + lines.join("\n"), HTML);
  });
}
