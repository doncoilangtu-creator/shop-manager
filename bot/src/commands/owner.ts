import type { Bot, Context } from "grammy";
import { authenticateOwner } from "../lib/auth";
import { getSupabase, appLink } from "../lib/supabase";
import { commandArgs, esc, fmtVND, ilikeOr, parseArgs, parseMoney, parsePositiveInt } from "../lib/text";
import { addDaysYmd, monthRange, nowIso, vnDate, vnDateTime } from "../lib/time";
import { dbErrorMessage } from "../lib/errors";
import { generateCode } from "../lib/codes";

const DENIED = "⛔ Lệnh chỉ dành cho chủ shop.";
const HTML = { parse_mode: "HTML" as const };
const BAN_USAGE =
  "Cú pháp (giống bán nhanh trên web):\n" +
  "  /ban [tm|ck] SKU:SL [SKU:SL …]\n" +
  "  /ban [khách/SĐT] SKU SL [SKU SL …] [tm|ck]\n" +
  "VD: /ban tm HP-1234:2\n" +
  "VD: /ban ck HP-1234:2 KB-1:1\n" +
  "VD: /ban HP-1234 2 (khách lẻ, tiền mặt)\n" +
  'VD: /ban "Nguyen Van A" HP-1234 2 KB-1 1 ck\n' +
  "tm = tiền mặt (TK 111, mặc định); ck = chuyển khoản (TK 112). Thu đủ ngay, giá đã gồm thuế.";
const NHAP_USAGE =
  'Cú pháp: /nhap &lt;NCC&gt; &lt;SKU&gt; &lt;SL&gt; &lt;giá nhập&gt; [số chứng từ]\nVD: /nhap "Cty Linh Kiện" HP-1234 5 4500000 HD0012\nGiá nhập = giá vốn mỗi cái (đã gồm thuế nếu hóa đơn mua có thuế). Nhập nhiều dòng hoặc có VAT: dùng web, mục Mua hàng.';
const BAOGIA_USAGE =
  "Cú pháp báo giá:\n" +
  "  /baogia — danh sách báo giá gần đây\n" +
  "  /baogia tao [khách/SĐT] SKU:SL [SKU:SL …] — tạo nháp\n" +
  'VD: /baogia tao "Cong ty ABC" HP-1234:2 KB-1:1\n' +
  "Chi tiết / sửa / gửi khách: " + "WEB_QUOTATIONS_PLACEHOLDER";
const WALKIN_WORDS = new Set(["le", "lẻ", "khachle", "khách lẻ", "khach le"]);
const METHOD_WORDS = new Map<string, "cash" | "bank">([
  ["tm", "cash"],
  ["cash", "cash"],
  ["ck", "bank"],
  ["bank", "bank"],
]);
const MONEY_KIND_LABEL: Record<string, string> = { cash: "Tiền mặt", bank: "Ngân hàng", ewallet: "Ví điện tử" };
const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  sent: "Đã gửi",
  approved: "Đã duyệt",
  rejected: "Từ chối",
};
const MAX_BAN_LINES = 20;
const MAX_QUOTE_LINES = 20;

type SkuQty = { sku: string; qty: number };

/** Expand SKU:qty tokens into flat [sku, qty, …] pairs. Exported for tests. */
export function expandSkuQtyTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (const tok of tokens) {
    const m = /^(.+):(\d{1,9})$/.exec(tok);
    if (m && parsePositiveInt(m[2]) !== null) {
      out.push(m[1], m[2]);
    } else {
      out.push(tok);
    }
  }
  return out;
}

