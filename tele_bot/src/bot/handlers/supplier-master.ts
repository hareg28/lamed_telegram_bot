import type { Context } from "grammy";
import { Keyboard, InlineKeyboard } from "grammy";
import { requireUser, hasRole } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { validatePhone, validateAccount } from "@/lib/calculations";
import {
  getDraft,
  upsertDraft,
  setDraftStep,
  clearDraft,
  getDraftData,
  updateDraftData,
} from "../drafts";
import { mainMenuKeyboard, cancelKeyboard, skipKeyboard, MENU_LABELS } from "../keyboards";
import { appendSupplierRow } from "@/lib/google-sheets";

export const SUPPLIER_MENU_LABELS = {
  REG: "➕ Register Supplier",
  SEARCH: "🔍 Search Suppliers",
  EDIT: "✏️ Edit Supplier",
  TOGGLE: "🔄 Toggle Status",
  BACK: "🔙 Back to Menu",
};

export function supplierMasterKeyboard(): Keyboard {
  return new Keyboard()
    .text(SUPPLIER_MENU_LABELS.REG)
    .text(SUPPLIER_MENU_LABELS.SEARCH)
    .row()
    .text(SUPPLIER_MENU_LABELS.EDIT)
    .text(SUPPLIER_MENU_LABELS.TOGGLE)
    .row()
    .text(SUPPLIER_MENU_LABELS.BACK)
    .resized();
}

export async function handleSupplierMaster(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "PURCHASER", "ADMINISTRATOR")) {
    await ctx.reply("❌ Access denied. Supplier Master is for Purchasers and Administrators.");
    return;
  }

  await ctx.reply("🏢 <b>Supplier Master Module</b>\n\nSelect an option from the menu below:", {
    parse_mode: "HTML",
    reply_markup: supplierMasterKeyboard(),
  });
}

