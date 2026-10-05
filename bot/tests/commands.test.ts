import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, makeFakeBot, makeQuery } from "./helpers";

const findBotUser = vi.fn();
const authenticateOwner = vi.fn();
const authenticateCustomer = vi.fn();
vi.mock("../src/lib/auth", () => ({
  findBotUser: (...a: unknown[]) => findBotUser(...a),
  authenticateOwner: (...a: unknown[]) => authenticateOwner(...a),
  authenticateCustomer: (...a: unknown[]) => authenticateCustomer(...a),
}));

const getSupabase = vi.fn();
vi.mock("../src/lib/supabase", () => ({
  getSupabase: () => getSupabase(),
  appLink: (p: string) => `https://app.test${p}`,
}));

import { registerStartCommand } from "../src/commands/start";
import { registerOwnerCommands } from "../src/commands/owner";
import { registerCustomerCommands } from "../src/commands/customer";

beforeEach(() => {
  findBotUser.mockReset();
  authenticateOwner.mockReset();
  authenticateCustomer.mockReset();
  getSupabase.mockReset();
});

describe("command registration", () => {
  it("registers the documented command set", () => {
    const { bot, handlers } = makeFakeBot();
    registerStartCommand(bot);
    registerOwnerCommands(bot);
    registerCustomerCommands(bot);
    expect([...handlers.keys()].sort()).toEqual(
      ["ban", "baogia", "baotri", "doanhthu", "hopdong", "khach", "nhap", "start", "ticket", "tien", "ton", "top", "yeucaubt"].sort(),
    );
  });
});

describe("/start", () => {
  const run = async () => {
    const { bot, handlers } = makeFakeBot();
    registerStartCommand(bot);
    return handlers.get("start")!;
  };

  it("tells unregistered users their chat id", async () => {
    findBotUser.mockResolvedValue(null);
    const { ctx, replies } = makeCtx({ chatId: 4242 });
    await (await run())(ctx);
    expect(replies[0].text).toContain("4242");
    expect(replies[0].text).toContain("chưa được đăng ký");
  });

  it("shows owner help for owners", async () => {
    findBotUser.mockResolvedValue({ role: "owner", name: null });
    const { ctx, replies } = makeCtx({ chatId: 1 });
    await (await run())(ctx);
    expect(replies[0].text).toContain("/doanhthu");
    expect(replies[0].text).toContain("/tien");
    expect(replies[0].text).toContain("/baogia");
  });

  it("greets customers by name and shows customer help", async () => {
    findBotUser.mockResolvedValue({ role: "customer", name: "Lan" });
    const { ctx, replies } = makeCtx({ chatId: 2 });
    await (await run())(ctx);
    expect(replies[0].text).toContain("Lan");
    expect(replies[0].text).toContain("/hopdong");
  });
});

describe("owner commands: authorization", () => {
  it.each(["ton", "nhap", "ban", "tien", "baogia", "khach", "baotri", "doanhthu", "top"])(
    "/%s is denied (and never touches the DB) for non-owners",
    async (name) => {
      authenticateOwner.mockResolvedValue(null);
      const { bot, handlers } = makeFakeBot();
      registerOwnerCommands(bot);
      const { ctx, replies } = makeCtx({ chatId: 9, text: `/${name} x 1` });
      await handlers.get(name)!(ctx);
      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain("⛔");
      expect(getSupabase).not.toHaveBeenCalled();
    },
  );
});

