import type { Context } from "grammy";
import { getSupabase } from "./supabase";

export type Role = "owner" | "customer";

export interface BotUser {
  id: string;
  chat_id: string;
  role: Role;
  customer_id: string | null;
  name: string | null;
}

/** Look up bot user by Telegram chat_id. */
export async function findBotUser(chatId: number | string): Promise<BotUser | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bot_users")
    .select("id, telegram_chat_id, role, customer_id, name")
    .eq("telegram_chat_id", String(chatId))
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error("findBotUser error:", error.message);
    return null;
  }
  return data as BotUser | null;
}

export async function authenticateOwner(ctx: Context): Promise<BotUser | null> {
  const chatId = ctx.chatId;
  if (!chatId) return null;
  const u = await findBotUser(chatId);
  if (!u || u.role !== "owner") return null;
  return u;
}

export async function authenticateCustomer(ctx: Context): Promise<BotUser | null> {
  const chatId = ctx.chatId;
  if (!chatId) return null;
  const u = await findBotUser(chatId);
  if (!u || u.role !== "customer" || !u.customer_id) return null;
  return u;
}