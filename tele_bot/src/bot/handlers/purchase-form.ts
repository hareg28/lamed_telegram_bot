import { Keyboard, InlineKeyboard, type Context } from "grammy";
import { requirePurchaser, requireUser, hasRole } from "@/lib/auth";
import {
  parseNumberInput,
  calculateItemTotals,
  formatMoney,
  formatDate,
  getRequesterDisplayName,
  validatePhone,
  validateAccount,
  type DraftData,
  type PurchaseDraftItem,
} from "@/lib/calculations";
import { getMaterialRequestById, getApprovedMaterialRequests, hasRemainingItems } from "@/lib/material-request";
import {
  submitPurchaseRequest,
  savePurchaseRequestDraft,
  getDraftPurchaseRequests,
  getPurchaseRequestsByPurchaser,
} from "@/lib/purchase-request";
import {
  getDraft,
  upsertDraft,
  setDraftStep,
  clearDraft,
  getDraftData,
  updateDraftData,
} from "../drafts";
import {
  formatPurchaseDraftReview,
  formatPurchaseItemList,
  formatMrListItem,
  formatPrDetails,
  formatPrListItem,
} from "../formatters";
import {
  cancelKeyboard,
  skipKeyboard,
  purchaseItemsMenuKeyboard,
  purchaseReviewKeyboard,
  purchaseHistoryFilterKeyboard,
  approvedRequestsFilterKeyboard,
  mainMenuKeyboard,
  editQtyKeyboard,
  setPriceKeyboard,
  purchaserMrKeyboard,
  vatYesNoKeyboard,
  priceEntryModeKeyboard,
  prActionKeyboard,
  MENU_LABELS,
} from "../keyboards";
import { searchSuppliersForPurchase } from "./supplier-master";
import prisma from "@/lib/prisma";

// ──────────────────────────────────────────────────────────────────────────────
// Local keyboards
// ──────────────────────────────────────────────────────────────────────────────

function supplierSearchResultKeyboard(
  results: Array<{ id: string; name: string; companyName?: string }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  results.forEach((s, idx) => {
    kb.text(`${idx + 1}. ${s.name}${s.companyName ? ` (${s.companyName})` : ""}`,
      `select_supplier:${s.id}`);
    if ((idx + 1) % 2 === 0) kb.row();
  });
  if (results.length % 2 !== 0) kb.row();
  kb.text("➕ Register New Supplier", "supplier_register_new");
  kb.row().text("❌ Cancel", "purchase_cancel");
  return kb;
}

// ──────────────────────────────────────────────────────────────────────────────
// Approved MR list
// ──────────────────────────────────────────────────────────────────────────────

async function showApprovedRequestsFilters(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.reply("❌ You don't have purchaser access.");
    return;
  }

  await ctx.reply("🛒 Approved Material Requests\n\nSelect a filter to view requests:", {
    reply_markup: approvedRequestsFilterKeyboard(),
  });
}

async function showFilteredApprovedRequests(ctx: Context, options?: { status?: string | string[]; dateFrom?: Date; dateTo?: Date }) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.reply("❌ You don't have purchaser access.");
    return;
  }

  const requests = await getApprovedMaterialRequests(15, options);

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
      filterText = "Status: Pending";
    } else {
      filterText = `Status: ${statusLabels[options.status] || options.status}`;
    }
  } else if (options?.dateFrom) {
    if (options.dateFrom.toDateString() === new Date().toDateString()) {
      filterText = "Today";
    } else {
      const fromStr = options.dateFrom.toLocaleDateString();
      const toStr = options.dateTo ? options.dateTo.toLocaleDateString() : "Now";
      filterText = `From ${fromStr} to ${toStr}`;
    }
  }

  await ctx.reply(`🛒 <b>Material Requests</b> (${requests.length})\n🔍 Filter: ${filterText}\n\nSelect another filter:`, {
    parse_mode: "HTML",
    reply_markup: approvedRequestsFilterKeyboard(),
  });

  if (requests.length === 0) {
    await ctx.reply("No material requests found for this filter.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return;
  }

  for (const mr of requests) {
    await ctx.reply(formatMrListItem(mr), {
      parse_mode: "Markdown",
      reply_markup: purchaserMrKeyboard(mr.id),
    });
  }
}

export async function handleApprovedRequests(ctx: Context) {
  await showApprovedRequestsFilters(ctx);
}

export async function handleApprovedRequestsFilter(ctx: Context, data: string) {
  await ctx.answerCallbackQuery();
  const now = new Date();
  let options: { status?: string | string[]; dateFrom?: Date; dateTo?: Date } = {};

  switch (data) {
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
      options.dateTo = new Date(now.getFullYear(), now.getMonth() + 1);
      break;
    case "all":
    default:
      options = { status: ["APPROVED_FOR_PURCHASING", "PENDING_APPROVAL", "WAITING_FINAL_APPROVAL", "COMPLETED", "REJECTED"] };
      break;
  }

  await showFilteredApprovedRequests(ctx, options);
}

// ──────────────────────────────────────────────────────────────────────────────
// Draft PR list
// ──────────────────────────────────────────────────────────────────────────────

export async function handleDraftPurchaseRequests(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.reply("❌ You don't have purchaser access.");
    return;
  }

  const drafts = await getDraftPurchaseRequests(user.id);

  if (drafts.length === 0) {
    await ctx.reply("📋 You have no saved draft purchase requests.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return;
  }

  await ctx.reply(`📋 <b>Draft Purchase Requests</b> (${drafts.length})`, {
    parse_mode: "HTML",
  });

  for (const pr of drafts) {
    const kb = new InlineKeyboard()
      .text("▶️ Resume", `resume_pr_draft:${pr.id}`)
      .text("🗑 Delete", `delete_pr_draft:${pr.id}`);

    await ctx.reply(
      `📝 <b>${pr.prNumber}</b>\n` +
      `MR: ${pr.materialRequest.mrNumber}\n` +
      `Project: ${pr.materialRequest.projectName}\n` +
      `Supplier: ${pr.supplierName}\n` +
      `Items: ${pr.items.length}\n` +
      `Grand Total: ETB ${formatMoney(Number(pr.grandTotal))}\n` +
      `Saved: ${pr.updatedAt.toLocaleDateString("en-GB")}`,
      { parse_mode: "HTML", reply_markup: kb }
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Start purchase from MR — show pending vs purchased items
// ──────────────────────────────────────────────────────────────────────────────

export async function startPurchaseFromMr(ctx: Context, mrId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requirePurchaser(BigInt(from.id));
  const mr = await getMaterialRequestById(mrId);

  if (!mr || (mr.status !== "APPROVED_FOR_PURCHASING" && mr.status !== "WAITING_FINAL_APPROVAL")) {
    await ctx.answerCallbackQuery({ text: "Not available" });
    await ctx.reply("❌ This material request is not available for purchasing.");
    return;
  }

  const items: PurchaseDraftItem[] = mr.items
    .map((item) => {
      const purchasedQty = item.purchaseItems
        .filter((pi) => pi.purchase?.status !== "REJECTED")
        .reduce((sum, pi) => sum + Number(pi.quantity), 0);

      const remainingQty = Number(item.quantity) - purchasedQty;
      const isPurchased = remainingQty <= 0;

      return {
        itemName: item.itemName + (isPurchased ? " ✅" : ""),
        quantity: Math.max(0, remainingQty),
        unit: item.unit,
        boqSection: item.boqSection ?? undefined,
        materialItemId: item.id,
        lineId: item.lineId ?? undefined,
        unitPrice: 0,
        priceType: "Excluding VAT",
        discountPct: 0,
        discountAmount: 0,
        vatPct: 15,
        vatAmount: 0,
        amount: 0,
      };
    })
    .filter((item) => item.quantity > 0); // only show pending items

  if (items.length === 0) {
    await ctx.answerCallbackQuery({ text: "All items purchased" });
    await ctx.reply("❌ All items in this Material Request have already been purchased.");
    return;
  }

  await upsertDraft(
    BigInt(from.id),
    "purchase_items_menu",
    {
      flowType: "purchase",
      materialRequestId: mr.id,
      mrNumber: mr.mrNumber,
      projectName: mr.projectName,
      projectType: mr.projectType ?? undefined,
      boq: mr.boq ?? undefined,
      requestDate: mr.requestDate.toISOString(),
      requestedBy: getRequesterDisplayName(mr),
      items,
      vatStatus: "VAT 15%",
    },
    user.id,
    "purchase"
  );

  await ctx.answerCallbackQuery();
  await showPurchaseItemsMenu(ctx, {
    flowType: "purchase",
    materialRequestId: mr.id,
    mrNumber: mr.mrNumber,
    projectName: mr.projectName,
    projectType: mr.projectType ?? undefined,
    items,
    vatStatus: "VAT 15%",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main message dispatcher
// ──────────────────────────────────────────────────────────────────────────────

export async function handlePurchaseDraftMessage(
  ctx: Context,
  text: string
): Promise<boolean> {
  const from = ctx.from;
  if (!from) return false;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.step === "idle" || draft.flowType !== "purchase") return false;

  const step = draft.step;
  const data = getDraftData(draft);

  if (text === MENU_LABELS.CANCEL) {
    await clearDraft(BigInt(from.id));
    const user = await requireUser(BigInt(from.id));
    await ctx.reply("❌ Purchase request cancelled.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return true;
  }

  switch (step) {
    case "supplier_search":
      return handleSupplierSearch(ctx, text, data);
    case "supplier_reg_bulk":
      return handleInlineSupplierRegBulk(ctx, text, data);
    case "supplier_reg_name":
      return handleInlineRegName(ctx, text, data);
    case "supplier_reg_company":
      return handleInlineRegField(ctx, text, "supplierCompanyName", "supplier_reg_phone", "Enter <b>Phone Number</b> (required):", skipKeyboard(), false);
    case "supplier_reg_phone":
      return handleInlineRegField(ctx, text, "supplierPhone", "supplier_reg_bank_name", "Enter <b>Bank Name</b> (required):", cancelKeyboard(), true);
    case "supplier_reg_bank_name":
      return handleInlineRegField(ctx, text, "supplierBankName", "supplier_reg_account", "Enter <b>Bank Account Number</b> (required):", cancelKeyboard(), true);
    case "supplier_reg_account":
      return handleInlineRegFinish(ctx, text, data);
    case "bulk_material_entry":
      return handleBulkMaterialEntry(ctx, text, data);
    case "edit_qty":
      return handleEditQtyInput(ctx, text, data);
    case "set_price":
      return handleSetPriceInput(ctx, text, data);
    case "set_price_each":
      return handleSequentialPriceInput(ctx, text, data);
    case "set_price_batch":
      return handleBatchPriceInput(ctx, text, data);
    case "set_vat_yn":
      return handleSetVatYN(ctx, text, data);
    case "set_vat_batch":
      return handleSetVatYN(ctx, text, data);
    default:
      return handlePurchaseItemsMenuAction(ctx, text, data, step);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Items menu
// ──────────────────────────────────────────────────────────────────────────────

async function showPurchaseItemsMenu(ctx: Context, data: DraftData) {
  const items = (data.items ?? []) as PurchaseDraftItem[];
  const priced = items.filter((i) => i.amount > 0);

  let summary = "";
  if (priced.length > 0) {
    // Sum per-item amounts (already correctly calculated including/excluding VAT)
    const grandTotal = priced.reduce((s, i) => s + i.amount, 0);
    const vatAmount = priced.reduce((s, i) => s + i.vatAmount, 0);
    const subtotal = Math.round((grandTotal - vatAmount) * 100) / 100;
    summary =
      `\n💰 Subtotal: ETB ${formatMoney(subtotal)}\n` +
      `🧾 VAT: ETB ${formatMoney(vatAmount)}\n` +
      `✅ Grand Total: ETB ${formatMoney(grandTotal)}\n`;
  }

  await ctx.reply(
    `📦 <b>Purchase Materials</b> — ${data.mrNumber}\n\n${formatPurchaseItemList(items, data.boq)}${summary}\n` +
    `Set unit prices for all items, then continue to supplier selection.`,
    { parse_mode: "HTML", reply_markup: purchaseItemsMenuKeyboard() }
  );
}

async function handlePurchaseItemsMenuAction(
  ctx: Context,
  text: string,
  data: DraftData,
  step: string
): Promise<boolean> {
  const from = ctx.from!;
  const items = (data.items ?? []) as PurchaseDraftItem[];

  switch (text) {
    case "✏️ Edit Quantity":
      if (items.length === 0) { await ctx.reply("No items."); return true; }
      await ctx.reply("Select item to edit quantity:", {
        reply_markup: editQtyKeyboard(items.length),
      });
      return true;

    case "💰 Set Prices":
      if (items.length === 0) { await ctx.reply("No items."); return true; }
      if (items.length >= 2) {
        // Offer batch or one-by-one
        await setDraftStep(BigInt(from.id), "price_mode_select");
        await ctx.reply(
          `<b>Set Prices for ${items.length} items</b>\n\nChoose how to enter prices:`,
          { parse_mode: "HTML", reply_markup: priceEntryModeKeyboard() }
        );
      } else {
        // Single item — go directly to price entry
        await updateDraftData(BigInt(from.id), { editingItemIndex: 0 });
        await setDraftStep(BigInt(from.id), "set_price");
        await ctx.reply(
          `Enter <b>Unit Price</b> (ETB) for <b>${items[0].itemName}</b>:`,
          { parse_mode: "HTML", reply_markup: cancelKeyboard() }
        );
      }
      return true;

    case "📝 Bulk Enter Materials":
      await setDraftStep(BigInt(from.id), "bulk_material_entry");
      await ctx.reply(
        `<b>Bulk Material Entry</b>\n\nEnter materials separated by semicolons (;). Each material should have:\n- Item Name\n- Quantity (number)\n- Unit (e.g., pcs, kg)\n- Unit Price (ETB)\n\nAfter price entry, VAT will be selected <b>once</b> for the whole purchase request.\n\nExample format:\n<code>Cement, 50, bag, 200; Sand, 100, kg, 15</code>`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;

    case "📝 Enter All Prices at Once": {
      const freshDraft = await getDraft(BigInt(from.id));
      const freshItems = (getDraftData(freshDraft).items ?? []) as PurchaseDraftItem[];
      const itemList = freshItems.map((it, i) => `${i + 1}. ${it.itemName} (${it.quantity} ${it.unit})`).join("\n");
      await setDraftStep(BigInt(from.id), "set_price_batch");
      await ctx.reply(
        `<b>Enter prices separated by commas</b>\n\n${itemList}\n\n` +
        `Example: <code>500, 1200, 800</code>`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;
    }

    case "🔢 Set One by One":
      await updateDraftData(BigInt(from.id), { editingItemIndex: 0 });
      await setDraftStep(BigInt(from.id), "set_price_each");
      await ctx.reply(
        `Enter <b>Unit Price</b> (ETB) for <b>${items[0].itemName}</b>:`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;

    case "📋 Review Materials":
      await showPurchaseItemsMenu(ctx, data);
      return true;

    case "✅ Continue to Supplier": {
      const activeItems = items.filter((i) => i.unitPrice > 0 && i.quantity > 0);
      if (activeItems.length === 0) {
        await ctx.reply("Please set unit prices for at least one material first.");
        return true;
      }
      await setDraftStep(BigInt(from.id), "supplier_search");
      await ctx.reply(
        "🔍 <b>Search Supplier</b>\n\nEnter supplier name to search:",
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;
    }

    case "✅ Submit Purchase Request":
      return handlePurchaseSubmit(ctx, data, false);

    case "💾 Save as Draft":
      return handlePurchaseSubmit(ctx, data, true);

    case "✏️ Edit Supplier":
      await setDraftStep(BigInt(from.id), "supplier_search");
      await ctx.reply("🔍 Enter supplier name to search:", {
        reply_markup: cancelKeyboard(),
      });
      return true;

    case "📦 Edit Materials":
      await setDraftStep(BigInt(from.id), "purchase_items_menu");
      await showPurchaseItemsMenu(ctx, data);
      return true;

    default:
      if (step === "purchase_items_menu" || step === "purchase_review" || step === "price_mode_select") {
        await ctx.reply("Please use the menu buttons.");
        return true;
      }
      return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Supplier search
// ──────────────────────────────────────────────────────────────────────────────

async function handleSupplierSearch(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const query = text.trim();
  if (query.length < 1) {
    await ctx.reply("Please enter at least 1 character.");
    return true;
  }

  const results = await searchSuppliersForPurchase(query);

  if (results.length === 0) {
    await ctx.reply(
      `Supplier not found.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("➕ Register New Supplier", "supplier_register_new")
          .row()
          .text("❌ Cancel", "purchase_cancel"),
      }
    );
    return true;
  }

  await updateDraftData(BigInt(from.id), {
    _supplierSearchResults: results,
  });

  await ctx.reply(
    `🔍 Found <b>${results.length}</b> supplier(s) for "<b>${query}</b>":\n\nSelect a supplier:`,
    {
      parse_mode: "HTML",
      reply_markup: supplierSearchResultKeyboard(results),
    }
  );
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Inline supplier registration
// ──────────────────────────────────────────────────────────────────────────────

async function handleInlineRegName(ctx: Context, text: string, data: DraftData): Promise<boolean> {
  const from = ctx.from!;
  const name = text.trim();
  if (name.length < 2) {
    await ctx.reply("❌ Supplier name must be at least 2 characters long.");
    return true;
  }

  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  if (existing) {
    await selectSupplier(ctx, existing.id, existing.name, {
      phone: existing.phone ?? undefined,
    });
    return true;
  }

  await updateDraftData(BigInt(from.id), { supplierName: name });
  await setDraftStep(BigInt(from.id), "supplier_reg_company");
  await ctx.reply("Enter <b>Company Name</b> (optional, send 'skip' to skip):", {
    parse_mode: "HTML",
    reply_markup: skipKeyboard(),
  });
  return true;
}

async function handleInlineRegField(
  ctx: Context,
  text: string,
  field: string,
  nextStep: string,
  nextPrompt: string,
  keyboard?: Keyboard,
  required: boolean = false
): Promise<boolean> {
  const from = ctx.from!;
  const value = (text === "⏭ Skip" || text.toLowerCase() === "skip") ? undefined : text.trim() || undefined;

  if (required && !value) {
    await ctx.reply("This field is required. Please enter a value:", {
      parse_mode: "HTML",
      reply_markup: keyboard ?? cancelKeyboard(),
    });
    return true;
  }

  if (value) {
    if (field === "supplierCompanyName" || field === "contactPerson" || field === "supplierBankName") {
      if (value.length < 2) {
        await ctx.reply(`❌ Input is too short. Please enter at least 2 characters.`);
        return true;
      }
    }
    if (field === "supplierPhone") {
      if (!validatePhone(value)) {
        await ctx.reply("❌ Invalid phone number format. Please enter a valid phone number (8-20 characters, digits only).");
        return true;
      }
    }
    if (field === "supplierAccountNumber") {
      if (!validateAccount(value)) {
        await ctx.reply("❌ Invalid bank account number format. Please enter a valid account (5-35 characters).");
        return true;
      }
    }
  }

  await updateDraftData(BigInt(from.id), { [field]: value });
  await setDraftStep(BigInt(from.id), nextStep);
  await ctx.reply(nextPrompt, {
    parse_mode: "HTML",
    reply_markup: keyboard ?? skipKeyboard(),
  });
  return true;
}

async function handleInlineRegFinish(
  ctx: Context,
  text: string,
  data: Record<string, any>
): Promise<boolean> {
  const from = ctx.from!;
  const accountNumber = text.trim();

  if (!validateAccount(accountNumber)) {
    await ctx.reply("❌ Invalid bank account number format. Please enter a valid account (5-35 characters):", {
      reply_markup: cancelKeyboard(),
    });
    return true;
  }

  // Re-read draft so we get the bank name saved in the previous step
  const freshDraft = await getDraft(BigInt(from.id));
  const freshData = getDraftData(freshDraft);

  if (!freshData.supplierBankName) {
    await ctx.reply("❌ Bank name is missing. Please restart supplier registration.", {
      reply_markup: cancelKeyboard(),
    });
    return true;
  }

  const supplier = await prisma.supplier.create({
    data: {
      name: freshData.supplierName!,
      companyName: freshData.supplierCompanyName,
      contactPerson: freshData.contactPerson,
      phone: freshData.supplierPhone,
      bankName: freshData.supplierBankName,
      accountName: freshData.supplierAccountName,
      accountNumber: accountNumber,
    },
  });

  const { appendSupplierRow } = await import("@/lib/google-sheets");
  await appendSupplierRow(supplier).catch((err) =>
    console.error("Google Sheets Supplier sync error:", err)
  );

  await selectSupplier(ctx, supplier.id, supplier.name, { phone: supplier.phone ?? undefined });
  return true;
}

async function handleInlineSupplierRegBulk(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const parsed: Record<string, any> = {};

  for (const line of lines) {
    const [keyPart, valuePart] = line.split(":").map(s => s.trim());
    if (!keyPart || !valuePart) continue;
    const key = keyPart.toLowerCase();

    if (key.includes("name") && !key.includes("company") && !key.includes("bank") && !key.includes("account")) {
      parsed.supplierName = valuePart;
    } else if (key.includes("company")) {
      parsed.supplierCompanyName = valuePart;
    } else if (key.includes("phone")) {
      parsed.supplierPhone = valuePart;
    } else if (key.includes("bank") && key.includes("name")) {
      parsed.supplierBankName = valuePart;
    } else if (key.includes("account")) {
      parsed.supplierAccountNumber = valuePart;
    }
  }

  if (!parsed.supplierName || parsed.supplierName.length < 2) {
    await ctx.reply("❌ Supplier Name is required (at least 2 characters).");
    return true;
  }
  if (!parsed.supplierPhone || !validatePhone(parsed.supplierPhone)) {
    await ctx.reply("❌ Valid Phone Number is required (8-20 digits).");
    return true;
  }
  if (!parsed.supplierBankName || parsed.supplierBankName.length < 2) {
    await ctx.reply("❌ Bank Name is required (at least 2 characters).");
    return true;
  }
  if (!parsed.supplierAccountNumber || !validateAccount(parsed.supplierAccountNumber)) {
    await ctx.reply("❌ Valid Bank Account Number is required (5-35 characters).");
    return true;
  }

  let supplier = await prisma.supplier.findFirst({
    where: { name: { equals: parsed.supplierName, mode: "insensitive" } },
  });

  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name: parsed.supplierName,
        companyName: parsed.supplierCompanyName ?? null,
        phone: parsed.supplierPhone,
        bankName: parsed.supplierBankName,
        accountNumber: parsed.supplierAccountNumber,
      },
    });

    const { appendSupplierRow } = await import("@/lib/google-sheets");
    await appendSupplierRow(supplier).catch((err) =>
      console.error("Google Sheets Supplier sync error:", err)
    );
  }

  await selectSupplier(ctx, supplier.id, supplier.name, { phone: supplier.phone ?? undefined });
  return true;
}

async function selectSupplier(
  ctx: Context,
  supplierId: string,
  supplierName: string,
  info: { phone?: string }
) {
  const from = ctx.from!;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  await updateDraftData(BigInt(from.id), {
    supplierId,
    supplierName,
    supplierCompanyName: supplier?.companyName ?? undefined,
    supplierPhone: supplier?.phone ?? undefined,
    supplierBankName: supplier?.bankName ?? undefined,
    accountNumber: supplier?.accountNumber ?? undefined,
    supplierAccountNumber: supplier?.accountNumber ?? undefined,
    _registeringNewSupplier: false,
  });
  await setDraftStep(BigInt(from.id), "purchase_review");
  await ctx.reply(
    `✅ Supplier selected: <b>${supplierName}</b>\n\n${formatPurchaseDraftReview(getDraftData(await getDraft(BigInt(from.id))))}`,
    { parse_mode: "HTML", reply_markup: purchaseReviewKeyboard() }
  );
}

async function handleBulkMaterialEntry(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  
  try {
    const materialStrings = text.split(";").map(s => s.trim()).filter(s => s.length > 0);
    const newItems: PurchaseDraftItem[] = [];
    
    for (const materialStr of materialStrings) {
      const parts = materialStr.split(",").map(p => p.trim());
      if (parts.length < 4) {
        throw new Error(`Material "${materialStr}" is missing fields. Need: Item Name, Quantity, Unit, Price`);
      }
      
      const itemName = parts[0];
      const quantityStr = parts[1];
      const unit = parts[2];
      const priceStr = parts[3];
      
      if (!itemName || itemName.length < 2) {
        throw new Error(`Invalid item name in "${materialStr}"`);
      }
      
      const quantity = Number(quantityStr);
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity in "${materialStr}"`);
      }
      
      if (!unit || unit.length < 1) {
        throw new Error(`Invalid unit in "${materialStr}"`);
      }
      
      const unitPrice = Number(priceStr);
      if (isNaN(unitPrice) || unitPrice <= 0) {
        throw new Error(`Invalid price in "${materialStr}"`);
      }
      
      newItems.push({
        itemName,
        quantity,
        unit,
        unitPrice,
        priceType: "Excluding VAT",
        discountPct: 0,
        discountAmount: 0,
        vatPct: 0,
        vatAmount: 0,
        amount: 0,
      });
    }
    
    await updateDraftData(BigInt(from.id), { items: newItems });
    await setDraftStep(BigInt(from.id), "set_vat_yn");
    await ctx.reply(
      `✅ Successfully added ${newItems.length} materials with prices.\n\nChoose VAT once for the whole purchase request:`,
      { parse_mode: "HTML", reply_markup: vatYesNoKeyboard() }
    );
    return true;
    
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}\n\nPlease try again with the correct format.`, { parse_mode: "HTML" });
    return true;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Callbacks (inline keyboard buttons)
// ──────────────────────────────────────────────────────────────────────────────

export async function handleSelectSupplierCallback(ctx: Context, supplierId: string) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.flowType !== "purchase") {
    await ctx.answerCallbackQuery({ text: "Session expired" });
    return;
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    await ctx.answerCallbackQuery({ text: "Supplier not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await selectSupplier(ctx, supplier.id, supplier.name, { phone: supplier.phone ?? undefined });
}

export async function handleSupplierRegisterNewCallback(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.flowType !== "purchase") {
    await ctx.answerCallbackQuery({ text: "Session expired" });
    return;
  }

  await ctx.answerCallbackQuery();
  await updateDraftData(BigInt(from.id), { _registeringNewSupplier: true });
  await setDraftStep(BigInt(from.id), "supplier_reg_bulk");
  await ctx.reply(
    "📋 <b>Enter All Supplier Info At Once</b>\n\n" +
    "Copy, edit, and send the supplier details below in a single message:\n\n" +
    "Name: ABC Suppliers\n" +
    "Company: ABC Trading PLC\n" +
    "Phone: 0912345678\n" +
    "Bank Name: Awash Bank\n" +
    "Account: 1234567890",
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
}

export async function handleSupplierSearchAgainCallback(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await ctx.answerCallbackQuery();
  await setDraftStep(BigInt(from.id), "supplier_search");
  await ctx.reply("🔍 Enter supplier name:", { reply_markup: cancelKeyboard() });
}

export async function handlePurchaseCancelCallback(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await clearDraft(BigInt(from.id));
  const user = await requireUser(BigInt(from.id));
  await ctx.answerCallbackQuery();
  await ctx.reply("❌ Purchase request cancelled.", {
    reply_markup: mainMenuKeyboard(user),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Price entry — single item
// ──────────────────────────────────────────────────────────────────────────────

async function handleSetPriceInput(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));
  const draftData = getDraftData(draft);
  const index = draftData.editingItemIndex;

  if (index === undefined) return false;

  const price = parseNumberInput(text);
  if (price === null || price <= 0) {
    await ctx.reply("Enter a valid positive unit price.");
    return true;
  }

  const items = [...((draftData.items ?? []) as PurchaseDraftItem[])];
  const item = items[index];
  items[index] = {
    ...item,
    unitPrice: price,
    discountPct: 0,
    discountAmount: 0,
  };

  await updateDraftData(BigInt(from.id), {
    items,
    _currentUnitPrice: price,
  });
  await setDraftStep(BigInt(from.id), "set_vat_yn");

  await ctx.reply(
    `💰 Price saved for <b>${item?.itemName}</b>: <b>ETB ${formatMoney(price)}</b>\n\n` +
      `Choose VAT once for <b>all materials</b> in this purchase request:`,
    { parse_mode: "HTML", reply_markup: vatYesNoKeyboard() }
  );
  return true;
}

async function handleSetVatYN(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));
  const draftData = getDraftData(draft);

  if (text !== "✅ Yes (15% VAT)" && text !== "❌ No VAT") {
    await ctx.reply("Please select from the keyboard.", { reply_markup: vatYesNoKeyboard() });
    return true;
  }

  const vatPct = text === "✅ Yes (15% VAT)" ? 15 : 0;
  const items = applyVatToAllItems(
    [...((draftData.items ?? []) as PurchaseDraftItem[])],
    vatPct
  );
  const priceType = vatPct === 15 ? "Including VAT" : "Excluding VAT";
  const pricedCount = items.filter((item) => item.unitPrice > 0).length;

  await updateDraftData(BigInt(from.id), {
    items,
    editingItemIndex: undefined,
    _currentUnitPrice: undefined,
    _batchPrices: undefined,
    _batchVatIndex: undefined,
  });
  await setDraftStep(BigInt(from.id), "purchase_items_menu");

  await ctx.reply(
    `✅ VAT mode updated for the whole purchase request.\n` +
      `Applied to <b>${pricedCount}</b> priced material(s): <b>${priceType}</b>`,
    { parse_mode: "HTML" }
  );
  await showPurchaseItemsMenu(ctx, { ...draftData, items });
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Batch price entry — all items at once (comma-separated)
// ──────────────────────────────────────────────────────────────────────────────

async function handleBatchPriceInput(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));
  const draftData = getDraftData(draft);
  const items = (draftData.items ?? []) as PurchaseDraftItem[];

  const parts = text.split(",").map((s) => s.trim());
  if (parts.length !== items.length) {
    await ctx.reply(
      `⚠️ Please enter exactly <b>${items.length}</b> prices separated by commas.\n\nExample: <code>${items.map(() => "0").join(", ")}</code>`,
      { parse_mode: "HTML", reply_markup: cancelKeyboard() }
    );
    return true;
  }

  const prices: number[] = [];
  for (const part of parts) {
    const p = parseNumberInput(part);
    if (p === null || p <= 0) {
      await ctx.reply(`❌ Invalid price: <b>${part}</b>. Enter a valid positive number.`, {
        parse_mode: "HTML",
        reply_markup: cancelKeyboard(),
      });
      return true;
    }
    prices.push(p);
  }

  const pricedItems = items.map((item, index) => ({
    ...item,
    unitPrice: prices[index],
    discountPct: 0,
    discountAmount: 0,
  }));

  await updateDraftData(BigInt(from.id), {
    items: pricedItems,
    _batchPrices: prices,
    editingItemIndex: undefined,
  });
  await setDraftStep(BigInt(from.id), "set_vat_yn");

  await ctx.reply(
    `💰 Prices received for <b>${items.length}</b> materials.\n\n` +
      `Choose VAT once for the whole purchase request:`,
    { parse_mode: "HTML", reply_markup: vatYesNoKeyboard() }
  );
  return true;
}

async function handleSequentialPriceInput(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));
  const draftData = getDraftData(draft);
  const index = draftData.editingItemIndex ?? 0;
  const items = [...((draftData.items ?? []) as PurchaseDraftItem[])];
  const price = parseNumberInput(text);

  if (price === null || price <= 0) {
    await ctx.reply("Enter a valid positive unit price.");
    return true;
  }

  items[index] = {
    ...items[index],
    unitPrice: price,
    discountPct: 0,
    discountAmount: 0,
  };

  const nextIndex = index + 1;
  if (nextIndex < items.length) {
    await updateDraftData(BigInt(from.id), {
      items,
      editingItemIndex: nextIndex,
    });
    await ctx.reply(
      `✅ Price saved for <b>${items[index].itemName}</b>: ETB ${formatMoney(price)}\n\n` +
        `Enter <b>Unit Price</b> (ETB) for <b>${items[nextIndex].itemName}</b>:`,
      { parse_mode: "HTML", reply_markup: cancelKeyboard() }
    );
    return true;
  }

  await updateDraftData(BigInt(from.id), {
    items,
    editingItemIndex: undefined,
  });
  await setDraftStep(BigInt(from.id), "set_vat_yn");
  await ctx.reply(
    `✅ All prices received.\n\nChoose VAT once for <b>all materials</b> in this purchase request:`,
    { parse_mode: "HTML", reply_markup: vatYesNoKeyboard() }
  );
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Edit quantity — NO unit prompt (unit stays from original item)
// ──────────────────────────────────────────────────────────────────────────────

async function handleEditQtyInput(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));
  const draftData = getDraftData(draft);
  const index = draftData.editingItemIndex;

  if (index === undefined) return false;

  const qty = parseNumberInput(text);
  if (qty === null || qty <= 0) {
    await ctx.reply("Enter a valid positive quantity.");
    return true;
  }

  const items = [...((draftData.items ?? []) as PurchaseDraftItem[])];
  const item = items[index];

  // Recalculate with existing price/vat settings, unit stays unchanged
  if (item.unitPrice > 0) {
    const totals = calculateItemTotals(qty, item.unitPrice, item.priceType, 0, item.vatPct);
    items[index] = {
      ...item,
      quantity: qty,
      discountAmount: 0,
      vatAmount: totals.vatAmount,
      amount: totals.amount,
    };
  } else {
    items[index] = { ...item, quantity: qty };
  }

  await updateDraftData(BigInt(from.id), { items, editingItemIndex: undefined });
  await setDraftStep(BigInt(from.id), "purchase_items_menu");
  await ctx.reply(`✅ Quantity updated for <b>${item.itemName}</b>: ${qty} ${item.unit}`, {
    parse_mode: "HTML",
  });
  await showPurchaseItemsMenu(ctx, { ...draftData, items });
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Purchase review
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// Submit / Save Draft
// ──────────────────────────────────────────────────────────────────────────────

async function handlePurchaseSubmit(
  ctx: Context,
  data: DraftData,
  saveAsDraft: boolean
): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));

  if (!draft || draft.flowType !== "purchase" || draft.step !== "purchase_review") {
    return true;
  }

  await setDraftStep(BigInt(from.id), "submitting");
  const user = await requirePurchaser(BigInt(from.id));

  try {
    if (saveAsDraft) {
      const pr = await savePurchaseRequestDraft(user.id, BigInt(from.id), getDraftData(draft));
      await ctx.reply(
        `💾 <b>Draft Saved!</b>\n\nPR Number: <b>${pr.prNumber}</b>\n\nYou can resume it later from "📋 Draft PRs".`,
        { parse_mode: "HTML", reply_markup: mainMenuKeyboard(user) }
      );
    } else {
      const pr = await submitPurchaseRequest(user.id, BigInt(from.id), getDraftData(draft));
      await ctx.reply(
        `✅ <b>Purchase Request Submitted!</b>\n\nPR Number: <b>${pr.prNumber}</b>\nStatus: Waiting for Final Approval\n\nAdministrator has been notified.`,
        { parse_mode: "HTML", reply_markup: mainMenuKeyboard(user) }
      );
    }
  } catch (err) {
    await setDraftStep(BigInt(from.id), "purchase_review");
    const msg =
      err instanceof Error
        ? err.message === "NO_ITEMS" ? "Please add items with prices."
          : err.message === "INVALID_MR_STATUS" ? "This MR is no longer available."
          : err.message === "NO_SUPPLIER" ? "Please select a supplier first."
          : "Failed to submit. Please try again."
        : "Failed to submit.";
    await ctx.reply(`❌ ${msg}`);
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Resume PR draft
// ──────────────────────────────────────────────────────────────────────────────

export async function handleResumePrDraft(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
    include: {
      items: true,
      materialRequest: { include: { items: true, requestedBy: true } },
    },
  });

  if (!pr || pr.status !== "DRAFT") {
    await ctx.answerCallbackQuery({ text: "Draft not found" });
    return;
  }

  const draftItems: PurchaseDraftItem[] = pr.items.map((item) => ({
    itemName: item.itemName,
    quantity: Number(item.quantity),
    unit: item.unit,
    unitPrice: Number(item.unitPrice),
    priceType: (item as any).priceType ?? "Excluding VAT",
    discountPct: 0,
    discountAmount: 0,
    vatPct: Number((item as any).vatPct ?? 15),
    vatAmount: Number((item as any).vatAmount ?? 0),
    amount: Number(item.amount),
    materialItemId: item.materialRequestItemId ?? undefined,
    lineId: item.lineId ?? undefined,
  }));

  await upsertDraft(
    BigInt(from.id),
    "purchase_review",
    {
      flowType: "purchase",
      materialRequestId: pr.materialRequestId,
      mrNumber: pr.materialRequest.mrNumber,
      projectName: pr.materialRequest.projectName,
      supplierName: pr.supplierName,
      supplierPhone: pr.supplierPhone ?? undefined,
      supplierId: pr.supplierId ?? undefined,
      items: draftItems,
      _prId: prId,
    } as any,
    undefined,
    "purchase"
  );

  await ctx.answerCallbackQuery();
  const draft = await getDraft(BigInt(from.id));
  await ctx.reply(`▶️ Resuming draft <b>${pr.prNumber}</b>\n\n` + formatPurchaseDraftReview(getDraftData(draft)), {
    parse_mode: "HTML",
    reply_markup: purchaseReviewKeyboard(),
  });
}

export async function handleDeletePrDraft(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;

  await prisma.purchaseRequest.delete({ where: { id: prId, status: "DRAFT" } });
  await ctx.answerCallbackQuery({ text: "Draft deleted" });
  await ctx.reply("🗑 Draft deleted.");
}

// ──────────────────────────────────────────────────────────────────────────────
// Inline callback wiring (qty/price select buttons)
// ──────────────────────────────────────────────────────────────────────────────

export async function handleEditQtyCallback(ctx: Context, index: number) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (draft?.flowType !== "purchase") return;

  const data = getDraftData(draft);
  const items = (data.items ?? []) as PurchaseDraftItem[];

  if (index < 0 || index >= items.length) {
    await ctx.answerCallbackQuery({ text: "Invalid" });
    return;
  }

  await updateDraftData(BigInt(from.id), { editingItemIndex: index });
  await setDraftStep(BigInt(from.id), "edit_qty");
  await ctx.answerCallbackQuery();
  // NO unit prompt — unit is preserved from original item
  await ctx.reply(
    `Enter new quantity for <b>${items[index].itemName}</b> (current: ${items[index].quantity} ${items[index].unit}):`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
}

export async function handleSetPriceCallback(ctx: Context, index: number) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (draft?.flowType !== "purchase") return;

  const data = getDraftData(draft);
  const items = (data.items ?? []) as PurchaseDraftItem[];

  if (index < 0 || index >= items.length) {
    await ctx.answerCallbackQuery({ text: "Invalid" });
    return;
  }

  await updateDraftData(BigInt(from.id), { editingItemIndex: index });
  await setDraftStep(BigInt(from.id), "set_price");
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Enter <b>Unit Price</b> (ETB) for <b>${items[index].itemName}</b>:`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
}

function applyVatToAllItems(items: PurchaseDraftItem[], vatPct: number): PurchaseDraftItem[] {
  const priceType = vatPct === 15 ? "Including VAT" : "Excluding VAT";

  return items.map((item) => {
    const totals = calculateItemTotals(item.quantity, item.unitPrice, priceType, 0, vatPct);
    return {
      ...item,
      priceType,
      discountPct: 0,
      discountAmount: 0,
      vatPct,
      vatAmount: totals.vatAmount,
      amount: totals.amount,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Purchase history — grouped by date with filter
// ──────────────────────────────────────────────────────────────────────────────

export async function handlePurchaseHistory(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR", "VIEWER")) {
    await ctx.reply("❌ No purchase history available for your role.");
    return;
  }

  await ctx.reply(
    `📜 <b>Purchase History</b>\n\nSelect a date range to view:`,
    { parse_mode: "HTML", reply_markup: purchaseHistoryFilterKeyboard() }
  );
}

export async function handlePurchaseHistoryFilter(ctx: Context, period: string) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  await ctx.answerCallbackQuery();

  const now = new Date();
  let dateFrom: Date | undefined;
  let periodLabel = "All Time";

  if (period === "today") {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodLabel = "Today";
  } else if (period === "week") {
    dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    periodLabel = "This Week";
  } else if (period === "month") {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    periodLabel = "This Month";
  }

  // Fetch purchase requests in the period, filtered by role
  const where: Record<string, unknown> = {
    status: { in: ["ORDERED", "COMPLETED", "APPROVED", "PENDING_APPROVAL"] },
  };

  if (user.role === "PURCHASER") {
    where.purchaserId = user.id;
  }

  if (dateFrom) {
    where.createdAt = { gte: dateFrom };
  }

  const prs = await prisma.purchaseRequest.findMany({
    where: where as any,
    include: {
      materialRequest: { select: { mrNumber: true, projectName: true, projectType: true } },
      items: true,
      purchaser: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  if (prs.length === 0) {
    await ctx.reply(`No purchase requests found for <b>${periodLabel}</b>.`, {
      parse_mode: "HTML",
      reply_markup: purchaseHistoryFilterKeyboard(),
    });
    return;
  }

  await ctx.reply(
    `📜 <b>Purchase History — ${periodLabel}</b>\n${prs.length} purchase request(s)`,
    { parse_mode: "HTML" }
  );

  for (const pr of prs) {
    await ctx.reply(formatPrDetails(pr), {
      parse_mode: "HTML",
      reply_markup: prActionKeyboard(pr.id, pr.status),
    });
  }

  await ctx.reply("Filter by another period:", { reply_markup: purchaseHistoryFilterKeyboard() });
}

export async function handlePendingPurchaseRequests(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.reply("❌ You don't have purchaser access.");
    return;
  }

  const pending = await getPurchaseRequestsByPurchaser(
    user.id,
    30,
    { status: "PENDING_APPROVAL" }
  );

  if (pending.length === 0) {
    await ctx.reply("⏳ You have no pending purchase requests waiting for approval.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return;
  }

  await ctx.reply(`⏳ <b>Pending Purchase Requests</b> (${pending.length})`, {
    parse_mode: "HTML",
  });

  for (const pr of pending) {
    await ctx.reply(formatPrListItem(pr), {
      parse_mode: "Markdown",
      reply_markup: prActionKeyboard(pr.id, pr.status),
    });
  }
}

export async function handlePrViewCallback(ctx: Context, prId: string) {
  const from = ctx.from;
  if (!from) return;
  
  await ctx.answerCallbackQuery();
  
  try {
    const pr = await prisma.purchaseRequest.findUnique({
      where: { id: prId },
      include: {
        materialRequest: true,
        items: true,
        purchaser: true,
        approvedBy: true,
      },
    });
    
    if (!pr) {
      await ctx.reply("❌ Purchase request not found.");
      return;
    }
    
    await ctx.reply(formatPrDetails(pr), {
      parse_mode: "HTML",
      reply_markup: prActionKeyboard(pr.id, pr.status),
    });
  } catch (err) {
    console.error("PR view error:", err);
    await ctx.reply("❌ Failed to load purchase request details.");
  }
}