describe("owner commands: behaviour", () => {
  it("/ton reads low_stock + top in-stock and HTML-escapes names", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const low = makeQuery({ data: [{ sku: "A", name: "Low <b>x</b>", stock_qty: 1, min_stock: 5 }], error: null });
    const top = makeQuery({ data: [{ sku: "B", name: "Top <i>y</i>", stock_qty: 99, sell_price: 1000 }], error: null });
    const from = vi.fn((table: string) => (table === "low_stock_products" ? low.q : top.q));
    getSupabase.mockReturnValue({ from });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 1, text: "/ton" });
    await handlers.get("ton")!(ctx);
    expect(from).toHaveBeenCalledWith("low_stock_products");
    expect(from).toHaveBeenCalledWith("products");
    expect(replies[0].text).toContain("Low &lt;b&gt;x&lt;/b&gt;");
    expect(replies[0].text).toContain("Top &lt;i&gt;y&lt;/i&gt;");
  });

  it("/ton reports when low-stock view is empty but still shows top stock", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const low = makeQuery({ data: [], error: null });
    const top = makeQuery({ data: [{ sku: "B", name: "Full", stock_qty: 5, sell_price: 100 }], error: null });
    const from = vi.fn((table: string) => (table === "low_stock_products" ? low.q : top.q));
    getSupabase.mockReturnValue({ from });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 1, text: "/ton" });
    await handlers.get("ton")!(ctx);
    expect(replies[0].text).toContain("đủ hàng");
    expect(replies[0].text).toContain("Top tồn kho");
  });

  it("/ton with query searches products by sku/name", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const exact = makeQuery({ data: null, error: null }); // maybeSingle empty
    // First from("products") is exact sku maybeSingle; second is or-search
    let n = 0;
    const search = makeQuery({
      data: [{ sku: "HP-1", name: "Chuột <x>", stock_qty: 3, min_stock: 1, sell_price: 250000 }],
      error: null,
    });
    const from = vi.fn(() => {
      n += 1;
      return n === 1 ? exact.q : search.q;
    });
    getSupabase.mockReturnValue({ from });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 1, text: "/ton chuột" });
    await handlers.get("ton")!(ctx);
    expect(replies[0].text).toContain("Chuột &lt;x&gt;");
    expect(replies[0].text).toContain("250.000");
  });

  it("/tien calls money_balances and lists active accounts", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const rpc = vi.fn(async () => ({
      data: [
        { account_id: "a1", kind: "cash", label: "Tiền mặt quầy", provider: null, gl_account: "111", active: true, balance: 56567000, unassigned: false },
        { account_id: "a2", kind: "bank", label: "VCB", provider: "Vietcombank", gl_account: "112", active: true, balance: 238430000, unassigned: false },
        { account_id: "a3", kind: "ewallet", label: "MoMo", provider: "MoMo", gl_account: "112", active: true, balance: 11980000, unassigned: false },
        { account_id: null, kind: "cash", label: "Chưa gán", provider: null, gl_account: "111", active: true, balance: 0, unassigned: true },
      ],
      error: null,
    }));
    getSupabase.mockReturnValue({ rpc, from: vi.fn() });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 1, text: "/tien" });
    await handlers.get("tien")!(ctx);
    expect(rpc).toHaveBeenCalledWith("money_balances", { p_as_of: null });
    expect(replies[0].text).toContain("Tiền mặt");
    expect(replies[0].text).toContain("VCB");
    expect(replies[0].text).toContain("MoMo");
    expect(replies[0].text).toContain("56.567.000");
  });

  it("/nhap validates arguments before hitting the DB", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);

    for (const [text, expected] of [
      ["/nhap HP-1", "Cú pháp"],
      ["/nhap HP-1 2 100", "Cú pháp"],
      ["/nhap NCC HP-1 0 100", "Số lượng phải là số nguyên > 0"],
      ["/nhap NCC HP-1 abc 100", "Số lượng phải là số nguyên > 0"],
      ["/nhap NCC HP-1 2.5 100", "Số lượng phải là số nguyên > 0"],
      ["/nhap NCC HP-1 2 -5", "Giá nhập không hợp lệ"],
      ["/nhap NCC HP-1 2 0", "Giá nhập không hợp lệ"],
    ] as const) {
      const { ctx, replies } = makeCtx({ chatId: 1, text });
      await handlers.get("nhap")!(ctx);
      expect(replies[0].text).toContain(expected);
    }
    expect(getSupabase).not.toHaveBeenCalled();
  });
});

describe("customer commands: authorization", () => {
  it.each(["hopdong", "yeucaubt", "ticket"])("/%s is denied for non-customers", async (name) => {
    authenticateCustomer.mockResolvedValue(null);
    const { bot, handlers } = makeFakeBot();
    registerCustomerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 9, text: `/${name} x` });
    await handlers.get(name)!(ctx);
    expect(replies).toHaveLength(1);
    expect(getSupabase).not.toHaveBeenCalled();
  });
});
