/**
 * Set Telegram webhook for production deployment.
 * Usage: npm run bot:set-webhook
 */
import "dotenv/config";

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const secret = process.env.WEBHOOK_SECRET;

if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

if (!webhookUrl) {
  console.error(
    "WEBHOOK_URL is required (e.g. https://your-app.vercel.app or ngrok URL)"
  );
  process.exit(1);
}

if (
  webhookUrl.includes("your-app.vercel.app") ||
  webhookUrl.includes("localhost")
) {
  console.warn(
    "\n⚠️  WARNING: WEBHOOK_URL looks like a placeholder or localhost."
  );
  console.warn(
    "   Telegram cannot reach localhost. Use a public URL (Vercel deploy or ngrok).\n"
  );
}

const url = webhookUrl.endsWith("/api/webhook")
  ? webhookUrl
  : `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

async function getWebhookInfo() {
  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  return res.json();
}

async function setWebhook() {
  console.log("Registering webhook:", url);

  const body: Record<string, string> = { url };
  if (secret) body.secret_token = secret;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("\nsetWebhook response:");
  console.log(JSON.stringify(data, null, 2));

  if (!data.ok) {
    process.exit(1);
  }

  try {
    const health = await fetch(url);
    console.log("\nEndpoint health check:", health.status, health.statusText);
    if (health.ok) {
      console.log("Body:", await health.text());
    } else {
      console.error(
        "❌ Webhook URL is not reachable or returned an error.",
        "Deploy your app first, then update WEBHOOK_URL in .env."
      );
    }
  } catch (err) {
    console.error("❌ Could not reach webhook URL:", err);
  }

  const info = await getWebhookInfo();
  console.log("\nCurrent webhook info:");
  console.log(JSON.stringify(info, null, 2));

  const pending = info.result?.pending_update_count ?? 0;
  if (pending > 0 && info.result?.last_error_message) {
    console.warn(
      `\n⚠️  ${pending} pending update(s). Last error: ${info.result.last_error_message}`
    );
  }
}

setWebhook();