/** Parse optional leading customer keyword + SKU/qty pairs (space or SKU:qty). Exported for tests. */
export function parseSkuQtyArgs(
  tokens: string[],
  usage: string,
  maxLines = MAX_BAN_LINES,
): { keyword: string | null; items: SkuQty[] } | { error: string } {
  const t = expandSkuQtyTokens(tokens);
  if (t.length < 2) return { error: usage };
  let keyword: string | null = null;
  const rest = [...t];
  if (rest.length % 2 === 1) {
    const k = rest.shift() as string;
    keyword = WALKIN_WORDS.has(k.toLowerCase()) ? null : k;
  }
  const items: SkuQty[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const qty = parsePositiveInt(rest[i + 1]);
    if (qty === null) {
      return { error: `Số lượng của <code>${esc(rest[i])}</code> phải là số nguyên &gt; 0.\n${usage}` };
    }
    items.push({ sku: rest[i], qty });
  }
  if (items.length === 0) return { error: usage };
  if (items.length > maxLines) return { error: `Tối đa ${maxLines} dòng hàng mỗi lần.` };
  return { keyword, items };
}

/** /ban arguments: optional leading/trailing tm|ck, optional customer, SKU/qty (space or SKU:qty). Exported for tests. */
export function parseBanArgs(
  tokens: string[],
): { keyword: string | null; items: SkuQty[]; method: "cash" | "bank" } | { error: string } {
  const t = [...tokens];
  let method: "cash" | "bank" = "cash";
  const first = (t[0] ?? "").toLowerCase();
  if (METHOD_WORDS.has(first)) {
    method = METHOD_WORDS.get(first)!;
    t.shift();
  }
  const last = (t[t.length - 1] ?? "").toLowerCase();
  if (METHOD_WORDS.has(last)) {
    method = METHOD_WORDS.get(last)!;
    t.pop();
  }
  const parsed = parseSkuQtyArgs(t, BAN_USAGE, MAX_BAN_LINES);
  if ("error" in parsed) return parsed;
  return { ...parsed, method };
}

type ProductRow = { id: string; sku: string; name: string; sell_price: number; stock_qty: number; min_stock: number };
type CustomerRow = { id: string; name: string; phone: string | null; type?: string };
type TicketRow = { code: string; title: string; status: string; sla_due_at: string | null; customers: { name: string } | { name: string }[] | null };
type MoneyBalRow = {
  account_id: string | null;
  kind: string;
  label: string;
  provider: string | null;
  gl_account: string;
  active: boolean;
  balance: number;
  unassigned: boolean;
};
type QuoteRow = {
  id: string;
  code: string;
  status: string;
  total: number;
  valid_until: string | null;
  created_at: string;
  customers: { name: string } | { name: string }[] | null;
};

async function resolveCustomer(
  sb: ReturnType<typeof getSupabase>,
  keyword: string | null,
  opts: { required?: boolean; allowWalkinHint?: string } = {},
): Promise<{ cust: CustomerRow | null } | { error: string }> {
  if (keyword === null) {
    if (opts.required) return { error: opts.allowWalkinHint ?? "Cần chọn khách hàng." };
    return { cust: null };
  }
  const filter = ilikeOr(["name", "phone"], keyword);
  if (!filter) return { error: "Từ khóa khách không hợp lệ." };
  const { data: custs, error: ce } = await sb
    .from("customers")
    .select("id, name, phone")
    .eq("is_walkin", false)
    .or(filter)
    .limit(3);
  if (ce) return { error: dbErrorMessage(ce.message) };
  const list = (custs ?? []) as CustomerRow[];
  if (list.length === 0) {
    return { error: `Không tìm thấy khách: <code>${esc(keyword)}</code>.${opts.allowWalkinHint ? ` ${opts.allowWalkinHint}` : ""}` };
  }
  const exact = list.filter((c) => c.phone === keyword || c.name.toLowerCase() === keyword.toLowerCase());
  const cust = exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
  if (!cust) {
    return {
      error:
        "Có nhiều khách phù hợp, hãy nhập rõ hơn (SĐT hoặc tên đầy đủ):\n" +
        list.map((c) => `• ${esc(c.name)} — ${esc(c.phone ?? "—")}`).join("\n"),
    };
  }
  return { cust };
}

