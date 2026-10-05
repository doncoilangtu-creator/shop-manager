"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { EINV_REMINDER_COOKIE, snoozeCookieValue } from "@/lib/einvoice/missing";
import { vnDate } from "@/lib/time";

export type ReminderMode = "snooze" | "off" | "on";

/** Bật/tắt/nhắc lại sau 30 ngày cho thẻ nhắc hóa đơn điện tử trên Dashboard (cookie theo trình duyệt). */
export async function setEinvoiceReminderAction(mode: ReminderMode): Promise<{ ok: true } | { ok: false; error: string }> {
  if (mode !== "snooze" && mode !== "off" && mode !== "on") return { ok: false, error: "Lựa chọn không hợp lệ" };
  const store = await cookies();
  if (mode === "on") {
    store.delete(EINV_REMINDER_COOKIE);
  } else {
    store.set(EINV_REMINDER_COOKIE, mode === "off" ? "off" : snoozeCookieValue(vnDate()), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  revalidatePath("/");
  revalidatePath("/sales/missing-einvoice");
  return { ok: true };
}
