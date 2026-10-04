import type { Bot } from "grammy";

type Handler = (ctx: any) => unknown;

/** Minimal stand-in for grammY's Bot: records command handlers. */
export function makeFakeBot() {
  const handlers = new Map<string, Handler>();
  const bot = {
    command: (name: string, fn: Handler) => {
      handlers.set(name, fn);
    },
  } as unknown as Bot;
  return { bot, handlers };
}

/** Minimal grammY-like Context that records replies. */
export function makeCtx(opts: { chatId?: number; text?: string } = {}) {
  const replies: Array<{ text: string; extra?: unknown }> = [];
  const ctx = {
    chatId: opts.chatId,
    message: opts.text === undefined ? undefined : { text: opts.text },
    reply: async (text: string, extra?: unknown) => {
      replies.push({ text, extra });
    },
  };
  return { ctx, replies };
}

/**
 * Chainable fake of the supabase-js query builder. Every builder method returns
 * the same object; awaiting it (or .maybeSingle()) resolves to `result`.
 */
export function makeQuery(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const q: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => result;
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return q;
        };
      },
    },
  );
  return { q, calls };
}
