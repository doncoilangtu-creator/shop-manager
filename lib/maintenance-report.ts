/** Pure aggregation for the maintenance monthly report (unit-tested). */
export type TicketRow = {
  status: string; priority: string; created_at: string; completed_at: string | null; sla_due_at: string | null;
};

export type MaintenanceReport = {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  slaMet: number;       // finished (completed_at set) on or before sla_due_at
  slaBreached: number;  // finished late, or still open after the deadline
  slaPct: number | null;
  avgResolutionHours: number | null;
};

const FINISHED = new Set(["completed", "awaiting_signature", "signed", "closed"]);

export function buildMaintenanceReport(rows: TicketRow[], now: Date = new Date()): MaintenanceReport {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let met = 0, breached = 0, hoursSum = 0, hoursN = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
    const due = r.sla_due_at ? new Date(r.sla_due_at).getTime() : null;
    if (FINISHED.has(r.status) && r.completed_at) {
      const done = new Date(r.completed_at).getTime();
      hoursSum += (done - new Date(r.created_at).getTime()) / 3600_000; hoursN++;
      if (due !== null) { if (done <= due) met++; else breached++; }
    } else if (!FINISHED.has(r.status) && due !== null && due < now.getTime()) {
      breached++;
    }
  }
  const judged = met + breached;
  return {
    total: rows.length, byStatus, byPriority, slaMet: met, slaBreached: breached,
    slaPct: judged ? Math.round((met / judged) * 1000) / 10 : null,
    avgResolutionHours: hoursN ? Math.round((hoursSum / hoursN) * 10) / 10 : null,
  };
}
