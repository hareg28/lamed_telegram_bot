import type { Context } from "grammy";
import { InlineKeyboard, Keyboard } from "grammy";
import prisma from "@/lib/prisma";
import { requireAdministrator, requireUser, hasRole, listUsers, setUserRole, setUserFullName, roleLabel } from "@/lib/auth";
import {
  searchMaterialRequests,
  getMaterialRequestByMrNumber,
  approveMaterialRequest,
  rejectMaterialRequest,
  getMaterialRequestById,
  getReportData,
  hasRemainingItems,
} from "@/lib/material-request";
import {
  approvePurchaseRequest,
  rejectPurchaseRequest,
  getPurchaseRequestById,
} from "@/lib/purchase-request";
import type { RequestStatus, UserRole } from "@prisma/client";
import { upsertProjectRow } from "@/lib/google-sheets";
import { formatMrDetails, formatMrListItem, formatPrDetails } from "../formatters";
import {
  mainMenuKeyboard,
  adminFilterKeyboard,
  adminMrActionKeyboard,
  confirmKeyboard,
  roleSelectKeyboard,
  cancelKeyboard,
  manageRolePickKeyboard,
  manageProjectsKeyboard,
  projectTypeSelectionKeyboard,
  projectActionKeyboard,
  registerBoqProjectKeyboard,
  manageBoqKeyboard,
  boqActionKeyboard,
  prActionKeyboard,
  purchaserMrKeyboard,
  mrActionKeyboard,
  MENU_LABELS,
} from "../keyboards";
import { setDraftStep, clearDraft, upsertDraft, getDraft, getDraftData, updateDraftData } from "../drafts";

export async function handleViewAllRequests(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "ADMINISTRATOR", "VIEWER")) {
    await ctx.reply("❌ Access denied.");
    return;
  }

  await ctx.reply("📑 Filter requests by status:", {
    reply_markup: adminFilterKeyboard(),
  });
}

export async function handleAdminFilter(ctx: Context, status: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "ADMINISTRATOR", "VIEWER")) return;

  let filters: any;
  if (status === "ALL") {
    filters = {};
  } else if (status === "PENDING_APPROVAL") {
    // Treat "Pending" as both PENDING_APPROVAL and WAITING_FINAL_APPROVAL
    filters = { status: ["PENDING_APPROVAL", "WAITING_FINAL_APPROVAL"] };
  } else {
    filters = { status: status as RequestStatus };
  }

  const { results: requests, total } = await searchMaterialRequests(filters, 1, 15);
  const readOnly = user.role === "VIEWER";

  if (requests.length === 0) {
    await ctx.answerCallbackQuery({ text: "No requests found" });
    await ctx.reply("No requests found for this filter.");
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `📑 *Requests* (${status === "PENDING_APPROVAL" ? "Pending" : status}) — ${total} found`,
    { parse_mode: "Markdown" }
  );

  for (const mr of requests) {
    await ctx.reply(formatMrListItem(mr), {
      parse_mode: "Markdown",
      reply_markup: readOnly
        ? undefined
        : adminMrActionKeyboard(mr.id, mr.status),
    });
  }
}

export async function handleApproveMr(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  await setDraftStep(BigInt(from.id), "awaiting_approve_mr_number");
  await ctx.reply("✅ Enter the *MR Number* to approve (e.g. MR-000001):", {
    parse_mode: "Markdown",
  });
}

export async function handleRejectMr(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  await setDraftStep(BigInt(from.id), "awaiting_reject_mr_number");
  await ctx.reply("❌ Enter the *MR Number* to reject:", {
    parse_mode: "Markdown",
  });
}

export async function handleFinalApprove(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  await setDraftStep(BigInt(from.id), "awaiting_final_approve_mr");
  await ctx.reply("✅ Enter the *MR Number* for final purchase approval:", {
    parse_mode: "Markdown",
  });
}

export async function handleFinalReject(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  await setDraftStep(BigInt(from.id), "awaiting_final_reject_mr");
  await ctx.reply("❌ Enter the *MR Number* to reject purchase:", {
    parse_mode: "Markdown",
  });
}

async function handleAdminMrApproveByNumber(ctx: Context, mrNumber: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  try {
    const mr = await getMaterialRequestByMrNumber(mrNumber.trim());

    if (!mr) {
      await ctx.reply("❌ Material request not found. Try again or type /cancel.");
      return;
    }

    if (mr.status !== "PENDING_APPROVAL") {
      await ctx.reply(`This request is already *${mr.status}*.`, {
        parse_mode: "Markdown",
      });
      await clearDraft(BigInt(from.id));
      return;
    }

    await approveMaterialRequest(mr.id, admin.id);
    await clearDraft(BigInt(from.id));

    await ctx.reply(`✅ *${mr.mrNumber}* has been approved for purchasing.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Admin approve MR error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handleAdminMrApproveByNumber] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }

    await clearDraft(BigInt(from.id));
    await ctx.reply("❌ An unexpected error occurred during approval. Operation cancelled.", {
      reply_markup: mainMenuKeyboard(admin),
    });
  }
}

async function handleAdminMrRejectByNumber(
  ctx: Context,
  mrNumber: string,
  remarks?: string
) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  try {
    const mr = await getMaterialRequestByMrNumber(mrNumber.trim());

    if (!mr) {
      await ctx.reply("❌ Material request not found. Try again or type /cancel.");
      return;
    }

    if (mr.status !== "PENDING_APPROVAL") {
      await ctx.reply(`This request is already *${mr.status}*.`, {
        parse_mode: "Markdown",
      });
      await clearDraft(BigInt(from.id));
      return;
    }

    if (!remarks) {
      await setDraftStep(BigInt(from.id), "awaiting_reject_mr_remarks");
      await upsertDraft(BigInt(from.id), "awaiting_reject_mr_remarks", {
        mrNumber: mr.mrNumber,
      });
      await ctx.reply("Please provide a reason for rejection (or type 'none'):");
      return;
    }

    await rejectMaterialRequest(
      mr.id,
      admin.id,
      remarks === "none" ? undefined : remarks
    );
    await clearDraft(BigInt(from.id));

    await ctx.reply(`❌ *${mr.mrNumber}* has been rejected.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Admin reject MR error:", err);
    await clearDraft(BigInt(from.id));
    await ctx.reply("❌ An unexpected error occurred during rejection. Operation cancelled.", {
      reply_markup: mainMenuKeyboard(admin),
    });
  }
}

async function handleAdminFinalApproveByNumber(ctx: Context, mrNumber: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  try {
    const mr = await getMaterialRequestByMrNumber(mrNumber.trim());

    if (!mr) {
      await ctx.reply("❌ Material request not found. Try again or type /cancel.");
      return;
    }

    if (mr.status !== "WAITING_FINAL_APPROVAL") {
      await ctx.reply(`This request is *${mr.status}*, not waiting for final approval.`, {
        parse_mode: "Markdown",
      });
      await clearDraft(BigInt(from.id));
      return;
    }

    // Find pending PRs for this MR
    const pendingPrs = (mr.purchaseRequests ?? []).filter(
      (pr) => pr.status === "PENDING_APPROVAL"
    );

    if (pendingPrs.length === 0) {
      await ctx.reply("❌ No pending purchase requests found for this MR.");
      await clearDraft(BigInt(from.id));
      return;
    }

    // Approve all pending PRs
    for (const pr of pendingPrs) {
      await approvePurchaseRequest(pr.id, admin.id);
    }
    await clearDraft(BigInt(from.id));

    await ctx.reply(`✅ *${mr.mrNumber}* — ${pendingPrs.length} purchase request(s) approved.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Admin final approve error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handleAdminFinalApproveByNumber] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }
    await clearDraft(BigInt(from.id));
    await ctx.reply("❌ An unexpected error occurred during final approval. Operation cancelled.", {
      reply_markup: mainMenuKeyboard(admin),
    });
  }
}

async function handleAdminFinalRejectByNumber(
  ctx: Context,
  mrNumber: string,
  remarks?: string
) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  try {
    const mr = await getMaterialRequestByMrNumber(mrNumber.trim());

    if (!mr) {
      await ctx.reply("❌ Material request not found. Try again or type /cancel.");
      return;
    }

    if (mr.status !== "WAITING_FINAL_APPROVAL") {
      await ctx.reply(`This request is not waiting for final approval.`, {
        parse_mode: "Markdown",
      });
      await clearDraft(BigInt(from.id));
      return;
    }

    if (!remarks) {
      await setDraftStep(BigInt(from.id), "awaiting_final_reject_remarks");
      await upsertDraft(BigInt(from.id), "awaiting_final_reject_remarks", {
        mrNumber: mr.mrNumber,
      });
      await ctx.reply("Please provide a reason for rejection (or type 'none'):");
      return;
    }

    // Reject all pending PRs
    const pendingPrs = (mr.purchaseRequests ?? []).filter(
      (pr) => pr.status === "PENDING_APPROVAL"
    );
    for (const pr of pendingPrs) {
      await rejectPurchaseRequest(pr.id, admin.id, remarks === "none" ? undefined : remarks);
    }
    await clearDraft(BigInt(from.id));

    await ctx.reply(`❌ Purchase(s) for *${mr.mrNumber}* rejected. Purchaser can revise.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Admin final reject error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handleAdminFinalRejectByNumber] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }
    await clearDraft(BigInt(from.id));
    await ctx.reply("❌ An unexpected error occurred during purchase rejection. Operation cancelled.", {
      reply_markup: mainMenuKeyboard(admin),
    });
  }
}

