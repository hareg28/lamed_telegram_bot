import type { Context } from "grammy";
import { requireUser } from "@/lib/auth";
import { getMaterialRequestByMrNumber, MR_FULL_INCLUDE } from "@/lib/material-request";
import { formatMrDetails } from "../formatters";
import { mainMenuKeyboard, mrActionKeyboard } from "../keyboards";
import { clearDraft } from "../drafts";
import { InlineKeyboard } from "grammy";

function myRequestsFilterKeyboard() {
  return new InlineKeyboard()
    .text("📅 Today", "myreq_filter:today")
    .text("📅 This Week", "myreq_filter:week")
    .row()
    .text("📅 This Month", "myreq_filter:month")
    .text("⏳ Pending", "myreq_filter:pending")
    .row()
    .text("🛒 Approved", "myreq_filter:approved")
    .text("✅ Completed", "myreq_filter:completed")
    .row()
    .text("❌ Rejected", "myreq_filter:rejected")
    .text("📄 All", "myreq_filter:all");
}

async function showMyRequestsFilters(ctx: Context) {
  await ctx.reply("📄 Your Material Requests\n\nSelect a filter to view your requests:", {
    reply_markup: myRequestsFilterKeyboard(),
  });
}

async function showFilteredRequests(ctx: Context, options: { 
  status?: string | string[], 
  dateFrom?: Date, 
  dateTo?: Date 
}) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));

  // Build Prisma where clause
  const where: any = {};

  // REQUESTER: only their own requests. Purchaser/Admin/Viewer: all requests
  const isRequesterOnly = user.role === "REQUESTER";
  if (isRequesterOnly) {
    where.requestedById = user.id;
  }

  if (options?.status) {
    where.status = Array.isArray(options.status) ? { in: options.status } : options.status;
  }

  if (options?.dateFrom || options?.dateTo) {
    where.createdAt = {};
    if (options.dateFrom) where.createdAt.gte = options.dateFrom;
    if (options.dateTo) where.createdAt.lte = options.dateTo;
  }

  const requests = await (await import("@/lib/prisma")).default.materialRequest.findMany({
    where,
    include: MR_FULL_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Build filter description for user
  let filterText = "All Requests";
  if (options?.status) {
    const statusLabels: Record<string, string> = {
      PENDING_APPROVAL: "Pending Approval",
      WAITING_FINAL_APPROVAL: "Waiting Final Approval",
      APPROVED_FOR_PURCHASING: "Approved for Purchasing",
      COMPLETED: "Completed",
      REJECTED: "Rejected"
    };
    if (Array.isArray(options.status)) {
      const isPendingFilter = options.status.includes("PENDING_APPROVAL") && options.status.includes("WAITING_FINAL_APPROVAL");
      filterText = isPendingFilter ? "Status: Pending" : `Status: ${options.status.map(s => statusLabels[s] || s).join(", ")}`;
    } else {
      filterText = `Status: ${statusLabels[options.status] || options.status}`;
    }
  } else if (options?.dateFrom) {
    const todayStr = new Date().toDateString();
    if (options.dateFrom.toDateString() === todayStr) {
      filterText = "Today";
    } else {
      filterText = `From ${options.dateFrom.toLocaleDateString()} to ${options.dateTo ? options.dateTo.toLocaleDateString() : "Now"}`;
    }
  }

  const heading = isRequesterOnly ? "📄 Your Material Requests" : "📄 All Material Requests";
  await ctx.reply(`${heading} (${requests.length} found)\n🔍 Filter: ${filterText}\n\nSelect another filter:`, {
    reply_markup: myRequestsFilterKeyboard(),
  });

  if (requests.length === 0) {
    await ctx.reply("No material requests found for this filter.");
    return;
  }

  const hidePrices = user.role === "REQUESTER";
  for (const mr of requests.slice(0, 10)) {
    await ctx.reply(formatMrDetails(mr as any, hidePrices), {
      parse_mode: "HTML",
      reply_markup: mrActionKeyboard(mr.id),
    });
  }

  if (requests.length > 10) {
    await ctx.reply(`Showing latest 10 of ${requests.length} requests.`);
  }
}

export async function handleMyRequests(ctx: Context) {
  await showMyRequestsFilters(ctx);
}

export async function handleRequestStatus(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireUser(BigInt(from.id));
  await showMyRequestsFilters(ctx);
}

export async function handleStatusMrNumber(ctx: Context, mrNumber: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  const mr = await getMaterialRequestByMrNumber(mrNumber.trim());

  if (!mr) {
    await ctx.reply("❌ Material request not found. Please check the MR number.");
    return;
  }

  const canView =
    mr.requestedById === user.id ||
    user.role === "ADMINISTRATOR" ||
    user.role === "VIEWER" ||
    user.role === "PURCHASER";

  if (!canView) {
    await ctx.reply("❌ You can only view your own requests.");
    return;
  }

  const hidePrices = user.role === "REQUESTER";
  await ctx.reply(formatMrDetails(mr, hidePrices), {
    parse_mode: "HTML",
    reply_markup: mrActionKeyboard(mr.id),
  });

  await ctx.reply("Main menu:", {
    reply_markup: mainMenuKeyboard(user),
  });
}

export async function handleStatusDraftMessage(ctx: Context, text: string): Promise<boolean> {
  await clearDraft(BigInt(ctx.from!.id));
  await handleStatusMrNumber(ctx, text);
  return true;
}

export async function handleMyRequestsFilterCallback(ctx: Context, data: string) {
  const now = new Date();
  let options: { status?: string | string[]; dateFrom?: Date; dateTo?: Date } = {};

  await ctx.answerCallbackQuery();

  // Extract the filter part after "myreq_filter:"
  const filter = data.replace("myreq_filter:", "");

  switch (filter) {
    case "today":
      options.dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      options.dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    case "week":
      options.dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      options.dateTo = new Date();
      break;
    case "month":
      options.dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      options.dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    case "pending":
      options.status = ["PENDING_APPROVAL", "WAITING_FINAL_APPROVAL"];
      break;
    case "approved":
      options.status = "APPROVED_FOR_PURCHASING";
      break;
    case "completed":
      options.status = "COMPLETED";
      break;
    case "rejected":
      options.status = "REJECTED";
      break;
    case "all":
    default:
      options = {};
      break;
  }

  await showFilteredRequests(ctx, options);
}
