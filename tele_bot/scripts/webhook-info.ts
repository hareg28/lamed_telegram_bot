import "dotenv/config";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));

  const webhookUrl = process.env.WEBHOOK_URL;
  const configured =
    webhookUrl?.endsWith("/api/webhook")
      ? webhookUrl
      : `${webhookUrl?.replace(/\/$/, "")}/api/webhook`;

  console.log("\nConfigured WEBHOOK_URL:", configured ?? "(not set)");

  if (configured) {
    try {
      const health = await fetch(configured);
      console.log("Health check status:", health.status);
      console.log("Health check body:", await health.text());
    } catch (err) {
      console.error("Health check failed:", err);
    }
  }
}

main();