async function loadProductsBySku(
  sb: ReturnType<typeof getSupabase>,
  items: SkuQty[],
): Promise<{ bySku: Map<string, ProductRow> } | { error: string }> {
  const skus = [...new Set(items.map((i) => i.sku))];
  const { data: prods, error: pe } = await sb
    .from("products")
    .select("id, sku, name, sell_price, stock_qty, min_stock")
    .in("sku", skus);
  if (pe) return { error: dbErrorMessage(pe.message) };
  const bySku = new Map(((prods ?? []) as ProductRow[]).map((p) => [p.sku, p]));
  for (const it of items) {
    if (!bySku.has(it.sku)) return { error: `Không tìm thấy SP: <code>${esc(it.sku)}</code>` };
  }
  return { bySku };
}

function baogiaUsage(): string {
  return BAOGIA_USAGE.replace("WEB_QUOTATIONS_PLACEHOLDER", appLink("/quotations"));
}

export function registerOwnerCommands(bot: Bot) {
  // /tien — số dư tài khoản tiền đang dùng (RPC money_balances, như web A4)
  bot.command("tien", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const { data, error } = await getSupabase().rpc("money_balances", { p_as_of: null });
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const rows = (Array.isArray(data) ? data : []) as MoneyBalRow[];
    const active = rows.filter((r) => r.active && !r.unassigned);
    const unassigned = rows.filter((r) => r.unassigned && Number(r.balance) !== 0);
    if (active.length === 0 && unassigned.length === 0) {
      return ctx.reply(`Chưa có tài khoản tiền. Thêm trên web ${appLink("/money")}`, HTML);
    }
    const byKind = new Map<string, MoneyBalRow[]>();
    for (const r of active) {
      const k = r.kind || "bank";
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(r);
    }
    const order = ["cash", "bank", "ewallet"];
    const sections: string[] = [];
    let total = 0;
    for (const kind of order) {
      const list = byKind.get(kind);
      if (!list?.length) continue;
      const lines = list.map((r) => {
        const bal = Number(r.balance);
        total += bal;
        const extra = [r.provider, r.gl_account ? `TK ${r.gl_account}` : null].filter(Boolean).join(" · ");
        return `• <b>${esc(r.label)}</b>${extra ? ` (${esc(extra)})` : ""} — <b>${fmtVND(bal)}</b>`;
      });
      sections.push(`<b>${esc(MONEY_KIND_LABEL[kind] ?? kind)}</b>\n` + lines.join("\n"));
    }
    for (const [, list] of byKind) {
      if (order.includes(list[0]?.kind)) continue;
      for (const r of list) {
        total += Number(r.balance);
        sections.push(`• <b>${esc(r.label)}</b> — <b>${fmtVND(Number(r.balance))}</b>`);
      }
    }
    if (unassigned.length) {
      sections.push(
        "<b>Chưa gán tài khoản</b>\n" +
          unassigned.map((r) => `• ${esc(r.label)} — ${fmtVND(Number(r.balance))}`).join("\n"),
      );
      for (const r of unassigned) total += Number(r.balance);
    }
    await ctx.reply(
      `💰 <b>Tiền &amp; Quỹ</b> (sống)\n\n` +
        sections.join("\n\n") +
        `\n\n<b>Tổng: ${fmtVND(total)}</b>\nChi tiết: ${appLink("/money")}`,
      HTML,
    );
  });

  // /ton [sku|query] — không arg: sắp hết + top tồn; có arg: tìm SP theo sku/tên
  bot.command("ton", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const kw = commandArgs(ctx.message?.text, "ton").trim();
    const sb = getSupabase();

    if (kw) {
      const filter = ilikeOr(["sku", "name"], kw);
      if (!filter) return ctx.reply("Cú pháp: /ton [sku hoặc tên SP]");
      const exact = await sb
        .from("products")
        .select("sku, name, stock_qty, min_stock, sell_price")
        .eq("sku", kw)
        .maybeSingle();
      if (exact.error) return ctx.reply(dbErrorMessage(exact.error.message));
      let list = exact.data ? [exact.data as ProductRow] : [];
      if (list.length === 0) {
        const { data, error } = await sb
          .from("products")
          .select("sku, name, stock_qty, min_stock, sell_price")
          .or(filter)
          .order("name")
          .limit(15);
        if (error) return ctx.reply(dbErrorMessage(error.message));
        list = (data ?? []) as ProductRow[];
      }
      if (list.length === 0) return ctx.reply(`Không tìm thấy SP: <code>${esc(kw)}</code>`, HTML);
      const lines = list.map(
        (p, i) =>
          `${i + 1}. <b>${esc(p.name)}</b> (${esc(p.sku)})\n   Tồn: <b>${p.stock_qty}</b> / tối thiểu ${p.min_stock} · Giá: ${fmtVND(Number(p.sell_price))}`,
      );
      return ctx.reply(`📦 <b>${list.length} sản phẩm:</b>\n\n` + lines.join("\n"), HTML);
    }

    const { data: lowData, error: lowErr } = await sb
      .from("low_stock_products")
      .select("sku, name, stock_qty, min_stock")
      .order("stock_qty", { ascending: true })
      .limit(50);
    if (lowErr) return ctx.reply(dbErrorMessage(lowErr.message));
    const low = (lowData ?? []) as Pick<ProductRow, "sku" | "name" | "stock_qty" | "min_stock">[];

    const { data: topData, error: topErr } = await sb
      .from("products")
      .select("sku, name, stock_qty, sell_price")
      .gt("stock_qty", 0)
      .order("stock_qty", { ascending: false })
      .limit(10);
    if (topErr) return ctx.reply(dbErrorMessage(topErr.message));
    const top = (topData ?? []) as Pick<ProductRow, "sku" | "name" | "stock_qty" | "sell_price">[];

    const parts: string[] = [];
    if (low.length === 0) {
      parts.push("✅ Tất cả sản phẩm đều đủ hàng (không dưới mức tối thiểu).");
    } else {
      parts.push(
        `⚠️ <b>${low.length} SP sắp hết:</b>\n` +
          low.map((p, i) => `${i + 1}. <b>${esc(p.name)}</b> (${esc(p.sku)}) — tồn: ${p.stock_qty} / tối thiểu: ${p.min_stock}`).join("\n"),
      );
    }
    if (top.length > 0) {
      parts.push(
        `📊 <b>Top tồn kho (${top.length}):</b>\n` +
          top
            .map(
              (p, i) =>
                `${i + 1}. <b>${esc(p.name)}</b> (${esc(p.sku)}) — <b>${p.stock_qty}</b> · ${fmtVND(Number(p.sell_price))}`,
            )
            .join("\n"),
      );
    }
    parts.push(`Tìm SP: /ton &lt;sku|tên&gt;`);
    await ctx.reply(parts.join("\n\n"), HTML);
  });

  // /nhap <NCC> <SKU> <SL> <giá nhập> [số chứng từ]
  bot.command("nhap", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const parts = parseArgs(commandArgs(ctx.message?.text, "nhap"));
    if (parts.length < 4 || parts.length > 5) return ctx.reply(NHAP_USAGE, HTML);
    const [supplierKw, sku, qtyRaw, costRaw, ref] = parts;
    const qty = parsePositiveInt(qtyRaw);
    if (qty === null) return ctx.reply("Số lượng phải là số nguyên > 0.");
    const unitCost = parseMoney(costRaw);
    if (unitCost === null || !(unitCost > 0)) return ctx.reply("Giá nhập không hợp lệ (phải > 0).");
    if (ref !== undefined && ref.length > 60) return ctx.reply("Số chứng từ tối đa 60 ký tự.");

    const sb = getSupabase();
    const filter = ilikeOr(["name", "phone"], supplierKw);
    if (!filter) return ctx.reply("Từ khóa nhà cung cấp không hợp lệ.");
    const { data: sups, error: se } = await sb.from("suppliers").select("id, name, phone").or(filter).limit(4);
    if (se) return ctx.reply(dbErrorMessage(se.message));
    const slist = (sups ?? []) as Array<{ id: string; name: string; phone: string | null }>;
    if (slist.length === 0) {
      return ctx.reply(
        `Không tìm thấy nhà cung cấp: <code>${esc(supplierKw)}</code>. Thêm NCC trên web ${appLink("/suppliers/new")} rồi nhập lại.`,
        HTML,
      );
    }
    const exact = slist.filter((x) => x.phone === supplierKw || x.name.toLowerCase() === supplierKw.toLowerCase());
    const sup = exact.length === 1 ? exact[0] : slist.length === 1 ? slist[0] : null;
    if (!sup) {
      return ctx.reply(
        "Có nhiều nhà cung cấp phù hợp, hãy nhập rõ hơn (SĐT hoặc tên đầy đủ):\n" +
          slist.map((x) => `• ${esc(x.name)} — ${esc(x.phone ?? "—")}`).join("\n"),
        HTML,
      );
    }

    const { data: prod, error: pe } = await sb.from("products").select("id, name, stock_qty").eq("sku", sku).maybeSingle();
    if (pe) return ctx.reply(dbErrorMessage(pe.message));
    if (!prod) return ctx.reply(`Không tìm thấy SP với SKU <code>${esc(sku)}</code>`, HTML);

    const { data, error } = await sb.rpc("post_purchase_bill", {
      p_supplier_id: sup.id,
      p_bill_date: vnDate(),
      p_due_date: null,
      p_lines: [{ product_id: prod.id, qty, unit_cost: unitCost, vat_rate: 0 }],
      p_supplier_ref: ref ?? null,
      p_memo: `Nhập qua Telegram bot (${u.name ?? u.id})`,
    });
    if (error) {
      if (/uq_pb_supplier_ref|23505/.test(error.message)) return ctx.reply("Số chứng từ của nhà cung cấp này đã được nhập trước đó.");
      return ctx.reply(dbErrorMessage(error.message));
    }
    const r = (data ?? {}) as { bill_id?: string; bill_no?: string; total?: number };
    if (!r.bill_id) return ctx.reply("Không nhận được mã phiếu từ hệ thống, hãy kiểm tra trên web trước khi nhập lại.");
    await ctx.reply(
      `✅ Phiếu mua <b>${esc(r.bill_no)}</b> — nhập <b>${qty}</b> ${esc(prod.name)} (${esc(sku)})\nNhà cung cấp: ${esc(sup.name)}${ref ? ` · chứng từ ${esc(ref)}` : ""}\n` +
        `Tổng: <b>${fmtVND(Number(r.total ?? qty * unitCost))}</b> (giá vốn, ghi công nợ nhà cung cấp)\nChi tiền / hủy phiếu: ${appLink(`/purchases/${r.bill_id}`)}`,
      HTML,
    );
  });

  // /ban — bán nhanh HKD (post_sale_hkd), hỗ trợ SKU:SL và tm|ck đầu/cuối
  bot.command("ban", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const parsed = parseBanArgs(parseArgs(commandArgs(ctx.message?.text, "ban")));
    if ("error" in parsed) return ctx.reply(parsed.error, HTML);
    const { keyword, items, method } = parsed;

    const sb = getSupabase();
    const custRes = await resolveCustomer(sb, keyword, {
      allowWalkinHint: "Bỏ trống tên khách để bán cho Khách lẻ.",
    });
    if ("error" in custRes) return ctx.reply(custRes.error, HTML);
    const cust = custRes.cust;

    const prodRes = await loadProductsBySku(sb, items);
    if ("error" in prodRes) return ctx.reply(prodRes.error, HTML);
    const { bySku } = prodRes;

    const need = new Map<string, number>();
    for (const it of items) need.set(it.sku, (need.get(it.sku) ?? 0) + it.qty);
    for (const [sku, qty] of need) {
      const p = bySku.get(sku)!;
      if (p.stock_qty < qty) return ctx.reply(`Tồn không đủ cho ${esc(p.name)} (còn ${p.stock_qty}, cần ${qty}).`, HTML);
    }

    const lines = items.map((it) => ({
      product_id: bySku.get(it.sku)!.id,
      qty: it.qty,
      unit_price: Number(bySku.get(it.sku)!.sell_price),
    }));
    const total = Math.round(lines.reduce((a, l) => a + l.qty * l.unit_price, 0) * 100) / 100;
    if (!(total > 0)) return ctx.reply("Tổng tiền phải lớn hơn 0 (kiểm tra giá bán của sản phẩm).");

    const memo = `Bán qua Telegram bot (${u.name ?? u.id})`;
    const { data, error } = await sb.rpc("post_sale_hkd", {
      p_customer_id: cust?.id ?? null,
      p_date: vnDate(),
      p_lines: lines,
      p_payments: [{ method, amount: total, note: "Thu ngay qua bot" }],
      p_channel: "store",
      p_location_id: null,
      p_buyer: null,
      p_memo: memo,
      p_due_date: null,
      p_einvoice: null,
      p_allow_over_limit: false,
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

  // /baogia — list recent / create draft via save_quotation
  bot.command("baogia", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const raw = commandArgs(ctx.message?.text, "baogia").trim();
    const sb = getSupabase();

    if (!raw || raw.toLowerCase() === "list" || raw.toLowerCase() === "ds") {
      const { data, error } = await sb
        .from("quotations")
        .select("id, code, status, total, valid_until, created_at, customers(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return ctx.reply(dbErrorMessage(error.message));
      const list = (data ?? []) as unknown as QuoteRow[];
      if (list.length === 0) {
        return ctx.reply(
          `Chưa có báo giá. Tạo nháp: /baogia tao [khách] SKU:SL …\nHoặc web ${appLink("/quotations")}`,
          HTML,
        );
      }
      const lines = list.map((q, i) => {
        const cn = Array.isArray(q.customers) ? q.customers[0]?.name : q.customers?.name;
        const st = QUOTE_STATUS_LABEL[q.status] ?? q.status;
        return `${i + 1}. <b>${esc(q.code)}</b> [${esc(st)}] — ${esc(cn ?? "—")} · ${fmtVND(Number(q.total))}\n   ${appLink(`/quotations/${q.id}`)}`;
      });
      return ctx.reply(
        `📋 <b>${list.length} báo giá gần đây:</b>\n\n` +
          lines.join("\n") +
          `\n\nTạo nháp: /baogia tao [khách] SKU:SL …\nWeb: ${appLink("/quotations")}`,
        HTML,
      );
    }

    const parts = parseArgs(raw);
    const head = (parts[0] ?? "").toLowerCase();
    if (head !== "tao" && head !== "new" && head !== "create") {
      return ctx.reply(baogiaUsage(), HTML);
    }
    const body = parts.slice(1);
    const parsed = parseSkuQtyArgs(body, baogiaUsage(), MAX_QUOTE_LINES);
    if ("error" in parsed) return ctx.reply(parsed.error, HTML);

    // Báo giá nên có khách; vẫn cho phép bỏ trống (nháp không khách) như web.
    const custRes = await resolveCustomer(sb, parsed.keyword, {
      allowWalkinHint: "Hoặc bỏ tên khách để tạo nháp không gắn khách.",
    });
    if ("error" in custRes) return ctx.reply(custRes.error, HTML);

    const prodRes = await loadProductsBySku(sb, parsed.items);
    if ("error" in prodRes) return ctx.reply(prodRes.error, HTML);
    const { bySku } = prodRes;

    const rpcItems = parsed.items.map((it) => {
      const p = bySku.get(it.sku)!;
      return {
        product_id: p.id,
        qty: it.qty,
        unit_price: Number(p.sell_price),
        discount: 0,
        notes: null as string | null,
      };
    });
    const preview = Math.round(rpcItems.reduce((a, l) => a + l.qty * l.unit_price, 0) * 100) / 100;
    if (!(preview > 0)) return ctx.reply("Tổng báo giá phải lớn hơn 0 (kiểm tra giá bán).");

    const validUntil = addDaysYmd(vnDate(), 30);
    const notes = `Tạo qua Telegram bot (${u.name ?? u.id})`;
    let lastError = "";
    let saved: { id?: string; code?: string; total?: number } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode("BG");
      const { data, error } = await sb.rpc("save_quotation", {
        p_id: null,
        p_code: code,
        p_customer_id: custRes.cust?.id ?? null,
        p_status: "draft",
        p_valid_until: validUntil,
        p_notes: notes,
        p_discount: 0,
        p_vat_rate: 0,
        p_items: rpcItems,
      });
      if (!error) {
        saved = { ...(data as object), code: (data as { code?: string } | null)?.code ?? code } as {
          id?: string;
          code?: string;
          total?: number;
        };
        break;
      }
      lastError = error.message;
      if (error.code !== "23505" && !/duplicate|unique/i.test(error.message)) break;
    }
    if (!saved?.id) return ctx.reply(dbErrorMessage(lastError || "Không tạo được báo giá"));

    const detail = parsed.items.map((it) => `${esc(bySku.get(it.sku)!.name)} × ${it.qty}`).join("\n");
    await ctx.reply(
      `✅ Báo giá nháp <b>${esc(saved.code ?? "")}</b>\nKhách: ${esc(custRes.cust?.name ?? "—")}\n${detail}\n` +
        `Tổng: <b>${fmtVND(Number(saved.total ?? preview))}</b> (giá đã gồm thuế, VAT 0)\nHiệu lực đến: ${esc(validUntil)}\n` +
        `Sửa / gửi khách: ${appLink(`/quotations/${saved.id}`)}`,
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
    const lines = list.map(
      (c, i) =>
        `${i + 1}. <b>${esc(c.name)}</b> (${c.type === "business" ? "DN" : "lẻ"}) — ${esc(c.phone ?? "—")}\n   ${appLink(`/customers/${c.id}`)}`,
    );
    await ctx.reply(`🔍 <b>${list.length} kết quả:</b>\n\n` + lines.join("\n"), HTML);
  });

  // /baotri — ticket đến hạn SLA trong 7 ngày tới
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

  // /doanhthu YYYY-MM
  bot.command("doanhthu", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const range = monthRange(commandArgs(ctx.message?.text, "doanhthu"));
    if (!range) return ctx.reply("Cú pháp: /doanhthu YYYY-MM (tháng 1–12, vd: 2026-06)");
    const { data, error } = await getSupabase().rpc("report_monthly_pnl", { p_from: range.from, p_to: range.to });
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const row = (Array.isArray(data) ? data : []).find((r: { month: string }) => String(r.month).startsWith(range.key)) as
      | { revenue: number; cogs: number; gross_profit: number }
      | undefined;
    const rev = Number(row?.revenue ?? 0),
      cogs = Number(row?.cogs ?? 0);
    await ctx.reply(
      `📊 Doanh thu <b>${range.key}</b> (sổ cái)\nDoanh thu: <b>${fmtVND(rev)}</b>\nGiá vốn: ${fmtVND(cogs)}\nLãi gộp: <b>${fmtVND(rev - cogs)}</b>`,
      HTML,
    );
  });

  // /top — top 10 SP 30 ngày
  bot.command("top", async (ctx: Context) => {
    const u = await authenticateOwner(ctx);
    if (!u) return ctx.reply(DENIED);
    const to = vnDate();
    const { data, error } = await getSupabase().rpc("report_top_products", {
      p_from: addDaysYmd(to, -29),
      p_to: to,
      p_limit: 10,
    });
    if (error) return ctx.reply(dbErrorMessage(error.message));
    const top = (Array.isArray(data) ? data : []) as Array<{ name: string | null; qty: number; revenue: number }>;
    if (top.length === 0) return ctx.reply("Chưa có dữ liệu bán hàng trong 30 ngày qua.");
    const lines = top.map((t, i) => `${i + 1}. <b>${esc(t.name ?? "—")}</b> — ${t.qty} cái — ${fmtVND(Number(t.revenue))}`);
    await ctx.reply("🏆 <b>Top 10 SP bán chạy (30 ngày):</b>\n\n" + lines.join("\n"), HTML);
  });
}