export async function handleMrApproveCallback(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);
  if (!mr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(`Approve MR *${mr.mrNumber}*?`, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard("mr_approve", mrId),
  });
}

export async function handleMrRejectCallback(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    await requireAdministrator(BigInt(from.id));
    const mr = await getMaterialRequestById(mrId);
    if (!mr) {
      await ctx.answerCallbackQuery({ text: "Not found" }).catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery().catch(() => {});
    await setDraftStep(BigInt(from.id), "awaiting_reject_mr_remarks_id");
    await upsertDraft(BigInt(from.id), "awaiting_reject_mr_remarks_id", {
      mrNumber: mr.mrNumber,
      mrId: mrId,
    });
    await ctx.reply(
      `Rejecting *${mr.mrNumber}*. Please provide a reason (or type 'none'):`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("MR reject callback error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handleMrRejectCallback] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }
    await ctx.answerCallbackQuery({ text: "Reject failed" }).catch(() => {});
    const message =
      err instanceof Error && err.message === "FORBIDDEN"
        ? "❌ You don't have permission to reject requests."
        : err instanceof Error && err.message === "NOT_REGISTERED"
          ? "❌ Please send /start first, then try again."
          : "❌ Failed to reject. Please try again.";
    await ctx.reply(message);
  }
}

export async function handleMrApproveConfirm(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    const admin = await requireAdministrator(BigInt(from.id));
    const mr = await getMaterialRequestById(mrId);

    if (!mr || mr.status !== "PENDING_APPROVAL") {
      await ctx.answerCallbackQuery({ text: "Cannot approve — already processed" }).catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery({ text: "Approving..." }).catch(() => {});
    await approveMaterialRequest(mrId, admin.id);
    await ctx.reply(`✅ *${mr.mrNumber}* approved for purchasing.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("MR approve error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handleMrApproveConfirm] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }
    await ctx.answerCallbackQuery({ text: "Approval failed" }).catch(() => {});
    const message =
      err instanceof Error && err.message === "FORBIDDEN"
        ? "❌ You don't have permission to approve requests."
        : err instanceof Error && err.message === "NOT_REGISTERED"
          ? "❌ Please send /start first, then try again."
          : "❌ Failed to approve. Please try again.";
    await ctx.reply(message);
  }
}

async function handleMrRejectConfirmById(
  ctx: Context,
  mrId: string,
  remarks?: string
) {
  const from = ctx.from;
  if (!from) return;

  try {
    const admin = await requireAdministrator(BigInt(from.id));
    const mr = await getMaterialRequestById(mrId);

    if (!mr || mr.status !== "PENDING_APPROVAL") {
      await ctx.answerCallbackQuery?.({ text: "Cannot reject" }).catch(() => {});
      await clearDraft(BigInt(from.id));
      return;
    }

    await rejectMaterialRequest(mrId, admin.id, remarks);
    await clearDraft(BigInt(from.id));
    await ctx.reply(`❌ *${mr.mrNumber}* rejected.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Reject MR confirm error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handleMrRejectConfirmById] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }
    await clearDraft(BigInt(from.id));
    const admin = await requireAdministrator(BigInt(from.id)).catch(() => null);
    await ctx.reply("❌ Failed to reject request. Draft cleared.", {
      reply_markup: admin ? mainMenuKeyboard(admin) : undefined,
    });
  }
}

// PR-level approval callbacks (from inline buttons in notifications)
export async function handlePrApproveCallback(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  const pr = await getPurchaseRequestById(prId);
  if (!pr) {
    await ctx.answerCallbackQuery({ text: "Not found" }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.reply(`Approve PR *${pr.prNumber}* for MR *${pr.materialRequest.mrNumber}*?`, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard("pr_approve", prId),
  });
}

export async function handlePrRejectCallback(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  const pr = await getPurchaseRequestById(prId);
  if (!pr) {
    await ctx.answerCallbackQuery({ text: "Not found" }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  await setDraftStep(BigInt(from.id), "awaiting_pr_reject_remarks");
  await upsertDraft(BigInt(from.id), "awaiting_pr_reject_remarks", {
    prNumber: pr.prNumber,
    prId: pr.id,
  });
  await ctx.reply(
    `Rejecting PR *${pr.prNumber}*. Reason (or 'none'):`,
    { parse_mode: "Markdown" }
  );
}

export async function handlePrApproveConfirm(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    const admin = await requireAdministrator(BigInt(from.id));
    const pr = await getPurchaseRequestById(prId);

    if (!pr || pr.status !== "PENDING_APPROVAL") {
      await ctx.answerCallbackQuery({ text: "Cannot approve — already processed" }).catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery({ text: "Approving..." }).catch(() => {});
    await approvePurchaseRequest(prId, admin.id);
    await ctx.reply(`✅ PR *${pr.prNumber}* approved.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("PR approve error:", err);
    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : "";
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] [handlePrApproveConfirm] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error to log file:", logErr);
    }
    await ctx.answerCallbackQuery({ text: "Approval failed" }).catch(() => {});
    const message =
      err instanceof Error && err.message === "FORBIDDEN"
        ? "❌ You don't have permission to approve purchases."
        : err instanceof Error && err.message === "NOT_REGISTERED"
          ? "❌ Please send /start first, then try again."
          : "❌ Failed to approve. Please try again.";
    await ctx.reply(message);
  }
}

// Legacy MR-based purchase approve/reject callbacks (kept for backward compat)
export async function handlePurchaseApproveCallback(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);
  if (!mr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  const pendingPrs = (mr.purchaseRequests ?? []).filter(p => p.status === "PENDING_APPROVAL");
  if (pendingPrs.length === 0) {
    await ctx.answerCallbackQuery({ text: "No pending PRs" });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(`Final approve ${pendingPrs.length} PR(s) for *${mr.mrNumber}*?`, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard("purchase_approve", mrId),
  });
}

export async function handlePurchaseRejectCallback(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);
  if (!mr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await setDraftStep(BigInt(from.id), "awaiting_final_reject_remarks_id");
  await upsertDraft(BigInt(from.id), "awaiting_final_reject_remarks_id", {
    mrNumber: mr.mrNumber,
  });
  await ctx.reply(
    `Rejecting purchase for *${mr.mrNumber}*. Reason (or 'none'):`,
    { parse_mode: "Markdown" }
  );
}

export async function handlePurchaseApproveConfirm(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    const admin = await requireAdministrator(BigInt(from.id));
    const mr = await getMaterialRequestById(mrId);

    if (!mr || mr.status !== "WAITING_FINAL_APPROVAL") {
      await ctx.answerCallbackQuery({ text: "Cannot approve — invalid status" });
      return;
    }

    const pendingPrs = (mr.purchaseRequests ?? []).filter(
      (p) => p.status === "PENDING_APPROVAL"
    );
    if (pendingPrs.length === 0) {
      await ctx.answerCallbackQuery({ text: "No pending PRs" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Approving..." });
    for (const pr of pendingPrs) {
      await approvePurchaseRequest(pr.id, admin.id);
    }

    await ctx.reply(`✅ *${mr.mrNumber}* — ${pendingPrs.length} PR(s) approved.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Purchase approve error:", err);
    await ctx.answerCallbackQuery({ text: "Approval failed" }).catch(() => {});
    const message =
      err instanceof Error && err.message === "FORBIDDEN"
        ? "❌ You don't have permission to approve purchases."
        : "❌ Failed to approve. Please try again.";
    await ctx.reply(message);
  }
}

async function handlePurchaseRejectConfirmById(
  ctx: Context,
  mrId: string,
  remarks?: string
) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  try {
    const mr = await getMaterialRequestById(mrId);

    if (!mr || mr.status !== "WAITING_FINAL_APPROVAL") {
      await ctx.answerCallbackQuery?.({ text: "Cannot reject" });
      await clearDraft(BigInt(from.id));
      return;
    }

    const pendingPrs = (mr.purchaseRequests ?? []).filter(p => p.status === "PENDING_APPROVAL");
    for (const pr of pendingPrs) {
      await rejectPurchaseRequest(pr.id, admin.id, remarks);
    }

    await clearDraft(BigInt(from.id));
    await ctx.reply(`❌ Purchase(s) for *${mr.mrNumber}* rejected.`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(admin),
    });
  } catch (err) {
    console.error("Reject purchase confirm error:", err);
    await clearDraft(BigInt(from.id));
    await ctx.reply("❌ Failed to reject purchase. Draft cleared.", {
      reply_markup: mainMenuKeyboard(admin),
    });
  }
}

export async function handleSearchCommand(ctx: Context, query: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "ADMINISTRATOR", "VIEWER", "PURCHASER", "REQUESTER")) {
    await ctx.reply("❌ Search is available to registered bot users.");
    return;
  }

  if (!query.trim()) {
    await upsertDraft(BigInt(from.id), "search_query", { flowType: "mr" }, user.id, "mr");
    await ctx.reply("🔍 Enter your search query (MR number, project, supplier, or item):", {
      reply_markup: cancelKeyboard()
    });
    return;
  }

  await performSearch(ctx, query.trim(), user);
}

async function performSearch(ctx: Context, query: string, user: any) {
  const filters: any = { search: query };
  if (user.role === "REQUESTER") {
    filters.requesterId = user.id;
  }

  const { results: requests, total } = await searchMaterialRequests(filters, 1, 15);

  if (requests.length === 0) {
    await ctx.reply(`No results for "${query}".`);
    await clearDraft(BigInt(ctx.from!.id));
    return;
  }

  await ctx.reply(`🔍 Found ${total} result(s) for "${query}":`);

  for (const mr of requests) {
    const isOwner = mr.requestedById === user.id;
    const canManage = user.role === "ADMINISTRATOR";
    const canPurchase = user.role === "PURCHASER" && (mr.status === "APPROVED_FOR_PURCHASING" || mr.status === "WAITING_FINAL_APPROVAL");

    let kb = undefined;
    if (canManage) {
      kb = adminMrActionKeyboard(mr.id, mr.status);
    } else if (canPurchase) {
      if (hasRemainingItems(mr)) {
        kb = purchaserMrKeyboard(mr.id);
      } else {
        // All items purchased, just show View Details button
        kb = new InlineKeyboard().text("View Details", `mr_view:${mr.id}`);
      }
    } else if (isOwner || user.role === "VIEWER") {
      kb = mrActionKeyboard(mr.id, true);
    }

    await ctx.reply(formatMrListItem(mr), {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }
}

export async function handleReportCommand(ctx: Context, type: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));

  const validTypes = ["daily", "weekly", "monthly", "project", "supplier", "requester"];
  if (!validTypes.includes(type)) {
    await upsertDraft(BigInt(from.id), "report_select_type", { flowType: "mr" }, admin.id, "mr");
    await ctx.reply(
      "📊 <b>Choose Report Type</b>\n\nSelect the type of report you want to generate:",
      {
        parse_mode: "HTML",
        reply_markup: new Keyboard()
          .text("Daily").text("Weekly").text("Monthly").row()
          .text("By Project").text("By Supplier").text("By Requester").row()
          .text(MENU_LABELS.CANCEL)
          .resized()
      }
    );
    return;
  }

  // Map display names to internal types
  const typeMap: Record<string, string> = {
    "Daily": "daily",
    "Weekly": "weekly",
    "Monthly": "monthly",
    "By Project": "project",
    "By Supplier": "supplier",
    "By Requester": "requester"
  };
  const actualType = typeMap[type] || type;

  // Check if this type requires a filter
  if (["project", "supplier", "requester"].includes(actualType)) {
    await upsertDraft(BigInt(from.id), "report_input_filter", { flowType: "mr", reportType: actualType }, admin.id, "mr");
    let prompt = "";
    if (actualType === "project") prompt = "Enter the <b>Project Name</b>:";
    if (actualType === "supplier") prompt = "Enter the <b>Supplier Name</b>:";
    if (actualType === "requester") prompt = "Enter the <b>Requester Name</b>:";
    await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: cancelKeyboard() });
    return;
  }

  // Generate report for types that don't need a filter
  await generateAndSendReport(ctx, actualType);
}

