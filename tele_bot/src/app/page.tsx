import type { Metadata } from "next";
import { getCompanyName } from "@/lib/config";

export const metadata: Metadata = {
  title: "Procurement & Material Request Bot",
  description:
    "Telegram Procurement & Material Request Management System",
};

export default function Home() {
  const companyName = getCompanyName();

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "4rem auto",
        padding: "0 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1>{companyName} Procurement Bot</h1>
      <p>
        Telegram Procurement &amp; Material Request Management System for{" "}
        <strong>{companyName}</strong>.
      </p>
      <h2>Workflow</h2>
      <ol>
        <li>Requester creates a Material Request (MR)</li>
        <li>Administrator approves or rejects the MR</li>
        <li>Purchaser enters supplier info, prices, and submits a Purchase Request</li>
        <li>Administrator performs final approval</li>
        <li>Completed purchases are stored in PostgreSQL and Google Sheets</li>
      </ol>
      <h2>API Endpoints</h2>
      <ul>
        <li>
          <code>POST /api/webhook</code> — Telegram webhook (production mode)
        </li>
        <li>
          <code>GET /api/admin</code> — List/filter requests (header:{" "}
          <code>x-telegram-id</code>)
        </li>
        <li>
          <code>GET /api/export/pdf?id=&amp;telegramId=</code> — PDF export
        </li>
        <li>
          <code>GET /api/export/excel?id=&amp;telegramId=</code> — Excel export
        </li>
      </ul>
      <p>
        Open the bot in Telegram and send <code>/start</code> to begin.
      </p>
    </main>
  );
}
