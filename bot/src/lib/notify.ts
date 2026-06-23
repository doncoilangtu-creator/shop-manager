import { getSupabase } from "./supabase";
import type { Bot } from "grammy";

/** Send a Telegram message to a chat id; resolves to true on success. */
export async function sendTelegram(bot: Bot, chatId: string | number, text: string): Promise<boolean> {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    return true;
  } catch (e) {
    console.error(`sendTelegram(${chatId}) failed:`, (e as Error).message);
    return false;
  }
}

/** Insert a row into the notifications table. */
export async function insertNotification(payload: {
  type: string;
  payload: Record<string, unknown>;
}) {
  const sb = getSupabase();
  const { error } = await sb.from("notifications").insert({
    type: payload.type,
    payload: payload.payload,
  });
  if (error) console.error("insertNotification error:", error.message);
}

/** Notify the shop owner (all bot_users with role='owner'). */
export async function notifyOwner(bot: Bot, text: string, type = "owner_broadcast") {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bot_users")
    .select("telegram_chat_id")
    .eq("role", "owner")
    .eq("active", true);
  if (error || !data) return;
  await Promise.all(data.map((u) => sendTelegram(bot, u.telegram_chat_id, text)));
  await insertNotification({ type, payload: { text } });
}

/** Notify a single customer by customer_id (looks up their bot_users row). */
export async function notifyCustomer(bot: Bot, customerId: string, text: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from("bot_users")
    .select("telegram_chat_id")
    .eq("customer_id", customerId)
    .eq("active", true)
    .maybeSingle();
  if (!data) return;
  await sendTelegram(bot, data.telegram_chat_id, text);
  await insertNotification({ type: "customer_broadcast", payload: { customerId, text } });
}