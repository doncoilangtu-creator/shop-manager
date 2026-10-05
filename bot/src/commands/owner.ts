import type { Bot, Context } from "grammy";
import { authenticateOwner } from "../lib/auth";
import { getSupabase, appLink } from "../lib/supabase";
import { commandArgs, esc, fmtVND, ilikeOr, parseArgs, parseMoney, parsePositiveInt } from "../lib/text";
import { addDaysYmd, monthRange, nowIso, vnDate, vnDateTime } from "../lib/time";
import { dbErrorMessage } from "../lib/errors";

const DENIED = "⛔ Lệnh chỉ dành cho chủ shop.";
const HTML = { parse_mode: "HTML" as const };
const BAN_USAGE = 'Cú pháp: /ban [khách/SĐT] &lt;SKU&gt; &lt;SL&gt; [&lt;SKU&gt; &lt;SL&gt; ...] [tm|ck]\nVD: /ban HP-1234 2 (khách lẻ, tiền mặt)\nVD: /ban "Nguyen Van A" HP-1234 2 KB-1 1 ck';
const WALKIN_WORDS = new Set(["le", "lẻ", "khachle", "khách lẻ", "khach le"]);
const MAX_BAN_LINES = 20;

/** /ban arguments: optional customer keyword (odd token count), SKU/qty pairs, optional trailing payment method. Exported for tests. */
export function parseBanArgs(tokens: string[]): { keyword: string | null; items: Array<{ sku: string; qty: number }>; method: "cash" | "bank" } | { error: string } {
  const t = [...tokens];
  let method: "cash" | "bank" = "cash";
  const last = (t[t.length - 1] ?? "").toLowerCase();
  if (["tm", "cash"].includes(last)) { t.pop(); } else if (["ck", "bank"].includes(last)) { method = "bank"; t.pop(); }
  if (t.length < 2) return { error: BAN_USAGE };
  let keyword: string | null = null;
  if (t.length % 2 === 1) {
    const k = t.shift() as string;
    keyword = WALKIN_WORDS.has(k.toLowerCase()) ? null : k;
  }
  const items: Array<{ sku: string; qty: number }> = [];
  for (let i = 0; i < t.length; i += 2) {
    const qty = parsePositiveInt(t[i + 1]);
    if (qty === null) return { error: `Số lượng của <code>${esc(t[i])}</code> phải là số nguyên &gt; 0.\n${BAN_USAGE}` };
    items.push({ sku: t[i], qty });
  }
  if (items.length > MAX_BAN_LINES) return { error: `Tối đa ${MAX_BAN_LINES} dòng hàng mỗi đơn.` };
  return { keyword, items, method };
}

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

  // /ban [khách/SĐT] <SKU> <SL> [<SKU> <SL> ...] [tm|ck] — bán nhanh, THU TIỀN NGAY, MỘT lệnh gọi RPC nguyên tử post_sale_hkd:
  //   * hộ kinh doanh: giá bán (sell_price) đã gồm thuế, không tách VAT, doanh thu = tổng tiền (TK 511), không có TK 3331.
  //   * bỏ khách = "Khách lẻ" (không lấy thông tin, phải thanh toán đủ — luôn đúng vì /ban thu đủ ngay).
  //   * tm (mặc định) = tiền mặt TK 111; ck = chuyển khoản TK 112. Đơn nhiều dòng: lặp lại cặp <SKU> <SL>.
  //   * nguyên tử: kho + thu tiền + sổ cái trong MỘT giao dịch DB; lỗi thì không để lại dấu vết (không còn cơ chế tự đảo hóa đơn).
  bot.command("ban", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const parsed = parseBanArgs(parseArgs(commandArgs(ctx.message?.text, "ban")));
    if ("error" in parsed) return ctx.reply(parsed.error, HTML);
    const { keyword, items, method } = parsed;

    const sb = getSupabase();
    let cust: CustomerRow | null = null;
    if (keyword !== null) {
      const filter = ilikeOr(["name", "phone"], keyword);
      if (!filter) return ctx.reply("Từ khóa khách không hợp lệ.");
      const { data: custs, error: ce } = await sb.from("customers").select("id, name, phone").eq("is_walkin", false).or(filter).limit(3);
      if (ce) return ctx.reply(dbErrorMessage(ce.message));
      const list = (custs ?? []) as CustomerRow[];
      if (list.length === 0) return ctx.reply(`Không tìm thấy khách: <code>${esc(keyword)}</code>. Bỏ trống tên khách để bán cho Khách lẻ.`, HTML);
      const exact = list.filter((c) => c.phone === keyword || c.name.toLowerCase() === keyword.toLowerCase());
      cust = exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
      if (!cust) {
        return ctx.reply("Có nhiều khách phù hợp, hãy nhập rõ hơn (SĐT hoặc tên đầy đủ):\n" + list.map((c) => `• ${esc(c.name)} — ${esc(c.phone ?? "—")}`).join("\n"), HTML);
      }
    }

    const skus = [...new Set(items.map((i) => i.sku))];
    const { data: prods, error: pe } = await sb.from("products").select("id, sku, name, sell_price, stock_qty").in("sku", skus);
    if (pe) return ctx.reply(dbErrorMessage(pe.message));
    const bySku = new Map(((prods ?? []) as ProductRow[]).map((p) => [p.sku, p]));
    for (const it of items) if (!bySku.has(it.sku)) return ctx.reply(`Không tìm thấy SP: <code>${esc(it.sku)}</code>`, HTML);
    const need = new Map<string, number>();
    for (const it of items) need.set(it.sku, (need.get(it.sku) ?? 0) + it.qty);
    for (const [sku, qty] of need) {
      const p = bySku.get(sku)!;
      if (p.stock_qty < qty) return ctx.reply(`Tồn không đủ cho ${esc(p.name)} (còn ${p.stock_qty}, cần ${qty}).`, HTML);
    }

    const lines = items.map((it) => ({ product_id: bySku.get(it.sku)!.id, qty: it.qty, unit_price: Number(bySku.get(it.sku)!.sell_price) }));
    const total = Math.round(lines.reduce((a, l) => a + l.qty * l.unit_price, 0) * 100) / 100;
    if (!(total > 0)) return ctx.reply("Tổng tiền phải lớn hơn 0 (kiểm tra giá bán của sản phẩm).");

    const memo = `Bán qua Telegram bot (${u.name ?? u.id})`;
    const { data, error } = await sb.rpc("post_sale_hkd", {
      p_customer_id: cust?.id ?? null, p_date: vnDate(), p_lines: lines, // giá đã gồm thuế, không có trường VAT
      p_payments: [{ method, amount: total, note: "Thu ngay qua bot" }], // thu đủ ngay => không tạo công nợ
      p_channel: "store", p_location_id: null, p_buyer: null, p_memo: memo, p_due_date: null, p_einvoice: null, p_allow_over_limit: false,
    });
    if (error) {
      if (error.message.includes("insufficient_stock")) return ctx.reply("Tồn không đủ, hãy kiểm tra lại kho trên web.");
      return ctx.reply(dbErrorMessage(error.message));
    }
    const r = (data ?? {}) as { invoice_id?: string; invoice_no?: string; total?: number };
    if (!r.invoice_id) return ctx.reply("Không nhận được mã đơn từ hệ thống, hãy kiểm tra trên web trước khi bán lại.");
    const detail = items.map((it) => `${esc(bySku.get(it.sku)!.name)} × ${it.qty}`).join("\n");
    await ctx.reply(
      `✅ Đơn <b>${esc(r.invoice_no)}</b> — đã thu đủ ${method === "bank" ? "chuyển khoản (TK 112)" : "tiền mặt (TK 111)"}\nKhách: ${esc(cust?.name ?? "Khách lẻ")}\n${detail}\nTổng: <b>${fmtVND(Number(r.total ?? total))}</b> (giá đã gồm thuế, không tách VAT)\nCông nợ lần bán này: 0\n` +
        `Hóa đơn điện tử: chưa nhập số — vào web ${appLink(`/sales/${r.invoice_id}`)} để ghi số/mã tra cứu.`,
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
