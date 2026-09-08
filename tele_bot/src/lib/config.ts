import type { UserRole } from "@prisma/client";

function parseTelegramIds(raw: string | undefined): bigint[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => BigInt(id));
}

export function getAdminTelegramIds(): bigint[] {
  return parseTelegramIds(process.env.ADMIN_TELEGRAM_IDS);
}

export function isAdminTelegramId(telegramId: bigint): boolean {
  return getAdminTelegramIds().includes(telegramId);
}

export function getPurchaserTelegramIds(): bigint[] {
  return parseTelegramIds(process.env.PURCHASER_TELEGRAM_IDS);
}

export function getViewerTelegramIds(): bigint[] {
  return parseTelegramIds(process.env.VIEWER_TELEGRAM_IDS);
}

export function resolveRoleFromTelegramId(telegramId: bigint): UserRole {
  if (getAdminTelegramIds().includes(telegramId)) return "ADMINISTRATOR";
  if (getPurchaserTelegramIds().includes(telegramId)) return "PURCHASER";
  if (getViewerTelegramIds().includes(telegramId)) return "VIEWER";
  return "REQUESTER";
}

import path from "path";

export function getCompanyName(): string {
  return (
    process.env.COMPANY_NAME ??
    "Lamed Construction PLC"
  );
}

export function getLogoPath(): string | null {
  const fs = require("fs");
  if (process.env.LOGO_PATH && fs.existsSync(process.env.LOGO_PATH)) {
    return process.env.LOGO_PATH;
  }
  const candidates = ["logo.png", "logo.jpg", "logo.jpeg", "lamed-logo.jpg"];
  for (const file of candidates) {
    const p = path.join(process.cwd(), "public", file);
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export type BotMode = "polling" | "webhook";

/** How the bot receives Telegram updates. Use `polling` for local testing. */
export function getBotMode(): BotMode {
  const mode = process.env.BOT_MODE?.toLowerCase();
  if (mode === "polling" || mode === "webhook") return mode;
  return "webhook";
}

export function isPollingMode(): boolean {
  return getBotMode() === "polling";
}

export function isWebhookMode(): boolean {
  return getBotMode() === "webhook";
}