async function generateAndSendReport(ctx: Context, type: string, filter?: string) {
  const from = ctx.from;
  if (!from) return;

  const requests = await getReportData(
    type as "daily" | "weekly" | "monthly" | "project" | "supplier" | "requester",
    filter
  );

  if (requests.length === 0) {
    await ctx.reply(`📊 No completed requests found for this report yet. Completed requests are only included after all items have been purchased and delivered.`);
    await clearDraft(BigInt(from.id));
    return;
  }

  // Import necessary functions
  const { generateMaterialRequestsListExcel } = await import("@/lib/export/excel");
  const { InputFile } = await import("grammy");

  // Generate Excel file
  const excel = await generateMaterialRequestsListExcel(requests);
  const fileName = `${type}-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

  // Send text summary
  await ctx.reply(`📊 *${type.charAt(0).toUpperCase() + type.slice(1)} Report* — ${requests.length} completed`, {
    parse_mode: "Markdown",
  });

  // Send Excel file
  await ctx.replyWithDocument(new InputFile(excel, fileName), {
    caption: `📊 ${fileName}`,
  });

  await clearDraft(BigInt(from.id));
}

export async function handleMrViewCallback(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);

  if (!mr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  const canView =
    hasRole(user, "ADMINISTRATOR", "VIEWER", "PURCHASER") ||
    mr.requestedById === user.id;

  if (!canView) {
    await ctx.answerCallbackQuery({ text: "Access denied" });
    return;
  }

  const hidePrices = user.role === "REQUESTER";
  await ctx.answerCallbackQuery();
  await ctx.reply(formatMrDetails(mr, hidePrices), { parse_mode: "HTML" });
}

export async function handleManageUsers(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  await clearDraft(BigInt(from.id));

  await ctx.reply(
    "👥 *User Management*\n\nStep 1: Select the role you want to assign:",
    {
      parse_mode: "Markdown",
      reply_markup: manageRolePickKeyboard(),
    }
  );
}

export async function handleManageAssignCallback(ctx: Context, role: string) {
  const from = ctx.from;
  if (!from) return;

  const validRoles = ["PURCHASER", "REQUESTER", "VIEWER", "ADMINISTRATOR", "OFFICIAL_NAME"];
  if (!validRoles.includes(role)) {
    await ctx.answerCallbackQuery({ text: "Invalid option" });
    return;
  }

  await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();

  if (role === "OFFICIAL_NAME") {
    await prisma.formDraft.upsert({
      where: { telegramId: BigInt(from.id) },
      create: {
        telegramId: BigInt(from.id),
        step: "awaiting_official_name_bulk",
        flowType: "mr",
        data: {} as any,
      },
      update: {
        step: "awaiting_official_name_bulk",
        flowType: "mr",
        data: {} as any,
      },
    });

    await ctx.reply(
      "🏷 <b>Link Official Company Names (Single Step)</b>\n\n" +
      "Send Telegram handles and official company names in a single message:\n\n" +
      "Format: <code>@username = Official Name</code>\n" +
      "<i>(You can also list multiple employees line-by-line)</i>\n\n" +
      "<b>Example:</b>\n" +
      "<code>@Hareg_T = Hareg Tadesse</code>\n" +
      "<code>@johndoe = John Doe</code>",
      {
        parse_mode: "HTML",
        reply_markup: cancelKeyboard(),
      }
    );
    return;
  }

  await prisma.formDraft.upsert({
    where: { telegramId: BigInt(from.id) },
    create: {
      telegramId: BigInt(from.id),
      step: "awaiting_assign_user",
      flowType: "mr",
      data: { assignRole: role } as any,
    },
    update: {
      step: "awaiting_assign_user",
      flowType: "mr",
      data: { assignRole: role } as any,
    },
  });

  const roleNames: Record<string, string> = {
    PURCHASER: "👥 Purchaser",
    REQUESTER: "📋 Requester",
    VIEWER: "👁 Viewer",
    ADMINISTRATOR: "🔑 Administrator",
  };

  await ctx.reply(
    `Step 2: Enter the <b>Telegram Username</b> or <b>Name</b> of the user you want to assign as <b>${esc(roleNames[role] ?? role)}</b>:\n\n<i>Example: @johndoe or John Doe</i>`,
    {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    }
  );
}

async function handleAdminAssignUser(
  ctx: Context,
  searchInput: string,
  assignRole: string
) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const query = searchInput.trim();
  const cleanUsername = query.replace(/^@/, "");

  if (!query) {
    await ctx.reply("Please enter a valid username or name.");
    return;
  }

  let user = null;

  // 1. Search by numeric Telegram ID
  if (/^\d+$/.test(query)) {
    user = await prisma.user.findUnique({
      where: { telegramId: BigInt(query) },
    });
  }

  // 2. Search by username (exact, case-insensitive) or name (partial)
  if (!user) {
    const allUsers = await prisma.user.findMany();
    user = allUsers.find(
      (u) =>
        (u.telegramUsername?.toLowerCase() === cleanUsername.toLowerCase()) ||
        (u.fullName?.toLowerCase().includes(query.toLowerCase()))
    ) ?? null;
  }

  await clearDraft(BigInt(from.id));

  if (!user) {
    await ctx.reply(
      `❌ User <b>${esc(query)}</b> not found.\n\nMake sure they have opened the bot and sent /start first.`,
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(admin),
      }
    );
    return;
  }

  if (assignRole === "OFFICIAL_NAME") {
    await prisma.formDraft.upsert({
      where: { telegramId: BigInt(from.id) },
      create: {
        telegramId: BigInt(from.id),
        step: "awaiting_official_name_value",
        flowType: "mr",
        data: { targetUserId: user.id } as any,
      },
      update: {
        step: "awaiting_official_name_value",
        flowType: "mr",
        data: { targetUserId: user.id } as any,
      },
    });

    await ctx.reply(
      `Step 3: Enter the <b>Official Company Name</b> for @${esc(user.telegramUsername ?? "user")} (Current: <b>${esc(user.fullName)}</b>):\n\n<i>Example: Solomon Abebe</i>`,
      {
        parse_mode: "HTML",
        reply_markup: cancelKeyboard(),
      }
    );
    return;
  }

  const validRoles = ["PURCHASER", "REQUESTER", "VIEWER", "ADMINISTRATOR"];
  if (!validRoles.includes(assignRole)) {
    await ctx.reply("❌ Invalid role. Operation cancelled.", {
      reply_markup: mainMenuKeyboard(admin),
    });
    return;
  }

  const roleNames: Record<string, string> = {
    PURCHASER: "🛒 Purchaser",
    REQUESTER: "📋 Requester",
    VIEWER: "👁 Viewer",
    ADMINISTRATOR: "🔑 Administrator",
  };

  // If the target is the admin themselves AND they are assigning a non-admin role,
  // do NOT change their DB role — they keep Administrator privileges while still
  // receiving purchaser notifications (set up in notifications.ts).
  if (user.id === admin.id && assignRole !== "ADMINISTRATOR") {
    await ctx.reply(
      `ℹ️ <b>${esc(admin.fullName)}</b>, as Administrator you already have full access to all <b>${esc(roleNames[assignRole] ?? assignRole)}</b> features.\n\nYour role stays as <b>🔑 Administrator</b> — no change needed.`,
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(admin),
      }
    );
    return;
  }

  const updated = await setUserRole(user.id, assignRole as any);

  await ctx.reply(
    `✅ <b>${esc(updated.fullName)}</b> (@${esc(updated.telegramUsername ?? "—")}) is now <b>${esc(roleNames[assignRole] ?? assignRole)}</b>!\n\nThey will see their new menu options the next time they interact with the bot.`,
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(admin),
    }
  );
}

async function handleAdminOfficialNameBulk(
  ctx: Context,
  text: string
): Promise<boolean> {
  const from = ctx.from!;
  const admin = await requireAdministrator(BigInt(from.id));

  if (text === MENU_LABELS.CANCEL) {
    await clearDraft(BigInt(from.id));
    await ctx.reply("Cancelled.", { reply_markup: mainMenuKeyboard(admin) });
    return true;
  }

  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    await ctx.reply("❌ Please enter at least one user mapping.");
    return true;
  }

  const results: Array<{ username: string; officialName: string; success: boolean; reason?: string }> = [];

  for (const line of lines) {
    const separatorMatch = line.match(/^@?([a-zA-Z0-9_]+)\s*[:=\-]\s*(.+)$/);
    if (separatorMatch) {
      const username = separatorMatch[1];
      const officialName = separatorMatch[2].trim();
      await updateSingleUserName(username, officialName, results);
      continue;
    }

    const spaceMatch = line.match(/^@([a-zA-Z0-9_]+)\s+(.+)$/);
    if (spaceMatch) {
      const username = spaceMatch[1];
      const officialName = spaceMatch[2].trim();
      await updateSingleUserName(username, officialName, results);
      continue;
    }

    results.push({ username: line, officialName: "", success: false, reason: "Invalid format (use @username = Official Name)" });
  }

  let summary = `🏷 <b>Official Company Names Updated:</b>\n\n`;
  let successCount = 0;

  for (const res of results) {
    if (res.success) {
      successCount++;
      summary += `• <b>@${esc(res.username)}</b> ➔ <b>${esc(res.officialName)}</b>\n`;
    } else {
      summary += `• ❌ <b>${esc(res.username)}</b>: ${esc(res.reason ?? "Failed")}\n`;
    }
  }

  if (successCount > 0) {
    summary += `\n✅ Updated ${successCount} user(s). These official names will now be used across all MRs, PRs, PDFs, Excel exports, and Google Sheets.`;
  }

  await clearDraft(BigInt(from.id));
  await ctx.reply(summary, {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(admin),
  });
  return true;
}

async function updateSingleUserName(
  username: string,
  officialName: string,
  results: Array<{ username: string; officialName: string; success: boolean; reason?: string }>
) {
  if (officialName.length < 2) {
    results.push({ username, officialName, success: false, reason: "Name too short" });
    return;
  }

  const cleanUsername = username.replace(/^@/, "").toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { telegramUsername: { equals: cleanUsername, mode: "insensitive" } },
        { fullName: { equals: username, mode: "insensitive" } },
      ],
    },
  });

  if (!user) {
    results.push({ username, officialName, success: false, reason: "User not registered in bot yet" });
    return;
  }

  await setUserFullName(user.id, officialName);
  results.push({ username: user.telegramUsername ?? username, officialName, success: true });
}

/** Escape HTML special characters to prevent Telegram parse errors */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


export async function handleSetRoleCallback(
  ctx: Context,
  userId: string,
  role: UserRole
) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));

  const updated = await setUserRole(userId, role);

  await ctx.answerCallbackQuery({ text: "Role updated" });
  await ctx.reply(
    `✅ *${updated.fullName}* is now *${roleLabel(role)}*.`,
    { parse_mode: "Markdown", reply_markup: mainMenuKeyboard(admin) }
  );
}

export async function handleAdminCancel(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await clearDraft(BigInt(from.id));
  await ctx.answerCallbackQuery({ text: "Cancelled" });
  await ctx.reply("Cancelled.", {
    reply_markup: mainMenuKeyboard(admin),
  });
}

export async function handleAdminDraftMessage(
  ctx: Context,
  text: string,
  step: string,
  data: Record<string, any>
): Promise<boolean> {
  const from = ctx.from;
  if (!from) return false;

  switch (step) {
    case "search_query": {
      if (text === MENU_LABELS.CANCEL) {
        await clearDraft(BigInt(from.id));
        const admin = await requireUser(BigInt(from.id));
        await ctx.reply("Cancelled.", { reply_markup: mainMenuKeyboard(admin) });
        return true;
      }
      const user = await requireUser(BigInt(from.id));
      await performSearch(ctx, text.trim(), user);
      await clearDraft(BigInt(from.id));
      return true;
    }
    case "report_select_type": {
      if (text === MENU_LABELS.CANCEL) {
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply("Cancelled.", { reply_markup: mainMenuKeyboard(admin) });
        return true;
      }
      const typeMap: Record<string, string> = {
        "Daily": "daily",
        "Weekly": "weekly",
        "Monthly": "monthly",
        "By Project": "project",
        "By Supplier": "supplier",
        "By Requester": "requester"
      };
      const actualType = typeMap[text];
      if (!actualType) {
        await ctx.reply("Please select an option from the keyboard.");
        return true;
      }
      if (["project", "supplier", "requester"].includes(actualType)) {
        await updateDraftData(BigInt(from.id), { reportType: actualType } as any);
        await setDraftStep(BigInt(from.id), "report_input_filter");
        let prompt = "";
        if (actualType === "project") prompt = "Enter the <b>Project Name</b>:";
        if (actualType === "supplier") prompt = "Enter the <b>Supplier Name</b>:";
        if (actualType === "requester") prompt = "Enter the <b>Requester Name</b>:";
        await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: cancelKeyboard() });
      } else {
        await generateAndSendReport(ctx, actualType);
      }
      return true;
    }
    case "report_input_filter": {
      if (text === MENU_LABELS.CANCEL) {
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply("Cancelled.", { reply_markup: mainMenuKeyboard(admin) });
        return true;
      }
      await generateAndSendReport(ctx, (data as any).reportType, text.trim());
      return true;
    }
    case "project_add_name": {
      try {
        const name = text.trim();
        if (name.length < 2) {
          await ctx.reply("Please enter a valid project name (at least 2 characters).");
          return true;
        }
        const existing = await prisma.project.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
        });
        if (existing) {
          await ctx.reply("❌ A project with that name already exists. Try another name:");
          return true;
        }
        const newProj = await prisma.project.create({
          data: {
            name,
          },
        });
        // Sync new project to Google Sheets (fire-and-forget)
        upsertProjectRow(newProj).catch((err) => console.error("Sheets sync error:", err));

        await updateDraftData(BigInt(from.id), { _adminProjectId: newProj.id });
        await setDraftStep(BigInt(from.id), "project_add_type");
        await ctx.reply(
          `✅ Project <b>"${esc(name)}"</b> created!\n\n` +
          `Now select or enter the <b>Project Type</b> (or tap ⏭ Skip):`,
          {
            parse_mode: "HTML",
            reply_markup: projectTypeSelectionKeyboard(),
          }
        );
      } catch (err) {
        console.error("Project add name error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to process project name.");
      }
      return true;
    }
    case "project_add_type": {
      try {
        const projectId = (data as any)?._adminProjectId;
        const trimmed = text.trim();
        const isSkip = trimmed.toLowerCase() === "skip" || trimmed === "⏭ Skip";
        if (projectId && !isSkip && trimmed.length > 0) {
          const updated = await prisma.project.update({
            where: { id: projectId },
            data: { projectType: trimmed },
          });
          upsertProjectRow(updated).catch(() => {});
        }
        await clearDraft(BigInt(from.id));
        const projects = await prisma.project.findMany({
          select: { id: true, name: true, projectType: true, isActive: true },
          orderBy: { name: "asc" },
        });
        await ctx.reply(
          `✅ Project registered successfully!`,
          {
            parse_mode: "HTML",
            reply_markup: manageProjectsKeyboard(projects),
          }
        );
      } catch (err) {
        console.error("Project add type error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to process project type.");
      }
      return true;
    }
    case "project_edit_type_value": {
      try {
        const projectType = text.trim();
        const projectId = (data as any)?._adminProjectId;
        if (!projectId) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Session expired.");
          return true;
        }
        const updated = await prisma.project.update({
          where: { id: projectId },
          data: { projectType },
        });
        upsertProjectRow(updated).catch(() => {});
        await clearDraft(BigInt(from.id));
        await ctx.reply(
          `✅ Project <b>"${esc(updated.name)}"</b> type updated to <b>${esc(projectType)}</b>.`,
          {
            parse_mode: "HTML",
            reply_markup: projectActionKeyboard(projectId),
          }
        );
      } catch (err) {
        console.error("Project edit type error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to update project type.");
      }
      return true;
    }
    case "project_add_boq": {
      try {
        const boqValues = text
          .split(/[\n,]+/) // Split by newlines or commas
          .map(b => b.trim())
          .filter(b => b.length >= 2);
        const projectId = data._adminProjectId;
        if (!projectId) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Session lost.");
          return true;
        }
        if (boqValues.length === 0) {
          await ctx.reply("Please enter a valid BOQ reference (at least 2 characters).");
          return true;
        }
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Project not found.");
          return true;
        }
        const updatedList = [...project.boqList, ...boqValues];
        await prisma.project.update({
          where: { id: projectId },
          data: { boqList: updatedList },
        });
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply(`✅ Added ${boqValues.length} BOQ reference(s) to project "${project.name}".`, {
          reply_markup: mainMenuKeyboard(admin),
        });
      } catch (err) {
        console.error("Project add BOQ error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to add BOQ.");
      }
      return true;
    }
    case "project_bulk_add_boq": {
      try {
        const projectId = data._adminProjectId;
        if (!projectId) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Session lost.");
          return true;
        }
        const boqValues = text
          .split(/[\n,]+/) // Split by newlines or commas
          .map(b => b.trim())
          .filter(b => b.length >= 2);
        if (boqValues.length === 0) {
          await ctx.reply("Please enter at least one valid BOQ reference (at least 2 characters).");
          return true;
        }
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Project not found.");
          return true;
        }
        const updatedList = [...project.boqList, ...boqValues];
        await prisma.project.update({
          where: { id: projectId },
          data: { boqList: updatedList },
        });
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply(`✅ Added ${boqValues.length} BOQ references to project "${project.name}".`, {
          reply_markup: mainMenuKeyboard(admin),
        });
      } catch (err) {
        console.error("Project bulk add BOQ error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to add BOQs.");
      }
      return true;
    }
    case "project_edit_boq_value": {
      try {
        const newBoq = text.trim();
        const projectId = data._adminProjectId;
        const boqIndex = data._boqEditIndex as number | undefined;
        if (!projectId || boqIndex === undefined) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Session lost.");
          return true;
        }
        if (newBoq.length < 2) {
          await ctx.reply("Please enter a valid BOQ reference (at least 2 characters).");
          return true;
        }
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project || boqIndex >= project.boqList.length) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Project or BOQ item not found.");
          return true;
        }
        const oldBoq = project.boqList[boqIndex];
        const updatedList = [...project.boqList];
        updatedList[boqIndex] = newBoq;
        await prisma.project.update({
          where: { id: projectId },
          data: { boqList: updatedList },
        });
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply(`✅ BOQ "${oldBoq}" has been updated to "${newBoq}" in project "${project.name}".`, {
          reply_markup: mainMenuKeyboard(admin),
        });
      } catch (err) {
        console.error("Project edit BOQ error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to edit BOQ.");
      }
      return true;
    }
    case "project_edit_name_value": {
      try {
        const newName = text.trim();
        const projectId = data._adminProjectId;
        if (!projectId) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Session lost.");
          return true;
        }
        if (newName.length < 2) {
          await ctx.reply("Please enter a valid project name (at least 2 characters).");
          return true;
        }
        const existing = await prisma.project.findFirst({
          where: { name: { equals: newName, mode: "insensitive" } },
        });
        if (existing) {
          await ctx.reply("❌ A project with that name already exists. Try another name:");
          return true;
        }
        const project = await prisma.project.update({
          where: { id: projectId },
          data: { name: newName },
        });
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply(`✅ Project has been renamed to "${newName}".`, {
          reply_markup: mainMenuKeyboard(admin),
        });
      } catch (err) {
        console.error("Project rename error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to rename project.");
      }
      return true;
    }
    case "boq_add_name": {
      try {
        const name = text.trim();
        if (name.length < 2) {
          await ctx.reply("Please enter a valid BOQ name (at least 2 characters).");
          return true;
        }
        const existing = await prisma.boq.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
        });
        if (existing) {
          await ctx.reply("❌ A BOQ with that name already exists. Try another name:");
          return true;
        }
        await prisma.boq.create({ data: { name } });
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply(`✅ BOQ "${name}" registered successfully.`, {
          reply_markup: mainMenuKeyboard(admin),
        });
      } catch (err) {
        console.error("BOQ add error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to add BOQ.");
      }
      return true;
    }
    case "boq_edit_name_value": {
      try {
        const newName = text.trim();
        const boqId = data._adminBoqId;
        if (!boqId) {
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Session lost.");
          return true;
        }
        if (newName.length < 2) {
          await ctx.reply("Please enter a valid BOQ name (at least 2 characters).");
          return true;
        }
        const existing = await prisma.boq.findFirst({
          where: { name: { equals: newName, mode: "insensitive" } },
        });
        if (existing) {
          await ctx.reply("❌ A BOQ with that name already exists. Try another name:");
          return true;
        }
        await prisma.boq.update({
          where: { id: boqId },
          data: { name: newName },
        });
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id));
        await ctx.reply(`✅ BOQ renamed to "${newName}".`, {
          reply_markup: mainMenuKeyboard(admin),
        });
      } catch (err) {
        console.error("BOQ edit error:", err);
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Failed to edit BOQ.");
      }
      return true;
    }
    case "awaiting_assign_user": {
      const assignRole = data.assignRole as string | undefined;
      if (!assignRole) {
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Role selection lost. Please start again with Manage Users.");
        return true;
      }
      try {
        await handleAdminAssignUser(ctx, text, assignRole);
      } catch (err) {
        console.error("handleAdminAssignUser error:", err);
        try {
          const fs = await import("fs");
          fs.appendFileSync(
            "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
            `[${new Date().toISOString()}] [handleAdminAssignUser] ${err instanceof Error ? err.stack : String(err)}\n\n`,
            "utf8"
          );
        } catch {}
        await clearDraft(BigInt(from.id));
        const admin = await requireAdministrator(BigInt(from.id)).catch(() => null);
        await ctx.reply("❌ An error occurred while assigning the role. Draft cleared.", {
          reply_markup: admin ? mainMenuKeyboard(admin) : undefined,
        });
      }
      return true;
    }
    case "awaiting_official_name_bulk": {
      return handleAdminOfficialNameBulk(ctx, text);
    }
    case "awaiting_official_name_value": {
      const targetUserId = data.targetUserId as string | undefined;
      if (!targetUserId) {
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Session lost.");
        return true;
      }
      const newFullName = text.trim();
      if (newFullName.length < 2) {
        await ctx.reply("Please enter a valid Official Name (at least 2 characters).");
        return true;
      }
      const updated = await setUserFullName(targetUserId, newFullName);
      await clearDraft(BigInt(from.id));
      const admin = await requireAdministrator(BigInt(from.id));
      await ctx.reply(
        `✅ <b>Official Company Name Linked!</b>\n\n` +
        `👤 User: @${esc(updated.telegramUsername ?? "user")}\n` +
        `📛 Official Name: <b>${esc(updated.fullName)}</b>\n\n` +
        `This official name will now be used across all MRs, PRs, PDFs, Excel exports, and Google Sheets.`,
        { parse_mode: "HTML", reply_markup: mainMenuKeyboard(admin) }
      );
      return true;
    }
    case "awaiting_approve_mr_number":
      await handleAdminMrApproveByNumber(ctx, text);
      return true;
    case "awaiting_reject_mr_number":
      await handleAdminMrRejectByNumber(ctx, text);
      return true;
    case "awaiting_reject_mr_remarks":
      await handleAdminMrRejectByNumber(ctx, data.mrNumber ?? text, text);
      return true;
    case "awaiting_reject_mr_remarks_id": {
      const mr = data.mrNumber
        ? await getMaterialRequestByMrNumber(data.mrNumber)
        : null;
      if (mr) {
        await handleMrRejectConfirmById(
          ctx,
          mr.id,
          text === "none" ? undefined : text
        );
      } else {
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Material request not found. Operation cancelled.");
      }
      return true;
    }
    case "awaiting_final_approve_mr":
      await handleAdminFinalApproveByNumber(ctx, text);
      return true;
    case "awaiting_final_reject_mr":
      await handleAdminFinalRejectByNumber(ctx, text);
      return true;
    case "awaiting_final_reject_remarks":
      await handleAdminFinalRejectByNumber(ctx, data.mrNumber ?? text, text);
      return true;
    case "awaiting_final_reject_remarks_id": {
      const mr = data.mrNumber
        ? await getMaterialRequestByMrNumber(data.mrNumber)
        : null;
      if (mr) {
        await handlePurchaseRejectConfirmById(
          ctx,
          mr.id,
          text === "none" ? undefined : text
        );
      } else {
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Material request not found. Operation cancelled.");
      }
      return true;
    }
    case "awaiting_pr_reject_remarks": {
      const prId = data.prId;
      if (prId) {
        try {
          const pr = await getPurchaseRequestById(prId);
          if (pr) {
            const admin = await requireAdministrator(BigInt(from.id));
            await rejectPurchaseRequest(pr.id, admin.id, text === "none" ? undefined : text);
            await clearDraft(BigInt(from.id));
            await ctx.reply(`❌ PR *${pr.prNumber}* rejected.`, {
              parse_mode: "Markdown",
              reply_markup: mainMenuKeyboard(admin),
            });
          } else {
            await clearDraft(BigInt(from.id));
            await ctx.reply("❌ Purchase request not found. Operation cancelled.");
          }
        } catch (err) {
          console.error("Direct PR reject confirm error:", err);
          await clearDraft(BigInt(from.id));
          await ctx.reply("❌ Failed to reject purchase request. Draft cleared.");
        }
      } else {
        await clearDraft(BigInt(from.id));
        await ctx.reply("❌ Purchase request details missing. Operation cancelled.");
      }
      return true;
    }
    default:
      return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Project Management Handler Functions
// ──────────────────────────────────────────────────────────────────────────────

export async function handleManageProjects(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await clearDraft(BigInt(from.id));

  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
  });

  await ctx.reply(
    "📁 <b>Project Management</b>\n\n" +
    "Select an existing project to manage, or use the options below to add a project name or manage by project type:\n\n" +
    "<b>Registered Projects:</b>",
    {
      parse_mode: "HTML",
      reply_markup: manageProjectsKeyboard(projects),
    }
  );
}

/** New handler specifically for Register BOQ button */
export async function handleRegisterBoq(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await clearDraft(BigInt(from.id));

  const projects = await prisma.project.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  await ctx.reply(
    "📝 <b>Register BOQ</b>\n\nSelect a project to add BOQ references to:",
    {
      parse_mode: "HTML",
      reply_markup: registerBoqProjectKeyboard(projects),
    }
  );
}

/** Callback for when a project is selected from Register BOQ */
export async function handleRegisterBoqProjectCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await upsertDraft(BigInt(from.id), "project_add_boq", { flowType: "mr", _adminProjectId: projectId }, admin.id, "mr");
  await ctx.reply(
    `📝 <b>Register BOQ for ${esc(project.name)}</b>\n\nEnter the BOQ Reference / Code to add (or multiple separated by commas/newlines):`,
    {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    }
  );
}

// ============================================================
// GLOBAL BOQ MANAGEMENT
// ============================================================

export async function handleManageBoq(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await clearDraft(BigInt(from.id));

  const boqs = await prisma.boq.findMany({
    orderBy: { name: "asc" },
  });

  await ctx.reply(
    "📝 <b>Manage BOQ</b>\n\nRegistered BOQs:",
    {
      parse_mode: "HTML",
      reply_markup: manageBoqKeyboard(boqs),
    }
  );
}

export async function handleBoqManageCallback(ctx: Context, boqId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const boq = await prisma.boq.findUnique({ where: { id: boqId } });

  if (!boq) {
    await ctx.answerCallbackQuery({ text: "BOQ not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `📝 <b>BOQ: ${esc(boq.name)}</b>\nStatus: ${boq.isActive ? "🟢 Active" : "🔴 Inactive"}`,
    {
      parse_mode: "HTML",
      reply_markup: boqActionKeyboard(boqId),
    }
  );
}

export async function handleBoqAddNewCallback(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();
  await upsertDraft(BigInt(from.id), "boq_add_name", { flowType: "mr" }, admin.id, "mr");
  await ctx.reply("➕ Enter the BOQ name to add:", {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
}

export async function handleBoqEditNameCallback(ctx: Context, boqId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();
  await upsertDraft(BigInt(from.id), "boq_edit_name_value", { flowType: "mr", _adminBoqId: boqId }, admin.id, "mr");
  await ctx.reply("✏️ Enter the new BOQ name:", {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
}

export async function handleBoqDeactivateCallback(ctx: Context, boqId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await prisma.boq.update({
    where: { id: boqId },
    data: { isActive: false },
  });

  await ctx.answerCallbackQuery({ text: "BOQ deactivated" });
  const boq = await prisma.boq.findUnique({ where: { id: boqId } });
  if (boq) {
    await ctx.reply(
      `📝 <b>BOQ: ${esc(boq.name)}</b>\nStatus: ${boq.isActive ? "🟢 Active" : "🔴 Inactive"}`,
      {
        parse_mode: "HTML",
        reply_markup: boqActionKeyboard(boqId),
      }
    );
  }
}

export async function handleBoqReactivateCallback(ctx: Context, boqId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await prisma.boq.update({
    where: { id: boqId },
    data: { isActive: true },
  });

  await ctx.answerCallbackQuery({ text: "BOQ reactivated" });
  const boq = await prisma.boq.findUnique({ where: { id: boqId } });
  if (boq) {
    await ctx.reply(
      `📝 <b>BOQ: ${esc(boq.name)}</b>\nStatus: ${boq.isActive ? "🟢 Active" : "🔴 Inactive"}`,
      {
        parse_mode: "HTML",
        reply_markup: boqActionKeyboard(boqId),
      }
    );
  }
}

export async function handleBoqDeleteCallback(ctx: Context, boqId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await prisma.boq.delete({
    where: { id: boqId },
  });

  await ctx.answerCallbackQuery({ text: "BOQ deleted" });
  await handleManageBoq(ctx);
}

export async function handleProjectManageCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  
  let boqMsg = project.boqList.length > 0 
    ? project.boqList.map((boq, i) => `${i + 1}. ${boq}`).join("\n")
    : "_No BOQ references registered yet._";

  await ctx.reply(
    `📂 <b>Project: ${esc(project.name)}</b>\n` +
    `🏷 <b>Project Type:</b> ${esc(project.projectType ?? "Not specified")}\n` +
    `Status: ${project.isActive ? "🟢 Active" : "🔴 Inactive"}\n\n` +
    `<b>BOQ References:</b>\n${boqMsg}`,
    {
      parse_mode: "HTML",
      reply_markup: projectActionKeyboard(projectId),
    }
  );
}

export async function handleProjectAddNewCallback(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();

  await upsertDraft(BigInt(from.id), "project_add_name", { flowType: "mr" }, admin.id, "mr");
  await ctx.reply(
    "➕ <b>Enter Project Name</b>\n\nPlease enter the name of the new project:",
    {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    }
  );
}

export async function handleProjectAddBoqCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();

  await upsertDraft(BigInt(from.id), "project_add_boq", { flowType: "mr", _adminProjectId: projectId }, admin.id, "mr");
  await ctx.reply("➕ Enter the *BOQ Reference / Code* to add under this project:", {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
}

export async function handleProjectBulkAddBoqCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();

  await upsertDraft(BigInt(from.id), "project_bulk_add_boq", { flowType: "mr", _adminProjectId: projectId }, admin.id, "mr");
  await ctx.reply("➕ Enter multiple *BOQ References / Codes*, one per line or separated by commas:", {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
}

export async function handleProjectDeactivateCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await prisma.project.update({
    where: { id: projectId },
    data: { isActive: false },
  });

  await ctx.answerCallbackQuery({ text: "Project deactivated" });
  await handleManageProjects(ctx);
}

export async function handleProjectReactivateCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await prisma.project.update({
    where: { id: projectId },
    data: { isActive: true },
  });

  await ctx.answerCallbackQuery({ text: "Project reactivated" });
  await handleManageProjects(ctx);
}

// ──────────────────────────────────────────────────────────────────────────────
// BOQ Edit / Remove for Admin CRUD
// ──────────────────────────────────────────────────────────────────────────────

export async function handleProjectEditBoqCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  if (project.boqList.length === 0) {
    await ctx.answerCallbackQuery({ text: "No BOQ items to edit" });
    await ctx.reply("This project has no BOQ references yet. Add one first.", {
      reply_markup: projectActionKeyboard(projectId),
    });
    return;
  }

  await ctx.answerCallbackQuery();
  const boqList = project.boqList.map((b, i) => `${i + 1}. ${b}`).join("\n");
  await upsertDraft(BigInt(from.id), "project_edit_boq_select", { _adminProjectId: projectId, flowType: "mr" }, admin.id, "mr");

  const { InlineKeyboard: IKB } = await import("grammy");
  const kb = new IKB();
  project.boqList.forEach((boq, idx) => {
    kb.text(`✏️ ${boq}`, `boq_edit_select:${projectId}:${idx}`).row();
  });
  kb.text("❌ Cancel", "admin_cancel");

  await ctx.reply(
    `<b>Select the BOQ item to edit:</b>\n\n${boqList}`,
    { parse_mode: "HTML", reply_markup: kb }
  );
}

export async function handleBoqEditSelectCallback(ctx: Context, projectId: string, boqIndex: number) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project || boqIndex >= project.boqList.length) {
    await ctx.answerCallbackQuery({ text: "Invalid selection" });
    return;
  }

  const currentBoq = project.boqList[boqIndex];
  await ctx.answerCallbackQuery();
  await upsertDraft(BigInt(from.id), "project_edit_boq_value", {
    _adminProjectId: projectId,
    _boqEditIndex: boqIndex,
    flowType: "mr",
  }, admin.id, "mr");

  await ctx.reply(
    `✏️ Editing BOQ: <b>${esc(currentBoq)}</b>\n\nType the new BOQ reference to replace it:`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
}

export async function handleProjectRemoveBoqCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  if (project.boqList.length === 0) {
    await ctx.answerCallbackQuery({ text: "No BOQ items to remove" });
    await ctx.reply("This project has no BOQ references to remove.", {
      reply_markup: projectActionKeyboard(projectId),
    });
    return;
  }

  await ctx.answerCallbackQuery();
  const boqList = project.boqList.map((b, i) => `${i + 1}. ${b}`).join("\n");

  const { InlineKeyboard: IKB } = await import("grammy");
  const kb = new IKB();
  project.boqList.forEach((boq, idx) => {
    kb.text(`🗑 ${boq}`, `boq_remove_confirm:${projectId}:${idx}`).row();
  });
  kb.text("❌ Cancel", "admin_cancel");

  await ctx.reply(
    `<b>Select the BOQ item to remove:</b>\n\n${boqList}`,
    { parse_mode: "HTML", reply_markup: kb }
  );
}

export async function handleBoqRemoveConfirmCallback(ctx: Context, projectId: string, boqIndex: number) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project || boqIndex >= project.boqList.length) {
    await ctx.answerCallbackQuery({ text: "Invalid selection" });
    return;
  }

  const removedBoq = project.boqList[boqIndex];
  const newList = project.boqList.filter((_, i) => i !== boqIndex);
  await prisma.project.update({ where: { id: projectId }, data: { boqList: newList } });

  await ctx.answerCallbackQuery({ text: "BOQ removed" });
  await ctx.reply(
    `🗑 BOQ reference <b>${esc(removedBoq)}</b> has been removed from <b>${esc(project.name)}</b>.`,
    { parse_mode: "HTML", reply_markup: mainMenuKeyboard(admin) }
  );
}

export async function handleProjectEditNameCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await upsertDraft(BigInt(from.id), "project_edit_name_value", {
    _adminProjectId: projectId,
    flowType: "mr",
  }, admin.id, "mr");

  await ctx.reply(
    `✏️ Current Name: <b>${esc(project.name)}</b>\n\nEnter the new project name:`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
}

export async function handleProjectDeleteCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { materialRequests: true },
  });

  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  await ctx.answerCallbackQuery();

  if (project.materialRequests.length > 0) {
    await ctx.reply(
      `❌ Cannot delete project <b>${esc(project.name)}</b> because it has <b>${project.materialRequests.length}</b> material request(s) associated with it.\n\nYou should Deactivate it instead.`,
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard(admin) }
    );
    return;
  }

  try {
    await prisma.project.delete({ where: { id: projectId } });
    await ctx.reply(
      `🗑 Project <b>${esc(project.name)}</b> has been deleted completely.`,
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard(admin) }
    );
  } catch (err) {
    console.error("Project delete error:", err);
    await ctx.reply("❌ Failed to delete project. Please try again.", {
      reply_markup: mainMenuKeyboard(admin),
    });
  }
}

export async function handleProjectEditTypeCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const admin = await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    await ctx.reply("Project not found.");
    return;
  }

  await upsertDraft(
    BigInt(from.id),
    "project_edit_type_value",
    { flowType: "mr", _adminProjectId: projectId },
    admin.id,
    "mr"
  );

  const currentTypeMsg = project.projectType ? `Current Type: <b>${esc(project.projectType)}</b>\n\n` : "";
  await ctx.reply(
    `🏷 <b>Project Type for "${esc(project.name)}"</b>\n${currentTypeMsg}` +
    `Please write the type of project (e.g., Building, Road, Residential, Infrastructure):`,
    {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    }
  );
}

export async function handleProjectTypeMenu(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await requireAdministrator(BigInt(from.id));
  await ctx.answerCallbackQuery();

  const projects = await prisma.project.findMany({
    select: { id: true, name: true, projectType: true, isActive: true },
    orderBy: { name: "asc" },
  });

  const kb = new InlineKeyboard();
  projects.forEach((p) => {
    const typeLabel = p.projectType ? ` [${p.projectType}]` : " [No Type]";
    kb.text(
      `${p.isActive ? "✅" : "❌"} ${p.name}${typeLabel}`,
      `proj_set_type:${p.id}`
    ).row();
  });
  kb.text("🔙 Back to Projects", "project_list");

  await ctx.reply(
    "🏷 <b>Project Type</b>\n\nSelect a project below to write its Project Type:",
    {
      parse_mode: "HTML",
      reply_markup: kb,
    }
  );
}



