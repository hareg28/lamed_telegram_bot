/**
 * Remove the Telegram webhook so polling can be used locally.
 * Usage: npm run bot:delete-webhook
 */
import "dotenv/config";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN is not set in .env");
  process.exit(1);
}

async function deleteWebhook() {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/deleteWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    }
  );

  const data = await res.json();
  console.log("deleteWebhook response:", data);

  if (!data.ok) {
    process.exit(1);
  }

  console.log("✅ Webhook removed — you can now run npm run bot:polling");
}

deleteWebhook().catch((err) => {
  console.error("❌ Failed to delete webhook:", err);
  process.exit(1);
});
