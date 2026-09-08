/**
 * Telegram Webhook Endpoint
 * Receives updates from Telegram and forwards them to the grammY bot.
 * All bot logic lives in src/bot/index.ts
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { createBot } from "@/bot/index";
import { getBotMode, getCompanyName } from "@/lib/config";
import { getWebhookSecret } from "@/lib/notifications";

export const config = {
  api: {
    bodyParser: false, // grammY reads the raw body itself
  },
};

let webhookHandler: ((req: NextApiRequest, res: NextApiResponse) => Promise<void>) | null = null;

function getHandler() {
  if (webhookHandler) return webhookHandler;

  const { webhookCallback } = require("grammy");
  const bot = createBot();

  webhookHandler = webhookCallback(bot, "http", {
    secretToken: getWebhookSecret(),
  });

  return webhookHandler!;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    res.status(200).json({
      status: "ok",
      message: `${getCompanyName()} Bot webhook is ready`,
      configured: !!process.env.BOT_TOKEN,
      botMode: getBotMode(),
    });
    return;
  }

  if (req.method === "POST") {
    try {
      await getHandler()(req, res);
    } catch (err) {
      console.error("[webhook] Error processing update:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}