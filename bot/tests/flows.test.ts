/**
 * End-to-end through a REAL grammY Bot: update -> command pipeline -> handlers -> fake supabase + fake Telegram transport.
 * Not exercised: the real Telegram API and a real Supabase (see README).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachFakeTelegram, BOT_INFO, commandUpdate, makeFakeSupabase } from "./fakes";

let fake: ReturnType<typeof makeFakeSupabase>;
vi.mock("../src/lib/supabase", () => ({ getSupabase: () => fake.sb, appLink: (p: string) => `https://app.test${p}` }));

import { Bot } from "grammy";
import { buildBot } from "../src/index";

const OWNER = { id: "u-owner", chat_id: "1", role: "owner", customer_id: null, name: "Chủ" };
const CUST = { id: "u-c", chat_id: "2", role: "customer", customer_id: "cust-1", name: "Lan <i>" };

type U = typeof OWNER | typeof CUST;
/** `bot_users` is queried twice: by chat id (login) and for the owner list (notifications). Distinguish by the filters used. */
function botUsersTable(user: U, owners: Array<{ telegram_chat_id: string }> = []) {
  return (calls: Array<{ method: string; args: unknown[] }>) =>
    calls.some((c) => c.method === "eq" && c.args[0] === "telegram_chat_id")
      ? { data: [{ id: user.id, telegram_chat_id: user.chat_id, role: user.role, customer_id: user.customer_id, name: user.name }], error: null }
      : { data: owners, error: null };
}
async function run(text: string, chatId: number, user: U, owners: Array<{ telegram_chat_id: string }> = []) {
  fake.tables.bot_users = botUsersTable(user, owners);
  const bot = buildBot("123:ABC") as Bot;
  bot.botInfo = BOT_INFO;
  const sent = attachFakeTelegram(bot);
  await bot.handleUpdate(commandUpdate(chatId, text) as never);
  return sent;
}
const texts = (sent: Awaited<ReturnType<typeof run>>) => sent.filter((s) => s.method === "sendMessage").map((s) => String(s.payload.text));



