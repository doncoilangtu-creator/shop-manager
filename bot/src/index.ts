import "dotenv/config";
import { Bot, Context } from "grammy";
import { findBotUser } from "./lib/auth";
import { registerStartCommand } from "./commands/start";
import { registerOwnerCommands } from "./commands/owner";
import { registerCustomerCommands } from "./commands/customer";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const bot = new Bot(token);

// Owner + customer command sets
registerStartCommand(bot);
registerOwnerCommands(bot);
registerCustomerCommands(bot);

// Fallback for non-command messages
bot.on("message", async (ctx: Context) => {
  const u = ctx.chatId ? await findBotUser(ctx.chatId) : null;
  if (!u) {
    await ctx.reply(
      "Gõ /start để xem hướng dẫn. Nếu bạn chưa được đăng ký, hãy liên hệ chủ shop.",
    );
    return;
  }
  await ctx.reply(
    "Mình không hiểu tin nhắn này. Gõ /start để xem danh sách lệnh.",
  );
});

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err);
});

const mode = process.env.BOT_MODE ?? "polling";

async function startPolling() {
  await bot.start({ onStart: () => console.log("Bot started in polling mode") });
}

async function startWebhook() {
  const port = Number(process.env.PORT ?? 3001);
  const path = process.env.WEBHOOK_PATH ?? "/telegram";
  const { createServer } = await import("http");
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === path) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          await bot.handleUpdate(JSON.parse(body));
          res.statusCode = 200;
          res.end("ok");
        } catch (e) {
          console.error("Webhook handle error:", e);
          res.statusCode = 500;
          res.end("err");
        }
      });
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  server.listen(port, () => console.log(`Bot webhook on :${port}${path}`));
}

if (mode === "webhook") {
  startWebhook().catch((e) => {
    console.error("Webhook start failed:", e);
    process.exit(1);
  });
} else {
  startPolling().catch((e) => {
    console.error("Polling start failed:", e);
    process.exit(1);
  });
}