export async function handleSupplierDraftMessage(
  ctx: Context,
  text: string
): Promise<boolean> {
  const from = ctx.from;
  if (!from) return false;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.step === "idle" || draft.flowType !== "supplier") {
    if (Object.values(SUPPLIER_MENU_LABELS).includes(text)) {
      await handleMenuClick(ctx, text);
      return true;
    }
    return false;
  }

  const step = draft.step;
  const data = getDraftData(draft);

  if (text === MENU_LABELS.CANCEL || text === SUPPLIER_MENU_LABELS.BACK) {
    await clearDraft(BigInt(from.id));
    const user = await requireUser(BigInt(from.id));
    await ctx.reply("Returned to main menu.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return true;
  }

  switch (step) {
    // ── Registration flow ──────────────────────────────────────────
    case "supplier_reg_mode":
      return handleRegMode(ctx, text);
      
    case "supplier_reg_bulk":
      return handleRegBulk(ctx, text);
      
    case "supplier_reg_name":
      return handleRegName(ctx, text);

    case "supplier_reg_company":
      return handleRegField(ctx, text, "supplierCompanyName", "supplier_reg_phone",
        "Enter <b>Phone Number</b> (required):", skipKeyboard(), false);

    case "supplier_reg_phone":
      return handleRegField(ctx, text, "supplierPhone", "supplier_reg_bank_name",
        "Enter <b>Bank Name</b> (required):", cancelKeyboard(), true);

    case "supplier_reg_bank_name":
      return handleRegField(ctx, text, "supplierBankName", "supplier_reg_account",
        "Enter <b>Bank Account Number</b> (required):", cancelKeyboard(), true);

    case "supplier_reg_account":
      return handleRegFinish(ctx, text, data);

    // ── Search flow ────────────────────────────────────────────────
    case "supplier_search_query":
      return handleSearch(ctx, text);

    // ── Edit flow ──────────────────────────────────────────────────
    case "supplier_edit_select":
      return handleEditSelect(ctx, text);

    case "supplier_edit_field":
      return handleEditField(ctx, text);

    case "supplier_edit_value":
      return handleEditValue(ctx, text, data);

    // ── Toggle flow ────────────────────────────────────────────────
    case "supplier_toggle_select":
      return handleToggle(ctx, text);

    default:
      return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Registration helpers
// ──────────────────────────────────────────────────────────────────────────────

async function handleRegName(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const name = text.trim();
  if (name.length < 2) {
    await ctx.reply("Please enter a valid supplier name (at least 2 characters).");
    return true;
  }

  // Check for duplicate
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    await ctx.reply(
      `⚠️ A supplier named <b>${existing.name}</b> already exists.\n\nCompany: ${(existing as any).companyName ?? "—"}\n\nPlease search for them instead or use a different name.`,
      { parse_mode: "HTML", reply_markup: supplierMasterKeyboard() }
    );
    await clearDraft(BigInt(from.id));
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

async function handleRegField(
  ctx: Context,
  text: string,
  field: string,
  nextStep: string,
  nextPrompt: string,
  keyboard?: Keyboard,
  required: boolean = false
): Promise<boolean> {
  const from = ctx.from!;
  let value = (text === "⏭ Skip" || text.toLowerCase() === "skip") ? undefined : text.trim() || undefined;
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

async function handleRegFinish(
  ctx: Context,
  text: string,
  data: Record<string, any>
): Promise<boolean> {
  const from = ctx.from!;
  const accountNumber = text.trim();

  // Re-read draft fresh so supplierBankName from previous step is present
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

  // Sync to Google Sheets
  await appendSupplierRow(supplier).catch((err) =>
    console.error("Google Sheets Supplier sync error:", err)
  );

  await clearDraft(BigInt(from.id));
  await ctx.reply(
    `✅ <b>Supplier Registered Successfully!</b>\n\n` +
    `📛 Name: <b>${supplier.name}</b>\n` +
    `🏢 Company: ${(supplier as any).companyName ?? "—"}\n` +
    `👤 Contact Person: ${supplier.contactPerson ?? "—"}\n` +
    `📞 Phone: ${supplier.phone ?? "—"}\n` +
    `🏦 Bank: ${(supplier as any).bankName ?? "—"}\n` +
    `💳 Account: ${supplier.accountNumber ?? "—"}`,
    { parse_mode: "HTML", reply_markup: supplierMasterKeyboard() }
  );
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────────────────────────────

async function handleSearch(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const query = text.trim();
  const suppliers = await prisma.$queryRaw<any[]>`
    SELECT id, name, "companyName", "contactPerson", phone,
           "bankName", "accountNumber", "isActive"
    FROM "Supplier"
    WHERE (name ILIKE ${'%' + query + '%'}
       OR "companyName" ILIKE ${'%' + query + '%'}
       OR phone ILIKE ${'%' + query + '%'})
    LIMIT 10
  `;

  if (suppliers.length === 0) {
    await ctx.reply(
      `❌ No suppliers found matching "<b>${query}</b>".\n\nTry a different keyword or register a new supplier.`,
      { parse_mode: "HTML", reply_markup: supplierMasterKeyboard() }
    );
    await clearDraft(BigInt(from.id));
    return true;
  }

  let response = `🔍 <b>Search Results for "${query}":</b>\n\n`;
  suppliers.forEach((s, idx) => {
    response += `<b>${idx + 1}. ${s.name}</b>`;
    if ((s as any).companyName) response += ` — ${(s as any).companyName}`;
    response += `\n`;
    response += `• 📞 ${s.phone ?? "—"}\n`;
    response += `• 🏦 ${(s as any).bankName ?? "—"}  |  A/C: ${s.accountNumber ?? "—"}\n`;
    response += `• Status: ${s.isActive ? "✅ Active" : "❌ Inactive"}\n\n`;
  });

  await clearDraft(BigInt(from.id));
  await ctx.reply(response, {
    parse_mode: "HTML",
    reply_markup: supplierMasterKeyboard(),
  });
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────────────

async function handleEditSelect(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const name = text.trim();
  const supplier = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  if (!supplier) {
    await ctx.reply("❌ Supplier not found. Please type the EXACT supplier name:");
    return true;
  }

  await updateDraftData(BigInt(from.id), { supplierId: supplier.id });
  await setDraftStep(BigInt(from.id), "supplier_edit_field");
  await ctx.reply(
    `Editing <b>${supplier.name}</b>.\nChoose field to edit:`,
    {
      parse_mode: "HTML",
      reply_markup: new Keyboard()
        .text("Phone").text("Company Name").row()
        .text("Bank Name").text("Bank Account").row()
        .text(MENU_LABELS.CANCEL)
        .resized(),
    }
  );
  return true;
}

async function handleEditField(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const validFields = ["Phone", "Company Name", "Bank Name", "Bank Account"];
  if (!validFields.includes(text)) {
    await ctx.reply("Please select a field from the keyboard.");
    return true;
  }
  await updateDraftData(BigInt(from.id), { _currentItemName: text });
  await setDraftStep(BigInt(from.id), "supplier_edit_value");
  await ctx.reply(`Enter the new value for <b>${text}</b> (or type 'none' to clear):`, {
    parse_mode: "HTML",
    reply_markup: cancelKeyboard(),
  });
  return true;
}

async function handleEditValue(
  ctx: Context,
  text: string,
  data: Record<string, any>
): Promise<boolean> {
  const from = ctx.from!;
  const val = text.trim();
  const field = data._currentItemName!;
  const sId = data.supplierId!;

  const actualVal = val.toLowerCase() === "none" ? null : val;
  const updateData: Record<string, string | null> = {};
  if (field === "Phone") updateData.phone = actualVal;
  else if (field === "Company Name") updateData.companyName = actualVal;
  else if (field === "Bank Name") updateData.bankName = actualVal;
  else if (field === "Bank Account") updateData.accountNumber = actualVal;

  const updated = await prisma.supplier.update({
    where: { id: sId },
    data: updateData as any,
  });

  // Sync update to Google Sheets
  await appendSupplierRow(updated).catch((err) =>
    console.error("Google Sheets Supplier sync error:", err)
  );

  await clearDraft(BigInt(from.id));
  await ctx.reply(`✅ <b>${updated.name}</b> updated successfully!`, {
    parse_mode: "HTML",
    reply_markup: supplierMasterKeyboard(),
  });
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Toggle Status
// ──────────────────────────────────────────────────────────────────────────────

async function handleToggle(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const name = text.trim();
  const supplier = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  if (!supplier) {
    await ctx.reply("❌ Supplier not found. Please type the EXACT supplier name:");
    return true;
  }

  const updated = await prisma.supplier.update({
    where: { id: supplier.id },
    data: { isActive: !supplier.isActive },
  });

  await appendSupplierRow(updated).catch((err) =>
    console.error("Google Sheets Supplier sync error:", err)
  );

  await clearDraft(BigInt(from.id));
  await ctx.reply(
    `🔄 <b>Status Updated!</b>\n\nSupplier <b>${updated.name}</b> is now <b>${updated.isActive ? "ACTIVE ✅" : "INACTIVE ❌"}</b>`,
    { parse_mode: "HTML", reply_markup: supplierMasterKeyboard() }
  );
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Menu dispatcher
// ──────────────────────────────────────────────────────────────────────────────

async function handleMenuClick(ctx: Context, action: string) {
  const from = ctx.from!;
  const user = await requireUser(BigInt(from.id));

  if (action === SUPPLIER_MENU_LABELS.REG) {
    await upsertDraft(BigInt(from.id), "supplier_reg_bulk", { flowType: "supplier" }, user.id, "supplier");
    await ctx.reply(
      "📋 <b>Register New Supplier (Single Step)</b>\n\n" +
      "Copy, edit, and send the template below in a single message:\n\n" +
      "Name: ABC Suppliers\n" +
      "Company: ABC Trading PLC\n" +
      "Phone: 0912345678\n" +
      "Bank Name: Awash Bank\n" +
      "Account: 1234567890",
      { parse_mode: "HTML", reply_markup: cancelKeyboard() }
    );
  } else if (action === SUPPLIER_MENU_LABELS.SEARCH) {
    await upsertDraft(BigInt(from.id), "supplier_search_query", { flowType: "supplier" }, user.id, "supplier");
    await ctx.reply("🔍 <b>Search Suppliers</b>\n\nEnter search term (name, company, phone or TIN):", {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    });
  } else if (action === SUPPLIER_MENU_LABELS.EDIT) {
    await upsertDraft(BigInt(from.id), "supplier_edit_select", { flowType: "supplier" }, user.id, "supplier");
    await ctx.reply("✏️ <b>Edit Supplier</b>\n\nEnter the EXACT <b>Supplier Name</b> to edit:", {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    });
  } else if (action === SUPPLIER_MENU_LABELS.TOGGLE) {
    await upsertDraft(BigInt(from.id), "supplier_toggle_select", { flowType: "supplier" }, user.id, "supplier");
    await ctx.reply("🔄 <b>Toggle Supplier Status</b>\n\nEnter the EXACT <b>Supplier Name</b> to toggle:", {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    });
  } else if (action === SUPPLIER_MENU_LABELS.BACK) {
    await clearDraft(BigInt(from.id));
    await ctx.reply("Returned to main menu.", {
      reply_markup: mainMenuKeyboard(user),
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Bulk/Mode handlers
// ──────────────────────────────────────────────────────────────────────────────

async function handleRegMode(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  if (text === "📝 Step-by-Step") {
    await setDraftStep(BigInt(from.id), "supplier_reg_name");
    await ctx.reply("Enter <b>Supplier Name</b>:", {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    });
    return true;
  }
  if (text === "📋 Enter All At Once") {
    await setDraftStep(BigInt(from.id), "supplier_reg_bulk");
    await ctx.reply(
      "📋 <b>Enter All Supplier Details At Once</b>\n\n" +
      "Please provide the information in this format, one field per line or separated by commas:\n\n" +
      "<b>Required Fields:</b>\n" +
      "• Name: [Supplier Name]\n" +
      "• Company: [Company Name]\n" +
      "• Phone: [Phone Number]\n" +
      "• Bank Name: [Bank Name]\n" +
      "• Account: [Bank Account Number]\n\n" +
      "<b>Example:</b>\n" +
      "Name: ABC Suppliers\n" +
      "Company: ABC Trading PLC\n" +
      "Phone: 0912345678\n" +
      "Bank Name: Awash Bank\n" +
      "Account: 1234567890",
      { parse_mode: "HTML", reply_markup: cancelKeyboard() }
    );
    return true;
  }
  await ctx.reply("Please select an option from the keyboard.");
  return true;
}

async function handleRegBulk(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const data: Record<string, any> = {};

  // Parse each line
  for (const line of lines) {
    const [keyPart, valuePart] = line.split(":").map(s => s.trim());
    if (!keyPart || !valuePart) continue;
    const key = keyPart.toLowerCase();

    if (key.includes("name") && !key.includes("company") && !key.includes("bank") && !key.includes("account")) {
      data.supplierName = valuePart;
    } else if (key.includes("company")) {
      data.supplierCompanyName = valuePart;
    } else if (key.includes("phone")) {
      data.supplierPhone = valuePart;
    } else if (key.includes("bank") && key.includes("name")) {
      data.supplierBankName = valuePart;
    } else if (key.includes("account")) {
      data.supplierAccountNumber = valuePart;
    }
  }

  // Validate required fields
  if (!data.supplierName || data.supplierName.length < 2) {
    await ctx.reply("❌ Supplier Name is required (at least 2 characters).");
    return true;
  }
  if (!data.supplierCompanyName || data.supplierCompanyName.length < 2) {
    await ctx.reply("❌ Company Name is required (at least 2 characters).");
    return true;
  }
  if (!data.supplierPhone || !validatePhone(data.supplierPhone)) {
    await ctx.reply("❌ Valid Phone Number is required (8-20 digits).");
    return true;
  }
  if (!data.supplierBankName || data.supplierBankName.length < 2) {
    await ctx.reply("❌ Bank Name is required (at least 2 characters).");
    return true;
  }
  if (!data.supplierAccountNumber || !validateAccount(data.supplierAccountNumber)) {
    await ctx.reply("❌ Valid Bank Account Number is required (5-35 characters).");
    return true;
  }

  // Check for duplicate supplier
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: data.supplierName, mode: "insensitive" } },
  });
  if (existing) {
    await ctx.reply(
      `⚠️ A supplier named <b>${existing.name}</b> already exists.\n\nCompany: ${(existing as any).companyName ?? "—"}\n\nPlease search for them instead or use a different name.`,
      { parse_mode: "HTML", reply_markup: supplierMasterKeyboard() }
    );
    await clearDraft(BigInt(from.id));
    return true;
  }

  // Create supplier
  const supplier = await prisma.supplier.create({
    data: {
      name: data.supplierName,
      companyName: data.supplierCompanyName,
      phone: data.supplierPhone,
      bankName: data.supplierBankName,
      accountNumber: data.supplierAccountNumber,
    },
  });

  // Sync to Google Sheets
  await appendSupplierRow(supplier).catch((err) =>
    console.error("Google Sheets Supplier sync error:", err)
  );

  await clearDraft(BigInt(from.id));
  await ctx.reply(
    `✅ <b>Supplier Registered Successfully!</b>\n\n` +
    `📛 Name: <b>${supplier.name}</b>\n` +
    `🏢 Company: ${(supplier as any).companyName ?? "—"}\n` +
    `👤 Contact Person: ${supplier.contactPerson ?? "—"}\n` +
    `📞 Phone: ${supplier.phone ?? "—"}\n` +
    `🏦 Bank: ${(supplier as any).bankName ?? "—"}\n` +
    `💳 Account: ${supplier.accountNumber ?? "—"}`,
    { parse_mode: "HTML", reply_markup: supplierMasterKeyboard() }
  );
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Search helper used by purchase flow to find a supplier inline
// ──────────────────────────────────────────────────────────────────────────────

export async function searchSuppliersForPurchase(
  query: string
): Promise<Array<{ id: string; name: string; companyName?: string; phone?: string }>> {
  const results = await prisma.$queryRaw<Array<{ id: string; name: string; companyName: string | null; phone: string | null }>>`
    SELECT id, name, "companyName", phone 
    FROM "Supplier" 
    WHERE "isActive" = true 
    AND (name ILIKE ${'%' + query + '%'} OR "companyName" ILIKE ${'%' + query + '%'})
    LIMIT 10
  `;
  
  return results.map(r => ({
    id: r.id,
    name: r.name,
    companyName: r.companyName || undefined,
    phone: r.phone || undefined,
  }));
}
