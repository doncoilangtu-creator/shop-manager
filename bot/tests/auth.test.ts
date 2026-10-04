import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, makeQuery } from "./helpers";

const getSupabase = vi.fn();
vi.mock("../src/lib/supabase", () => ({ getSupabase: () => getSupabase() }));

import { authenticateCustomer, authenticateOwner, findBotUser } from "../src/lib/auth";

function mockUser(data: unknown, error: { message: string } | null = null) {
  const { q, calls } = makeQuery({ data, error });
  const from = vi.fn(() => q);
  getSupabase.mockReturnValue({ from });
  return { from, calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("findBotUser", () => {
  it("looks up an active bot_user by stringified chat id", async () => {
    const row = { id: "1", role: "owner", customer_id: null, name: "A" };
    const { from, calls } = mockUser(row);
    await expect(findBotUser(12345)).resolves.toEqual(row);
    expect(from).toHaveBeenCalledWith("bot_users");
    expect(calls).toContainEqual({ method: "eq", args: ["telegram_chat_id", "12345"] });
    expect(calls).toContainEqual({ method: "eq", args: ["active", true] });
  });

  it("returns null when no row matches", async () => {
    mockUser(null);
    await expect(findBotUser(1)).resolves.toBeNull();
  });

  it("returns null (and logs) on a database error", async () => {
    mockUser(null, { message: "boom" });
    await expect(findBotUser(1)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("authenticateOwner", () => {
  it("rejects when the context has no chat id", async () => {
    const { ctx } = makeCtx({});
    await expect(authenticateOwner(ctx as any)).resolves.toBeNull();
  });

  it("accepts an owner", async () => {
    mockUser({ id: "1", role: "owner", customer_id: null, name: null });
    const { ctx } = makeCtx({ chatId: 7 });
    await expect(authenticateOwner(ctx as any)).resolves.toMatchObject({ role: "owner" });
  });

  it("rejects a customer", async () => {
    mockUser({ id: "2", role: "customer", customer_id: "c1", name: null });
    const { ctx } = makeCtx({ chatId: 7 });
    await expect(authenticateOwner(ctx as any)).resolves.toBeNull();
  });
});

describe("authenticateCustomer", () => {
  it("accepts a customer linked to a customer record", async () => {
    mockUser({ id: "2", role: "customer", customer_id: "c1", name: null });
    const { ctx } = makeCtx({ chatId: 7 });
    await expect(authenticateCustomer(ctx as any)).resolves.toMatchObject({ customer_id: "c1" });
  });

  it("rejects a customer without customer_id", async () => {
    mockUser({ id: "2", role: "customer", customer_id: null, name: null });
    const { ctx } = makeCtx({ chatId: 7 });
    await expect(authenticateCustomer(ctx as any)).resolves.toBeNull();
  });

  it("rejects an owner", async () => {
    mockUser({ id: "1", role: "owner", customer_id: null, name: null });
    const { ctx } = makeCtx({ chatId: 7 });
    await expect(authenticateCustomer(ctx as any)).resolves.toBeNull();
  });
});
