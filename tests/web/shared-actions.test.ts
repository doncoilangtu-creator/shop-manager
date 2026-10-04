import { describe, expect, it, vi } from "vitest";
import {
  QueryError, cleanInput, emptyToNull, formDataToObject, insertWithGeneratedCode, pgErrorMessage, unwrap, unwrapOne,
} from "@/lib/actions/_shared";
import { TICKET_TRANSITIONS, nextStatuses } from "@/lib/maintenance";

describe("form helpers", () => {
  it("emptyToNull / cleanInput", () => {
    expect(emptyToNull("  ")).toBeNull();
    expect(emptyToNull("x")).toBe("x");
    expect(emptyToNull(0)).toBe(0);
    expect(cleanInput({ a: " x ", b: "", c: 5 })).toEqual({ a: "x", b: null, c: 5 });
  });
  it("formDataToObject collects multi keys and drops files", () => {
    const fd = new FormData();
    fd.append("name", "A"); fd.append("note", "  ");
    fd.append("tags", "x"); fd.append("tags", ""); fd.append("tags", "y");
    fd.append("file", new Blob(["z"]), "z.txt");
    expect(formDataToObject(fd, ["tags"])).toEqual({ name: "A", note: null, tags: ["x", "y"] });
    expect(formDataToObject(fd)).toMatchObject({ tags: "y" });
  });
});

describe("unwrap", () => {
  it("throws on error instead of returning an empty list", () => {
    expect(() => unwrap({ data: null, error: { message: "boom", code: "42P01" } }, "products")).toThrow(QueryError);
    expect(() => unwrap({ data: null, error: { message: "boom" } }, "products")).toThrow(/products: boom/);
  });
  it("returns data / [] / null", () => {
    expect(unwrap({ data: [1], error: null }, "x")).toEqual([1]);
    expect(unwrap({ data: null, error: null }, "x")).toEqual([]);
    expect(unwrapOne({ data: null, error: null }, "x")).toBeNull();
  });
  it("maps SQLSTATE to Vietnamese messages", () => {
    expect(pgErrorMessage({ message: "m", code: "23503" })).toMatch(/đang được dùng/);
    expect(pgErrorMessage({ message: "m", code: "23505" })).toMatch(/trùng/);
    expect(pgErrorMessage({ message: "raw", code: "XX" })).toBe("raw");
  });
});

describe("insertWithGeneratedCode", () => {
  it("retries on unique violation with a new code", async () => {
    let n = 0;
    const make = () => `C${++n}`;
    const insert = vi.fn(async (code: string) =>
      code === "C1" || code === "C2" ? { data: null, error: { message: "dup", code: "23505" } } : { data: { id: code }, error: null });
    const r = await insertWithGeneratedCode(make, insert);
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ id: "C3" });
    expect(insert).toHaveBeenCalledTimes(3);
  });
  it("does not retry other errors and gives up after maxTries", async () => {
    const insert = vi.fn(async () => ({ data: null, error: { message: "fk", code: "23503" } }));
    const r = await insertWithGeneratedCode(() => "X", insert);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(r.error?.code).toBe("23503");
    const dup = vi.fn(async () => ({ data: null, error: { message: "dup", code: "23505" } }));
    await insertWithGeneratedCode(() => "X", dup, 3);
    expect(dup).toHaveBeenCalledTimes(3);
  });
});

describe("single ticket FSM", () => {
  it("the server action uses the same table as the UI buttons (and the DB trigger)", () => {
    expect(nextStatuses("received")).toEqual(TICKET_TRANSITIONS.received);
    expect(nextStatuses("signed")).toEqual(["closed"]);
    expect(nextStatuses("closed")).toEqual([]);
    // the old divergent action table allowed completed -> closed; the DB rejects it, so must the app
    expect(nextStatuses("completed")).not.toContain("closed");
  });
});
