import { Bot } from "grammy";

export type Res = { data: unknown; error: { message: string; code?: string } | null };
export type Call = { method: string; args: unknown[] };
export type QueryLog = { table: string; calls: Call[] };

/**
 * Fake supabase client: from(table) returns a chainable builder; awaiting / maybeSingle / single resolves to
 * resolve(table, calls). rpc(name, args) resolves to rpcs[name]. Everything is logged for assertions.
 */
export function makeFakeSupabase(opts: {
  tables?: Record<string, Res | ((calls: Call[]) => Res)>;
  rpcs?: Record<string, Res | ((args: Record<string, unknown>) => Res)>;
}) {
  const tables = (opts.tables ??= {});
  const queries: QueryLog[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sb = {
    from(table: string) {
      const calls: Call[] = [];
      queries.push({ table, calls });
      const t = tables[table] ?? { data: [], error: null };
      const result = (): Res => (typeof t === "function" ? t(calls) : t);
      const q: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
          if (prop === "maybeSingle" || prop === "single") return async () => {
            const r = result();
            return Array.isArray(r.data) && r.error === null ? { data: r.data[0] ?? null, error: null } : r;
          };
          return (...args: unknown[]) => { calls.push({ method: prop, args }); return q; };
        },
      });
      return q;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const r = opts.rpcs?.[fn] ?? { data: null, error: { message: `no fake for rpc ${fn}` } };
      return typeof r === "function" ? r(args) : r;
    },
  };
  /** every write method used on any table (insert/update/delete/upsert) */
  const writes = () => queries.flatMap((q) => q.calls.filter((c) => ["insert", "update", "delete", "upsert"].includes(c.method)).map((c) => ({ table: q.table, ...c })));
  return { sb, queries, rpcCalls, writes, tables };
}

/** Real grammY Bot whose Telegram API is replaced by a recording transport (no network). */
export function attachFakeTelegram(bot: Bot) {
  const sent: Array<{ method: string; payload: Record<string, any> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, any> });
    return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: (payload as any).chat_id, type: "private" } } } as never;
  });
  return sent;
}

let uid = 1;
export function commandUpdate(chatId: number, text: string) {
  const cmdLen = text.split(/\s/)[0].length;
  return {
    update_id: uid++,
    message: {
      message_id: uid, date: 1_700_000_000, chat: { id: chatId, type: "private" as const },
      from: { id: chatId, is_bot: false, first_name: "T" }, text,
      entities: text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: cmdLen }] : undefined,
    },
  };
}

export const BOT_INFO = { id: 1, is_bot: true as const, first_name: "Shop", username: "shop_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };
