import { Bot, webhookCallback, InputFile, type Context } from "grammy";
import { handleStart, handleCancel } from "./handlers/start";
import { handleHelp } from "./handlers/help";
import {
  handleMyRequests,
  handleRequestStatus,
  handleStatusDraftMessage,
  handleMyRequestsFilterCallback,
} from "./handlers/my-requests";
import {
  handleViewAllRequests,
  handleAdminFilter,
  handleApproveMr,
  handleRejectMr,
  handleMrApproveCallback,
  handleMrRejectCallback,
  handleMrApproveConfirm,
  handlePurchaseApproveCallback,
  handlePurchaseRejectCallback,
  handlePurchaseApproveConfirm,
  handlePrApproveCallback,
  handlePrRejectCallback,
  handlePrApproveConfirm,
  handleSearchCommand,
  handleReportCommand,
  handleMrViewCallback,
  handleManageUsers,
  handleSetRoleCallback,
  handleManageAssignCallback,
  handleAdminCancel,
  handleAdminDraftMessage,
  handleManageProjects,
  handleProjectManageCallback,
  handleProjectAddNewCallback,
  handleProjectAddBoqCallback,
  handleProjectBulkAddBoqCallback,
  handleProjectDeactivateCallback,
  handleProjectReactivateCallback,
  handleProjectEditBoqCallback,
  handleProjectRemoveBoqCallback,
  handleBoqEditSelectCallback,
  handleBoqRemoveConfirmCallback,
  handleProjectEditNameCallback,
  handleProjectDeleteCallback,
  handleRegisterBoq,
  handleRegisterBoqProjectCallback,
  handleManageBoq,
  handleBoqManageCallback,
  handleBoqAddNewCallback,
  handleBoqEditNameCallback,
  handleBoqDeactivateCallback,
  handleBoqReactivateCallback,
  handleBoqDeleteCallback,
  handleProjectEditTypeCallback,
  handleProjectTypeMenu,
} from "./handlers/admin";
import {
  startNewMaterialRequest,
  handleMrDraftMessage,
  handleRemoveItemCallback,
  handleEditItemCallback,
  handleEditItemActionCallback,
  showItemsMenu,
  handleSelectProjectCallback,
  handleSelectProjectTypeCallback,
  handleSelectBoqCallback,
} from "./handlers/mr-form";
import {
  handleApprovedRequests,
  startPurchaseFromMr,
  handlePurchaseDraftMessage,
  handleEditQtyCallback,
  handleSetPriceCallback,
  handlePurchaseHistory,
  handleSelectSupplierCallback,
  handleSupplierRegisterNewCallback,
  handleSupplierSearchAgainCallback,
  handlePurchaseCancelCallback,
  handleResumePrDraft,
  handleDeletePrDraft,
  handlePurchaseHistoryFilter,
  handlePendingPurchaseRequests,
  handlePrViewCallback,
  handleApprovedRequestsFilter,
} from "./handlers/purchase-form";
import {
  handleSupplierMaster,
  handleSupplierDraftMessage,
  SUPPLIER_MENU_LABELS,
} from "./handlers/supplier-master";
import {
  handleDeliveryTracking,
  handleDeliveryDeliveredCallback,
  handleDeliveryDelayedCallback,
  handleDeliveryPurchasedCallback,
  handleDeliveryCompletedCallback,
} from "./handlers/delivery";
import { MENU_LABELS } from "./keyboards";
import { findOrCreateUser, requireUser, hasRole } from "@/lib/auth";
import { getMaterialRequestById } from "@/lib/material-request";
import { generateMaterialRequestPdf } from "@/lib/export/pdf";
import { generateMaterialRequestExcel } from "@/lib/export/excel";
import { getDraft, getDraftData } from "./drafts";

let botInstance: Bot | null = null;

export function createBot(): Bot {
  if (botInstance) return botInstance;

  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN environment variable is required");
  }

  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (from) {
      await findOrCreateUser(
        BigInt(from.id),
        from.username,
        [from.first_name, from.last_name].filter(Boolean).join(" ")
      );
    }
    await next();
  });

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("search", async (ctx) => {
    await handleSearchCommand(ctx, ctx.match as string);
  });
  bot.command("report", async (ctx) => {
    await handleReportCommand(ctx, ctx.match as string);
  });
  bot.command("resync", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    try {
      const user = await requireUser(BigInt(from.id));
      if (!hasRole(user, "ADMINISTRATOR")) {
        await ctx.reply("❌ Admin only command.");
        return;
      }
      await ctx.reply("🔄 Resyncing MR sheet in order... please wait.");
      const { syncAllMrRowsInOrder } = await import("@/lib/google-sheets");
      await syncAllMrRowsInOrder();
      await ctx.reply("✅ MR sheet resync complete. All records now ordered by MR number.");
    } catch (err) {
      console.error("Resync error:", err);
      await ctx.reply("❌ Resync failed. Check bot logs.");
    }
  });
  bot.command("dump", async (ctx) => {
    try {
      const { default: prisma } = await import("@/lib/prisma");
      const mrs = await prisma.materialRequest.findMany({
        orderBy: { mrNumber: "asc" },
        select: { mrNumber: true, status: true, projectName: true },
      });
      const list = mrs.map((m: any) => `${m.mrNumber} (${m.status}) - ${m.projectName}`).join("\n");
      await ctx.reply(`📋 DB MR List:\n\n${list || "None"}`);
    } catch (err: any) {
      await ctx.reply(`❌ Dump failed: ${err.message}`);
    }
  });

  bot.hears(MENU_LABELS.NEW_MR, startNewMaterialRequest);
  bot.hears(MENU_LABELS.MY_REQUESTS, handleMyRequests);
  bot.hears(MENU_LABELS.STATUS, handleRequestStatus);
  bot.hears(MENU_LABELS.HELP, handleHelp);
  bot.hears(MENU_LABELS.APPROVED_MRS, handleApprovedRequests);
  bot.hears(MENU_LABELS.PENDING_PRS, handlePendingPurchaseRequests);
  bot.hears(MENU_LABELS.PURCHASE_HISTORY, handlePurchaseHistory);
  bot.hears(MENU_LABELS.SUPPLIER_MASTER, handleSupplierMaster);
  bot.hears(MENU_LABELS.DELIVERY_TRACKING, handleDeliveryTracking);
  bot.hears(MENU_LABELS.VIEW_ALL, handleViewAllRequests);
  bot.hears(MENU_LABELS.MANAGE_USERS, handleManageUsers);
  bot.hears(MENU_LABELS.MANAGE_PROJECTS, handleManageProjects);
  bot.hears(MENU_LABELS.REGISTER_BOQ, handleManageBoq);
  bot.hears(MENU_LABELS.APPROVE_MR, handleApproveMr);
  bot.hears(MENU_LABELS.REJECT_MR, handleRejectMr);
  bot.hears(MENU_LABELS.CANCEL, handleCancel);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith("admin_filter:")) {
      await handleAdminFilter(ctx, data.replace("admin_filter:", ""));
      return;
    }
    if (data.startsWith("register_boq_project:")) {
      await handleRegisterBoqProjectCallback(ctx, data.replace("register_boq_project:", ""));
      return;
    }
    if (data === "boq_list") {
      await handleManageBoq(ctx);
      return;
    }
    if (data === "boq_add_new") {
      await handleBoqAddNewCallback(ctx);
      return;
    }
    if (data.startsWith("boq_manage:")) {
      await handleBoqManageCallback(ctx, data.replace("boq_manage:", ""));
      return;
    }
    if (data.startsWith("boq_edit_name:")) {
      await handleBoqEditNameCallback(ctx, data.replace("boq_edit_name:", ""));
      return;
    }
    if (data.startsWith("boq_deactivate:")) {
      await handleBoqDeactivateCallback(ctx, data.replace("boq_deactivate:", ""));
      return;
    }
    if (data.startsWith("boq_reactivate:")) {
      await handleBoqReactivateCallback(ctx, data.replace("boq_reactivate:", ""));
      return;
    }
    if (data.startsWith("boq_delete:")) {
      await handleBoqDeleteCallback(ctx, data.replace("boq_delete:", ""));
      return;
    }
    if (data.startsWith("select_project:")) {
      await handleSelectProjectCallback(ctx, data.replace("select_project:", ""));
      return;
    }
    if (data.startsWith("select_proj_type:")) {
      await handleSelectProjectTypeCallback(ctx, data.replace("select_proj_type:", ""));
      return;
    }
    if (data.startsWith("select_boq:")) {
      await handleSelectBoqCallback(ctx, data.replace("select_boq:", ""));
      return;
    }
    if (data.startsWith("ph_filter:")) {
      await handlePurchaseHistoryFilter(ctx, data.replace("ph_filter:", ""));
      return;
    }
    if (data.startsWith("ar_filter:")) {
      await handleApprovedRequestsFilter(ctx, data.replace("ar_filter:", ""));
      return;
    }
    if (data.startsWith("myreq_filter:")) {
      await handleMyRequestsFilterCallback(ctx, data);
      return;
    }
    if (data.startsWith("project_manage:")) {
      await handleProjectManageCallback(ctx, data.replace("project_manage:", ""));
      return;
    }
    if (data === "project_add_new" || data === "project_add_name_start") {
      await handleProjectAddNewCallback(ctx);
      return;
    }
    if (data === "project_type_menu") {
      await handleProjectTypeMenu(ctx);
      return;
    }
    if (data.startsWith("proj_set_type:")) {
      await handleProjectEditTypeCallback(ctx, data.replace("proj_set_type:", ""));
      return;
    }
    if (data.startsWith("project_add_boq:")) {
      await handleProjectAddBoqCallback(ctx, data.replace("project_add_boq:", ""));
      return;
    }
    if (data.startsWith("project_bulk_add_boq:")) {
      await handleProjectBulkAddBoqCallback(ctx, data.replace("project_bulk_add_boq:", ""));
      return;
    }
    if (data.startsWith("project_edit_boq:")) {
      await handleProjectEditBoqCallback(ctx, data.replace("project_edit_boq:", ""));
      return;
    }
    if (data.startsWith("project_remove_boq:")) {
      await handleProjectRemoveBoqCallback(ctx, data.replace("project_remove_boq:", ""));
      return;
    }
    if (data.startsWith("boq_edit_select:")) {
      const parts = data.replace("boq_edit_select:", "").split(":");
      await handleBoqEditSelectCallback(ctx, parts[0], parseInt(parts[1], 10));
      return;
    }
    if (data.startsWith("boq_remove_confirm:")) {
      const parts = data.replace("boq_remove_confirm:", "").split(":");
      await handleBoqRemoveConfirmCallback(ctx, parts[0], parseInt(parts[1], 10));
      return;
    }
    if (data.startsWith("project_edit_name:")) {
      await handleProjectEditNameCallback(ctx, data.replace("project_edit_name:", ""));
      return;
    }
    if (data.startsWith("project_edit_type:")) {
      await handleProjectEditTypeCallback(ctx, data.replace("project_edit_type:", ""));
      return;
    }
    if (data.startsWith("project_delete:")) {
      await handleProjectDeleteCallback(ctx, data.replace("project_delete:", ""));
      return;
    }
    if (data.startsWith("project_deactivate:")) {
      await handleProjectDeactivateCallback(ctx, data.replace("project_deactivate:", ""));
      return;
    }
    if (data.startsWith("project_reactivate:")) {
      await handleProjectReactivateCallback(ctx, data.replace("project_reactivate:", ""));
      return;
    }
    if (data === "project_list") {
      await handleManageProjects(ctx);
      return;
    }
    if (data.startsWith("mr_view:")) {
      await handleMrViewCallback(ctx, data.replace("mr_view:", ""));
      return;
    }
    if (data.startsWith("mr_approve_confirm:")) {
      await handleMrApproveConfirm(ctx, data.replace("mr_approve_confirm:", ""));
      return;
    }
    if (data.startsWith("mr_approve:")) {
      await handleMrApproveCallback(ctx, data.replace("mr_approve:", ""));
      return;
    }
    if (data.startsWith("mr_reject:")) {
      await handleMrRejectCallback(ctx, data.replace("mr_reject:", ""));
      return;
    }
    if (data.startsWith("purchase_approve_confirm:")) {
      await handlePurchaseApproveConfirm(
        ctx,
        data.replace("purchase_approve_confirm:", "")
      );
      return;
    }
    if (data.startsWith("purchase_approve:")) {
      await handlePurchaseApproveCallback(
        ctx,
        data.replace("purchase_approve:", "")
      );
      return;
    }
    if (data.startsWith("purchase_reject:")) {
      await handlePurchaseRejectCallback(
        ctx,
        data.replace("purchase_reject:", "")
      );
      return;
    }
    if (data.startsWith("pr_approve_confirm:")) {
      await handlePrApproveConfirm(ctx, data.replace("pr_approve_confirm:", ""));
      return;
    }
    if (data.startsWith("pr_approve:")) {
      await handlePrApproveCallback(ctx, data.replace("pr_approve:", ""));
      return;
    }
    if (data.startsWith("pr_reject:")) {
      await handlePrRejectCallback(ctx, data.replace("pr_reject:", ""));
      return;
    }
    if (data.startsWith("pr_view:")) {
      await handlePrViewCallback(ctx, data.replace("pr_view:", ""));
      return;
    }
    if (data.startsWith("purchase_start:")) {
      await startPurchaseFromMr(ctx, data.replace("purchase_start:", ""));
      return;
    }
    if (data.startsWith("select_supplier:")) {
      await handleSelectSupplierCallback(ctx, data.replace("select_supplier:", ""));
      return;
    }
    if (data === "supplier_register_new") {
      await handleSupplierRegisterNewCallback(ctx);
      return;
    }
    if (data === "supplier_search_again") {
      await handleSupplierSearchAgainCallback(ctx);
      return;
    }
    if (data === "purchase_cancel") {
      await handlePurchaseCancelCallback(ctx);
      return;
    }
    if (data.startsWith("resume_pr_draft:")) {
      await handleResumePrDraft(ctx, data.replace("resume_pr_draft:", ""));
      return;
    }
    if (data.startsWith("delete_pr_draft:")) {
      await handleDeletePrDraft(ctx, data.replace("delete_pr_draft:", ""));
      return;
    }
    if (data.startsWith("manage_assign:")) {
      await handleManageAssignCallback(ctx, data.replace("manage_assign:", ""));
      return;
    }
    if (data.startsWith("set_role:")) {
      const [, userId, role] = data.split(":");
      await handleSetRoleCallback(ctx, userId, role as never);
      return;
    }
    if (data.startsWith("remove_item:")) {
      const idx = data.replace("remove_item:", "");
      if (idx === "cancel") {
        await ctx.answerCallbackQuery({ text: "Cancelled" });
        return;
      }
      await handleRemoveItemCallback(ctx, parseInt(idx, 10));
      return;
    }
    if (data.startsWith("edit_item:")) {
      const parts = data.replace("edit_item:", "").split(":");
      
      if (parts[0] === "cancel") {
        await ctx.answerCallbackQuery({ text: "Cancelled" });
        const draft = await getDraft(BigInt(ctx.from!.id));
        if (draft) {
          const data = getDraftData(draft);
          await showItemsMenu(ctx, data);
        }
        return;
      }
      
      if (parts.length === 1) {
        // Case: just index (selecting which item to edit)
        const idx = parseInt(parts[0], 10);
        await handleEditItemCallback(ctx, idx);
        return;
      }

      // Case: action:index (editing specific field)
      const action = parts[0];
      const idxStr = parts[1];
      const idx = parseInt(idxStr, 10);
      await handleEditItemActionCallback(ctx, action, idx);
      return;
    }
    if (data.startsWith("edit_qty:")) {
      const idx = data.replace("edit_qty:", "");
      if (idx === "cancel") {
        await ctx.answerCallbackQuery({ text: "Cancelled" });
        return;
      }
      await handleEditQtyCallback(ctx, parseInt(idx, 10));
      return;
    }
    if (data.startsWith("set_price:")) {
      const idx = data.replace("set_price:", "");
      if (idx === "cancel") {
        await ctx.answerCallbackQuery({ text: "Cancelled" });
        return;
      }
      await handleSetPriceCallback(ctx, parseInt(idx, 10));
      return;
    }
    if (data.startsWith("export_pdf:")) {
      await handleExportPdf(ctx, data.replace("export_pdf:", ""));
      return;
    }
    if (data.startsWith("export_excel:")) {
      await handleExportExcel(ctx, data.replace("export_excel:", ""));
      return;
    }
    if (data.startsWith("delivery_delivered:")) {
      await handleDeliveryDeliveredCallback(ctx, data.replace("delivery_delivered:", ""));
      return;
    }
    if (data.startsWith("delivery_delayed:")) {
      await handleDeliveryDelayedCallback(ctx, data.replace("delivery_delayed:", ""));
      return;
    }
    if (data.startsWith("delivery_purchased:")) {
      await handleDeliveryPurchasedCallback(ctx, data.replace("delivery_purchased:", ""));
      return;
    }
    if (data.startsWith("delivery_completed:")) {
      await handleDeliveryCompletedCallback(ctx, data.replace("delivery_completed:", ""));
      return;
    }
    if (data === "admin_cancel") {
      await handleAdminCancel(ctx);
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.on("message:text", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const text = ctx.message.text;

    if (Object.values(SUPPLIER_MENU_LABELS).includes(text)) {
      const handled = await handleSupplierDraftMessage(ctx, text);
      if (handled) return;
    }

    const draft = await getDraft(BigInt(from.id));
    if (draft && draft.step !== "idle") {
      const data = getDraftData(draft);

      if (draft.flowType === "mr") {
        const handled = await handleMrDraftMessage(ctx, text);
        if (handled) return;
      }

      if (draft.flowType === "purchase") {
        const handled = await handlePurchaseDraftMessage(ctx, text);
        if (handled) return;
      }

      if (draft.flowType === "supplier") {
        const handled = await handleSupplierDraftMessage(ctx, text);
        if (handled) return;
      }

      if (draft.step === "awaiting_status_mr_number") {
        await handleStatusDraftMessage(ctx, text);
        return;
      }

      const adminHandled = await handleAdminDraftMessage(
        ctx,
        text,
        draft.step,
        data
      );
      if (adminHandled) return;
    }

    const menuActions = Object.values(MENU_LABELS);
    const draftActions = ["✅ Submit Request", "✅ Submit Purchase Request"];
    if (
      menuActions.includes(text as (typeof menuActions)[number]) ||
      draftActions.includes(text)
    ) {
      return;
    }
  });

  bot.catch(async (err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? (err.stack ?? "") : (err as any).stack ?? "";
    console.error("Bot error:", errorMsg, "\n", errorStack);

    try {
      const fs = await import("fs");
      const timestamp = new Date().toISOString();
      fs.appendFileSync(
        "c:\\Users\\HP\\Desktop\\tele_bot\\bot-errors.log",
        `[${timestamp}] ${errorMsg}\n${errorStack}\n\n`,
        "utf8"
      );
    } catch (logErr) {
      console.error("Failed to write error log:", logErr);
    }

    // Only send a user-visible reply for non-Telegram API errors (those usually resolve on retry)
    try {
      if (!(errorMsg.includes("400") || errorMsg.includes("ETELEGRAM"))) {
        await err.ctx?.reply("⚠️ Something went wrong processing your request. Please try again or use /start to restart.");
      }
    } catch {
      // ignore reply errors
    }
  });

  botInstance = bot;
  return bot;
}

