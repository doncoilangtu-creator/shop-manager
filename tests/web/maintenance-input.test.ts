import { describe, expect, it } from "vitest";
import { ContractSchema, ContractUpdateSchema, LogSchema, TicketSchema, contractPatchFromForm, parseParts, slaDueAt } from "@/lib/maintenance-input";

const C = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("contract input", () => {
  it("rejects end before start", () => {
    const r = ContractSchema.safeParse({ customer_id: C, start_date: "2026-05-01", end_date: "2026-04-01" });
    expect(r.success).toBe(false);
  });
  it("accepts a valid contract with defaults", () => {
    const r = ContractSchema.parse({ customer_id: C, start_date: "2026-01-01", end_date: "2026-12-31" });
    expect(r).toMatchObject({ monthly_fee: 0, sla_hours: 24, status: "active" });
  });
  it("partial update only touches submitted fields (old code reset status/fee/sla)", () => {
    const patch = contractPatchFromForm(fd({ monthly_fee: "500000" }));
    expect(patch).toEqual({ monthly_fee: "500000" });
    expect(ContractUpdateSchema.parse(patch)).toEqual({ monthly_fee: 500000 });   // status NOT defaulted to active
  });
  it("update validates values", () => {
    expect(ContractUpdateSchema.safeParse({ sla_hours: "0" }).success).toBe(false);
    expect(ContractUpdateSchema.safeParse({ status: "weird" }).success).toBe(false);
  });
});

describe("ticket / log input", () => {
  it("ticket needs a title and valid customer", () => {
    expect(TicketSchema.safeParse({ customer_id: C, title: "  " }).success).toBe(false);
    expect(TicketSchema.safeParse({ customer_id: "x", title: "t" }).success).toBe(false);
    expect(TicketSchema.parse({ customer_id: C, title: "t" }).priority).toBe("medium");
  });
  it("log has no performed_by field (comes from the session) and parses parts", () => {
    const r = LogSchema.parse({ ticket_id: C, description: "d", parts_used: parseParts("RAM 8GB, ,SSD ") });
    expect(r.parts_used).toEqual(["RAM 8GB", "SSD"]);
    expect(Object.keys(r)).not.toContain("performed_by");
    expect(parseParts(null)).toEqual([]);
  });
  it("SLA deadline defaults to 24h", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(slaDueAt(now, null)).toBe("2026-10-04T00:00:00.000Z");
    expect(slaDueAt(now, 4)).toBe("2026-10-03T04:00:00.000Z");
    expect(slaDueAt(now, 0)).toBe("2026-10-04T00:00:00.000Z");
  });
});
