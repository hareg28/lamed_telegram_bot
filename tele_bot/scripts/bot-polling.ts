/**
 * Local testing — long polling mode.
 * Uses the same bot instance and handlers as the webhook endpoint.
 *
 * Telegram allows only one update delivery method at a time, so this
 * script removes any registered webhook before starting polling.
 *
 * Usage:
 *   BOT_MODE=polling npm run bot:polling
 */
import "dotenv/config";
import { createBot } from "../src/bot/index";
import { getBotMode, getCompanyName } from "../src/lib/config";
import { PrismaClient } from "@prisma/client";

// ============================================================
// DATABASE KEEP-ALIVE (for Neon scale-to-zero)
// ============================================================

// Initialize Prisma client
const prisma = new PrismaClient();

// Keep-alive function to prevent Neon from sleeping
async function keepDatabaseAlive() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Database keep-alive ping successful");
  } catch (error: any) {
    // This is expected when the database is waking up
    if (error.message?.includes("Can't reach database server") || 
        error.message?.includes("terminating connection")) {
      console.log("⏳ Database is waking up...");
    } else {
      console.log("⚠️ Keep-alive error:", error.message);
    }
  }
}

// Run every 4 minutes (before Neon's 5-minute sleep timeout)
const keepAliveInterval = setInterval(keepDatabaseAlive, 4 * 60 * 1000);

console.log("🔄 Database keep-alive started (every 4 minutes)");

// ============================================================
// WAIT FOR DATABASE TO BE READY
// ============================================================

async function waitForDatabase(maxAttempts: number = 10, delay: number = 3000): Promise<boolean> {
  console.log(`⏳ Waiting for database to be ready (max ${maxAttempts} attempts)...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`✅ Database is ready! (attempt ${attempt})`);
      return true;
    } catch (error: any) {
      const errorMessage = error.message?.toLowerCase() || '';
      const isConnectionError = 
        errorMessage.includes("can't reach database server") ||
        errorMessage.includes("terminating connection") ||
        errorMessage.includes("connection terminated") ||
        errorMessage.includes("connection refused") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("e57p01");
      
      if (isConnectionError && attempt < maxAttempts) {
        console.log(`⏳ Database not ready yet (attempt ${attempt}/${maxAttempts}), waiting ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      if (attempt === maxAttempts) {
        console.log(`⚠️ Database not ready after ${maxAttempts} attempts, but continuing...`);
        return false;
      }
      
      throw error;
    }
  }
  
  return false;
}

// ============================================================
// BOT STARTUP
// ============================================================

async function main() {
  const mode = getBotMode();
  if (mode !== "polling") {
    console.warn(
      `⚠️  BOT_MODE is "${mode}". Set BOT_MODE=polling in .env for local testing.`
    );
  }

  // Wait for database to be ready
  await waitForDatabase(10, 3000);
  console.log("");

  const bot = createBot();

  console.log(`🤖 ${getCompanyName()} PR Bot — POLLING mode`);
  console.log("📡 Removing webhook (required before polling)...");

  await bot.api.deleteWebhook({ drop_pending_updates: false });

  console.log("📡 Starting long polling...");

  await bot.start({
    onStart: (info) => {
      console.log(`✅ Bot is running as @${info.username}`);
      console.log("   Press Ctrl+C to stop.\n");
    },
  });
}

main().catch((err) => {
  console.error("❌ Failed to start polling:", err);
  process.exit(1);
});

// ============================================================
// CLEANUP ON EXIT
// ============================================================

// Clean up resources when the bot stops
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  clearInterval(keepAliveInterval);
  prisma.$disconnect();
  console.log("👋 Bot stopped");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down...");
  clearInterval(keepAliveInterval);
  prisma.$disconnect();
  console.log("👋 Bot stopped");
  process.exit(0);
});
