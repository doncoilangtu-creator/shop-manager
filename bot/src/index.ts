import "dotenv/config";
import { Bot, Context } from "grammy";
import { createServer } from "http";
import { findBotUser } from "./lib/auth";
import { createWebhookListener } from "./lib/webhook";
import { registerStartCommand } from "./commands/start";
import { registerOwnerCommands } from "./commands/owner";
import { registerCustomerCommands } from "./commands/customer";

export function buildBot(token: string): Bot {
  const bot = new Bot(token);
  registerStartCommand(bot);
  registerOwnerCommands(bot);
  registerCustomerCommands(bot);

  bot.on("message", async (ctx: Context) => {
    const u = ctx.chatId ? await findBotUser(ctx.chatId) : null;
    if (!u) {
      await ctx.reply("Gõ /start để xem hướng dẫn. Nếu bạn chưa được đăng ký, hãy liên hệ chủ shop.");
      return;
    }
    await ctx.reply("Mình không hiểu tin nhắn này. Gõ /start để xem danh sách lệnh.");
  });

  bot.catch((err) => {
    // log only the message: err.ctx / err.error may carry request data
    console.error("Bot error:", (err.error as Error)?.message ?? err.error);
  });
  return bot;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Missing TELEGRAM_BOT_TOKEN");
    process.exit(1);
  }
  const bot = buildBot(token);
  const mode = process.env.BOT_MODE ?? "polling";

  if (mode !== "webhook") {
    await bot.start({ onStart: () => console.log("Bot started in polling mode") });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET ?? "";
  const path = process.env.WEBHOOK_PATH ?? "/telegram";
  const port = Number(process.env.PORT ?? 3001);
  await bot.init();
  const listener = createWebhookListener({
    path, secret,
    handleUpdate: (u) => bot.handleUpdate(u as Parameters<Bot["handleUpdate"]>[0]),
  });
  createServer(listener).listen(port, () => console.log(`Bot webhook on :${port}${path}`));

  // Register the webhook (with the secret token) when the public URL is known.
  const publicUrl = process.env.WEBHOOK_URL; // e.g. https://bot.example.com  (path is appended)
  if (publicUrl) {
    await bot.api.setWebhook(publicUrl.replace(/\/$/, "") + path, { secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false });
    console.log("setWebhook ok");
  } else {
    console.warn("WEBHOOK_URL not set: call setWebhook yourself with secret_token=WEBHOOK_SECRET");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Bot start failed:", (e as Error).message);
    process.exit(1);
  });
}
