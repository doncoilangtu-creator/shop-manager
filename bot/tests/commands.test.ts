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
      ["ban", "baotri", "doanhthu", "hopdong", "khach", "nhap", "start", "ticket", "ton", "top", "yeucaubt"].sort(),
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
  it.each(["ton", "nhap", "ban", "khach", "baotri", "doanhthu", "top"])(
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
  it("/ton reads the low_stock_products view and HTML-escapes names", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const { q, calls } = makeQuery({ data: [{ sku: "A", name: "Low <b>x</b>", stock_qty: 1, min_stock: 5 }], error: null });
    const from = vi.fn(() => q);
    getSupabase.mockReturnValue({ from });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 1, text: "/ton" });
    await handlers.get("ton")!(ctx);
    expect(from).toHaveBeenCalledWith("low_stock_products");
    expect(calls.some((c) => c.method === "filter")).toBe(false);
    expect(replies[0].text).toContain("Low &lt;b&gt;x&lt;/b&gt;");
  });

  it("/ton reports when the view is empty", async () => {
    authenticateOwner.mockResolvedValue({ role: "owner" });
    const { q } = makeQuery({ data: [], error: null });
    getSupabase.mockReturnValue({ from: () => q });
    const { bot, handlers } = makeFakeBot();
    registerOwnerCommands(bot);
    const { ctx, replies } = makeCtx({ chatId: 1, text: "/ton" });
    await handlers.get("ton")!(ctx);
    expect(replies[0].text).toContain("đủ hàng");
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
