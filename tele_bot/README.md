# Lamed Construction PLC — Procurement & Material Request Bot

Telegram-based **Procurement & Material Request Management System** for **Lamed Construction PLC**. Digitizes the full workflow from material request creation through purchasing, dual-stage approvals, reporting, and automatic Google Sheets record keeping.

## Features

- **Role-based access**: Requester, Administrator, Purchaser, Viewer
- **Material Request (MR) workflow**: Auto-generated MR numbers and dates
- **Purchase workflow**: Supplier info, unit prices, 15% VAT, grand total calculations
- **Dual approval**: MR approval → Purchase submission → Final approval
- **Telegram Webhooks**: Production-ready (no polling)
- **Notifications**: Automatic alerts at every workflow stage
- **Google Sheets**: Each completed purchase item recorded as a row
- **Search & reports**: By project, MR/PR number, supplier, status, date
- **Export**: PDF and Excel per request; bulk Excel for admins

## Tech Stack

| Layer | Technology |
|-------|------------|
| Bot | [grammY](https://grammy.dev/) |
| Backend | Next.js 15 (App Router) |
| Database | PostgreSQL + Prisma ORM |
| Integration | Telegram Webhook API, Google Sheets API |
| Export | pdfkit, exceljs |

## User Roles

| Role | Permissions |
|------|-------------|
| **Requester** | Create MRs, view own requests, track status |
| **Administrator** | Approve/reject MRs and purchases, manage users, reports |
| **Purchaser** | Process approved MRs, enter supplier/pricing, submit purchases |
| **Viewer** | Read-only access to all requests and history |

## Workflow

```
Requester → MR (Pending Approval)
    ↓
Administrator → Approve → Approved for Purchasing
    ↓
Purchaser → Enter supplier/prices → Waiting for Final Approval
    ↓
Administrator → Final Approve → Completed (+ Google Sheets)
```

## Project Structure

```
tele_bot/
├── prisma/schema.prisma       # Database models
├── scripts/set-webhook.ts     # Register Telegram webhook
├── src/
│   ├── app/api/
│   │   ├── webhook/           # Telegram webhook endpoint
│   │   ├── admin/             # Admin REST API
│   │   └── export/            # PDF & Excel export
│   ├── bot/
│   │   ├── index.ts           # Bot routing
│   │   ├── keyboards.ts       # Menus
│   │   └── handlers/          # MR, purchase, admin handlers
│   └── lib/
│       ├── material-request.ts
│       ├── purchase-request.ts
│       ├── google-sheets.ts
│       ├── notifications.ts
│       └── export/
└── .env.example
```

## Setup

### 1. Install dependencies

```bash
cd tele_bot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_URL` | Direct PostgreSQL URL (for migrations) |
| `ADMIN_TELEGRAM_IDS` | Comma-separated admin Telegram user IDs |
| `WEBHOOK_URL` | Public app URL (e.g. `https://your-app.vercel.app`) |
| `WEBHOOK_SECRET` | Secret token for webhook verification |

Optional:

| Variable | Description |
|----------|-------------|
| `PURCHASER_TELEGRAM_IDS` | Auto-assign purchaser role |
| `VIEWER_TELEGRAM_IDS` | Auto-assign viewer role |
| `GOOGLE_*` | Google Sheets integration for completed purchases |

Get your Telegram ID from [@userinfobot](https://t.me/userinfobot).

### 3. Initialize database

```bash
npm run db:push
```

### 4. Run locally (webhook via ngrok)

```bash
# Terminal 1
npm run dev

# Terminal 2 — expose port 3000
ngrok http 3000

# Set WEBHOOK_URL in .env to your ngrok URL, then:
npm run bot:set-webhook
```

Open your bot in Telegram and send `/start`.

## Vercel Deployment

1. Push to GitHub and import into [Vercel](https://vercel.com)
2. Add all environment variables from `.env.example`
3. Deploy
4. Register webhook:

```bash
WEBHOOK_URL=https://your-app.vercel.app npm run bot:set-webhook
```

5. Run `npm run db:push` against your production database

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Register and show role-based menu |
| `/help` | Role-specific help |
| `/search <term>` | Search MRs (Admin/Viewer) |
| `/report daily\|weekly\|monthly` | Completed purchase reports (Admin) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhook` | Telegram webhook |
| GET | `/api/webhook` | Health check |
| GET | `/api/admin` | List/filter requests (`x-telegram-id` header) |
| POST | `/api/admin` | Approve/reject (`approve_mr`, `reject_mr`, `approve_purchase`, `reject_purchase`) |
| GET | `/api/export/pdf?id=&telegramId=` | Download PDF |
| GET | `/api/export/excel?id=&telegramId=` | Download Excel |
| GET | `/api/export/excel?list=true&telegramId=` | Bulk Excel export |

## Google Sheets

When a purchase is finally approved, each material item is appended as a row with: Request Date, MR Number, PR Number, Project, Requester, Supplier details, Item details, Totals, Delivery, Status, Approval Date, Approved By.

Share your Google Sheet with the service account email and set `GOOGLE_SHEET_ID` in `.env`.

## Scripts

```bash
npm run dev              # Start dev server
npm run build            # Prisma generate + Next.js build
npm run db:push          # Push schema to database
npm run db:studio        # Open Prisma Studio
npm run bot:set-webhook  # Register Telegram webhook
```

## License

Private — Lamed Construction PLC
