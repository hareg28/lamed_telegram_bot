import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { requireUser, hasRole } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { formatDate, formatMoney, decimalToNumber } from "@/lib/calculations";
import { mainMenuKeyboard } from "../keyboards";

function escapeMd(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/[_*`\[]/g, "\\$&");
}

function getPurchaseStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT": return "📝 Draft";
    case "PENDING_APPROVAL": return "⏳ Pending Approval";
    case "APPROVED": return "✅ Approved";
    case "REJECTED": return "❌ Rejected";
    case "ORDERED": return "💳 Purchased";
    case "COMPLETED": return "🎉 Completed";
    case "CANCELLED": return "🚫 Cancelled";
    default: return status;
  }
}

function purchaseStatusUpdateKeyboard(prId: string, status: string): InlineKeyboard | undefined {
  if (status === "APPROVED") {
    return new InlineKeyboard().text("💳 Mark Purchased", `delivery_purchased:${prId}`);
  }
  if (status === "ORDERED") {
    return new InlineKeyboard().text("✅ Mark Completed", `delivery_completed:${prId}`);
  }
  return undefined;
}

export async function handleDeliveryTracking(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR", "VIEWER")) {
    await ctx.reply("❌ Access denied.");
    return;
  }

  // Purchasers see their own PRs; Admins/Viewers see all
  const whereClause =
    user.role === "PURCHASER"
      ? { purchaserId: user.id }
      : {};

  const prs = await prisma.purchaseRequest.findMany({
    where: {
      ...whereClause,
      status: { in: ["APPROVED", "ORDERED", "COMPLETED"] },
    },
    include: {
      materialRequest: true,
      purchaser: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });

  if (prs.length === 0) {
    await ctx.reply("📭 No approved, purchased, or completed purchase requests to track yet.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return;
  }

  await ctx.reply(`🚚 *Purchase & Delivery Tracking* — ${prs.length} record(s)`, {
    parse_mode: "Markdown",
  });

  for (const pr of prs) {
    const mr = pr.materialRequest;
    let text = `📄 *${pr.prNumber}*\n`;
    text += `└ MR: ${mr.mrNumber} — ${escapeMd(mr.projectName)}\n`;
    text += `└ Supplier: ${escapeMd(pr.supplierName)}\n`;
    text += `└ Grand Total: ETB ${formatMoney(decimalToNumber(pr.grandTotal))}\n`;
    text += `└ Status: ${getPurchaseStatusLabel(pr.status)}\n`;
    text += `└ Expected Delivery: ${pr.expectedDeliveryDate ? formatDate(pr.expectedDeliveryDate) : "—"}\n`;
    text += `└ Actual Delivery: ${pr.actualDeliveryDate ? formatDate(pr.actualDeliveryDate) : "—"}\n`;
    if (pr.deliveryRemarks) {
      text += `└ Remarks: ${escapeMd(pr.deliveryRemarks)}\n`;
    }

    const canUpdate = hasRole(user, "PURCHASER", "ADMINISTRATOR");
    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup:
        canUpdate
          ? purchaseStatusUpdateKeyboard(pr.id, pr.status)
          : undefined,
    });
  }
}

export async function handleDeliveryPurchasedCallback(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.answerCallbackQuery({ text: "Access denied" });
    return;
  }

  const { markPurchaseRequestAsPurchased } = await import("@/lib/purchase-request");

  try {
    const pr = await markPurchaseRequestAsPurchased(prId, user.id);
    await ctx.answerCallbackQuery({ text: "Marked as Purchased" });
    if (pr) {
      await ctx.reply(
        `💳 *${pr.prNumber}* marked as *Purchased*.\nSupabase and Google Sheets updated successfully.`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    console.error("Mark purchased callback error:", err);
    await ctx.answerCallbackQuery({ text: "Failed to update" });
    await ctx.reply("❌ Failed to update status. Please try again.");
  }
}

export async function handleDeliveryCompletedCallback(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.answerCallbackQuery({ text: "Access denied" });
    return;
  }

  const { markPurchaseRequestAsCompleted } = await import("@/lib/purchase-request");

  try {
    const pr = await markPurchaseRequestAsCompleted(prId, user.id);
    await ctx.answerCallbackQuery({ text: "Marked as Completed" });
    if (pr) {
      await ctx.reply(
        `✅ *${pr.prNumber}* marked as *Completed*.\nSupabase, Google Sheets, and Price History updated successfully.`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    console.error("Mark completed callback error:", err);
    await ctx.answerCallbackQuery({ text: "Failed to update" });
    await ctx.reply("❌ Failed to update status. Please try again.");
  }
}

// Legacy callbacks kept for compatibility
export async function handleDeliveryDeliveredCallback(ctx: Context, prId: string) {
  await handleDeliveryCompletedCallback(ctx, prId);
}

export async function handleDeliveryDelayedCallback(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.answerCallbackQuery({ text: "Access denied" });
    return;
  }

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId } });
  if (!pr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  await prisma.purchaseRequest.update({
    where: { id: prId },
    data: { deliveryStatus: "DELAYED" },
  });

  await ctx.answerCallbackQuery({ text: "⚠️ Marked as Delayed" });
  await ctx.reply(
    `⚠️ *${pr.prNumber}* marked as *Delayed*.\nContact the supplier to reschedule.`,
    { parse_mode: "Markdown" }
  );
}