describe("owner flows", () => {
  it("/nhap books stock via the stock_adjust RPC and NEVER writes products/stock_movements directly", async () => {
    fake = makeFakeSupabase({
      tables: { products: { data: [{ id: "p1", name: "SSD <1TB>", stock_qty: 3 }], error: null } },
      rpcs: { stock_adjust: { data: { movement_id: "m1", stock_qty: 8 }, error: null } },
    });
    const out = texts(await run("/nhap HP-1 5 4500000", 1, OWNER));
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].fn).toBe("stock_adjust");
    expect(fake.rpcCalls[0].args).toMatchObject({ p_product_id: "p1", p_type: "in", p_qty: 5, p_unit_cost: 4500000 });
    expect(fake.writes()).toEqual([]);
    expect(out[0]).toContain("SSD &lt;1TB&gt;");
    expect(out[0]).toContain("Tồn mới: <b>8</b>");
  });

  it("/nhap maps DB errors to a safe message (raw error is not echoed)", async () => {
    fake = makeFakeSupabase({
      tables: { products: { data: [{ id: "p1", name: "X", stock_qty: 0 }], error: null } },
      rpcs: { stock_adjust: { data: null, error: { message: 'new row violates check constraint "secret_internal_name"' } } },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = texts(await run("/nhap HP-1 5", 1, OWNER));
    expect(out[0]).toContain("Có lỗi hệ thống");
    expect(out[0]).not.toContain("secret_internal_name");
  });

  it('/ban "Nguyen Van A" posts a sales invoice through post_sales_invoice (no direct stock or quotation writes)', async () => {
    fake = makeFakeSupabase({
      tables: {
        customers: { data: [{ id: "c1", name: "Nguyen Van A", phone: "0901" }], error: null },
        products: { data: [{ id: "p1", name: "Chuột", sell_price: 250000, stock_qty: 10 }], error: null },
      },
      rpcs: { post_sales_invoice: { data: { invoice_id: "i1", invoice_no: "INV-2026-00001", total: 500000 }, error: null } },
    });
    const out = texts(await run('/ban "Nguyen Van A" HP-1234 2', 1, OWNER));
    const call = fake.rpcCalls[0];
    expect(call.fn).toBe("post_sales_invoice");
    expect(call.args).toMatchObject({ p_customer_id: "c1", p_lines: [{ product_id: "p1", qty: 2, unit_price: 250000, vat_rate: 0 }] });
    expect(String(call.args.p_invoice_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(call.args.p_due_date) >= String(call.args.p_invoice_date)).toBe(true);
    expect(fake.writes()).toEqual([]);
    expect(out[0]).toContain("INV-2026-00001");
  });

  it("/ban sanitises the customer keyword before building the PostgREST .or() filter", async () => {
    fake = makeFakeSupabase({ tables: { customers: { data: [], error: null } } });
    await run('/ban "a,id.eq.1)" HP-1 1', 1, OWNER);
    const q = fake.queries.find((x) => x.table === "customers")!;
    const or = q.calls.find((c) => c.method === "or")!.args[0] as string;
    expect(or).toBe("name.ilike.%a id.eq.1%,phone.ilike.%a id.eq.1%");
  });

  it("/ban asks for clarification when several customers match", async () => {
    fake = makeFakeSupabase({ tables: { customers: { data: [{ id: "1", name: "Lan A", phone: "1" }, { id: "2", name: "Lan B", phone: "2" }], error: null } } });
    const out = texts(await run("/ban Lan HP-1 1", 1, OWNER));
    expect(out[0]).toContain("nhiều khách");
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("/ban reports insufficient stock from the RPC", async () => {
    fake = makeFakeSupabase({
      tables: { customers: { data: [{ id: "c1", name: "A", phone: "1" }], error: null }, products: { data: [{ id: "p1", name: "X", sell_price: 1, stock_qty: 1 }], error: null } },
      rpcs: { post_sales_invoice: { data: null, error: { message: "insufficient_stock: HP-1 (have 1, need 5)" } } },
    });
    const out = texts(await run("/ban A HP-1 5", 1, OWNER));
    expect(out[0]).toContain("Tồn không đủ (còn 1)");
  });

  it("/doanhthu rejects month 13 and queries the GL report for a valid month", async () => {
    fake = makeFakeSupabase({ rpcs: { report_monthly_pnl: { data: [{ month: "2026-06-01", revenue: 1500000, cogs: 1000000, gross_profit: 500000 }], error: null } } });
    expect(texts(await run("/doanhthu 2026-13", 1, OWNER))[0]).toContain("Cú pháp");
    expect(fake.rpcCalls).toHaveLength(0);
    const out = texts(await run("/doanhthu 2026-06", 1, OWNER));
    expect(fake.rpcCalls[0]).toEqual({ fn: "report_monthly_pnl", args: { p_from: "2026-06-01", p_to: "2026-06-30" } });
    expect(out[0]).toContain("1.500.000");
    expect(out[0]).toContain("500.000");
  });

  it("/top aggregates in SQL (report_top_products), not by summing 200 rows in JS", async () => {
    fake = makeFakeSupabase({ rpcs: { report_top_products: { data: [{ name: "A & B", qty: 4, revenue: 400000 }], error: null } } });
    const out = texts(await run("/top", 1, OWNER));
    expect(fake.rpcCalls[0].fn).toBe("report_top_products");
    expect(fake.rpcCalls[0].args).toMatchObject({ p_limit: 10 });
    expect(out[0]).toContain("A &amp; B");
  });

  it("customers cannot run owner commands", async () => {
    fake = makeFakeSupabase({});
    const out = texts(await run("/nhap HP-1 5", 2, CUST));
    expect(out[0]).toContain("⛔");
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("customer flows", () => {
  it("/yeucaubt compares end_date with a DATE, defaults SLA to 24h when null, escapes the owner notification", async () => {
    fake = makeFakeSupabase({
      tables: {
        maintenance_contracts: { data: [{ id: "k1", code: "HD-1", sla_hours: null }], error: null },
        maintenance_tickets: { data: { id: "t1" }, error: null },
        notifications: { data: null, error: null },
      },
    });
    const sent = await run("/yeucaubt Máy <script>hỏng</script> & treo", 2, CUST, [{ telegram_chat_id: "99" }]);
    const contractQ = fake.queries.find((q) => q.table === "maintenance_contracts")!;
    const gte = contractQ.calls.find((c) => c.method === "gte")!;
    expect(gte.args[0]).toBe("end_date");
    expect(String(gte.args[1])).toMatch(/^\d{4}-\d{2}-\d{2}$/);          // a date, not an ISO timestamp
    const ins = fake.queries.find((q) => q.table === "maintenance_tickets")!.calls.find((c) => c.method === "insert")!.args[0] as Record<string, any>;
    expect(ins.code).toMatch(/^TK-\d{8}-[0-9A-Z]{8}$/);
    const hours = (new Date(ins.sla_due_at).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9); expect(hours).toBeLessThan(24.1);
    const ownerMsg = sent.find((s) => String(s.payload.chat_id) === "99")!;
    expect(String(ownerMsg.payload.text)).toContain("&lt;script&gt;");
    expect(String(ownerMsg.payload.text)).not.toContain("<script>");
    expect(String(ownerMsg.payload.text)).toContain("Lan &lt;i&gt;");
  });

  it("/yeucaubt retries on a unique-code collision (23505) but not on other errors", async () => {
    let n = 0;
    fake = makeFakeSupabase({
      tables: {
        maintenance_contracts: { data: [{ id: "k1", code: "HD-1", sla_hours: 8 }], error: null },
        maintenance_tickets: () => (++n < 3 ? { data: null, error: { message: "dup", code: "23505" } } : { data: { id: "t1" }, error: null }),
        notifications: { data: null, error: null },
      },
    });
    const out = texts(await run("/yeucaubt hỏng", 2, CUST));
    expect(n).toBe(3);
    expect(out[0]).toContain("Đã tạo yêu cầu");
    expect(out[0]).toContain("8h");

    n = 0; vi.spyOn(console, "error").mockImplementation(() => {});
    fake = makeFakeSupabase({
      tables: { maintenance_contracts: { data: [{ id: "k1", sla_hours: 8 }], error: null }, maintenance_tickets: () => { n++; return { data: null, error: { message: "boom", code: "42501" } }; } },
    });
    const out2 = texts(await run("/yeucaubt hỏng", 2, CUST));
    expect(n).toBe(1);
    expect(out2[0]).toContain("Có lỗi hệ thống");
  });

  it("/yeucaubt without an active contract creates nothing", async () => {
    fake = makeFakeSupabase({ tables: { maintenance_contracts: { data: [], error: null } } });
    const out = texts(await run("/yeucaubt hỏng", 2, CUST));
    expect(out[0]).toContain("chưa có hợp đồng");
    expect(fake.writes()).toEqual([]);
  });

  it("/ticket tolerates a null SLA and shows VN labels", async () => {
    fake = makeFakeSupabase({ tables: { maintenance_tickets: { data: [{ code: "TK-1", title: "T <x>", status: "in_progress", priority: "high", sla_due_at: null, created_at: "2026-09-30T18:30:00Z" }], error: null } } });
    const out = texts(await run("/ticket TK-1", 2, CUST));
    expect(out[0]).toContain("Đang xử lý");
    expect(out[0]).toContain("SLA: —");
    expect(out[0]).toContain("T &lt;x&gt;");
    expect(out[0]).not.toContain("Invalid Date");
    expect(out[0]).toMatch(/01\/10\/2026|1\/10\/2026/);       // 01:30 on 1 Oct in VN, not 30 Sep (UTC)
  });

  it("/ticket only looks up the caller's own tickets", async () => {
    fake = makeFakeSupabase({ tables: { maintenance_tickets: { data: [], error: null } } });
    await run("/ticket TK-9", 2, CUST);
    const q = fake.queries.find((x) => x.table === "maintenance_tickets")!;
    expect(q.calls).toContainEqual({ method: "eq", args: ["customer_id", "cust-1"] });
  });
});