async function handleExportPdf(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);

  if (!mr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  const canExport =
    hasRole(user, "ADMINISTRATOR", "VIEWER", "PURCHASER") ||
    mr.requestedById === user.id;

  if (!canExport) {
    await ctx.answerCallbackQuery({ text: "Access denied" });
    return;
  }

  await ctx.answerCallbackQuery({ text: "Generating PDF..." });

  const pdf = await generateMaterialRequestPdf(mr);
  await ctx.replyWithDocument(new InputFile(pdf, `${mr.mrNumber}.pdf`), {
    caption: `📄 ${mr.mrNumber}`,
  });
}

async function handleExportExcel(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);

  if (!mr) {
    await ctx.answerCallbackQuery({ text: "Not found" });
    return;
  }

  const canExport =
    hasRole(user, "ADMINISTRATOR", "VIEWER", "PURCHASER") ||
    mr.requestedById === user.id;

  if (!canExport) {
    await ctx.answerCallbackQuery({ text: "Access denied" });
    return;
  }

  await ctx.answerCallbackQuery({ text: "Generating Excel..." });

  const excel = await generateMaterialRequestExcel(mr);
  await ctx.replyWithDocument(new InputFile(excel, `${mr.mrNumber}.xlsx`), {
    caption: `📊 ${mr.mrNumber}`,
  });
}

export function getWebhookHandler() {
  const bot = createBot();
  return webhookCallback(bot, "std/http");
}

export { botInstance as bot };
