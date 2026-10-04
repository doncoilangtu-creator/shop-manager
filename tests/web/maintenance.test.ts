import { describe, expect, it, vi } from "vitest";

// lib/maintenance.ts pulls in Supabase clients (next/headers cookies etc.).
// The pure helpers under test don't need them, so stub both modules.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import {
  TICKET_TRANSITIONS,
  generateToken,
  nextStatuses,
  priorityLabel,
  statusLabel,
} from "@/lib/maintenance";
import type { TicketStatus } from "@/types/db";

const ALL: TicketStatus[] = [
  "received",
  "assigned",
  "in_progress",
  "waiting_parts",
  "completed",
  "awaiting_signature",
  "signed",
  "closed",
];

describe("TICKET_TRANSITIONS", () => {
  it("has an entry for every status", () => {
    expect(Object.keys(TICKET_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it("only transitions to known statuses and never to itself", () => {
    for (const [from, tos] of Object.entries(TICKET_TRANSITIONS)) {
      for (const to of tos) {
        expect(ALL).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it("closed is terminal", () => {
    expect(nextStatuses("closed")).toEqual([]);
  });

  it("every status is reachable from 'received'", () => {
    const seen = new Set<TicketStatus>(["received"]);
    const queue: TicketStatus[] = ["received"];
    while (queue.length) {
      for (const n of TICKET_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it("signing is only reachable from awaiting_signature, which only follows completed", () => {
    const preds = (t: TicketStatus) =>
      ALL.filter((s) => TICKET_TRANSITIONS[s].includes(t));
    expect(preds("signed")).toEqual(["awaiting_signature"]);
    expect(preds("awaiting_signature")).toEqual(["completed"]);
  });
});

describe("labels", () => {
  it("has a non-empty Vietnamese label for every status", () => {
    for (const s of ALL) expect(statusLabel(s).length).toBeGreaterThan(0);
  });

  it("maps priorities", () => {
    expect(priorityLabel("high")).toBe("Cao");
  });
});

describe("generateToken", () => {
  it("is URL-safe and long enough", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(32);
  });

  it("does not repeat", () => {
    const set = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(set.size).toBe(200);
  });
});
