import { describe, expect, it } from "vitest";
import { buildMaintenanceReport } from "@/lib/maintenance-report";

const base = { priority: "medium", created_at: "2026-09-01T00:00:00Z" };
describe("buildMaintenanceReport", () => {
  it("computes SLA %, average resolution and counts", () => {
    const r = buildMaintenanceReport([
      { ...base, status: "closed", completed_at: "2026-09-01T10:00:00Z", sla_due_at: "2026-09-01T12:00:00Z" },    // met, 10h
      { ...base, status: "signed", completed_at: "2026-09-02T00:00:00Z", sla_due_at: "2026-09-01T12:00:00Z" },    // late, 24h
      { ...base, status: "in_progress", completed_at: null, sla_due_at: "2026-09-01T12:00:00Z" },                 // open past deadline -> breached
      { ...base, priority: "high", status: "received", completed_at: null, sla_due_at: "2099-01-01T00:00:00Z" },  // open, not due
    ], new Date("2026-10-01T00:00:00Z"));
    expect(r.total).toBe(4);
    expect(r.slaMet).toBe(1);
    expect(r.slaBreached).toBe(2);
    expect(r.slaPct).toBe(33.3);
    expect(r.avgResolutionHours).toBe(17);
    expect(r.byPriority).toEqual({ medium: 3, high: 1 });
    expect(r.byStatus.closed).toBe(1);
  });
  it("empty month has null ratios", () => {
    const r = buildMaintenanceReport([]);
    expect(r).toMatchObject({ total: 0, slaPct: null, avgResolutionHours: null });
  });
});
