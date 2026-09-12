import type { Context } from "grammy";
import prisma from "@/lib/prisma";
import { requireUser, hasRole } from "@/lib/auth";
import { parseNumberInput, validateUnit, type DraftData, type MaterialDraftItem } from "@/lib/calculations";
import { submitMaterialRequest } from "@/lib/material-request";
import {
  getDraft,
  upsertDraft,
  setDraftStep,
  clearDraft,
  getDraftData,
  updateDraftData,
} from "../drafts";
import { formatMrDraftReview, formatMaterialItemList, esc } from "../formatters";
import {
  cancelKeyboard,
  skipKeyboard,
  projectListKeyboard,
  projectTypeSelectionKeyboard,
  boqListKeyboard,
  itemsMenuKeyboard,
  mrReviewKeyboard,
  mainMenuKeyboard,
  removeItemKeyboard,
  editItemKeyboard,
  editItemOptionsInlineKeyboard,
  MENU_LABELS,
} from "../keyboards";

const MAX_BULK_ITEMS = 50; // Maximum allowed materials in bulk add

// ──────────────────────────────────────────────────────────────────────────────
// Start a new MR — auto-fill requester name from DB
// ──────────────────────────────────────────────────────────────────────────────

export async function startNewMaterialRequest(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  if (!hasRole(user, "REQUESTER", "ADMINISTRATOR")) {
    await ctx.reply("❌ You don't have permission to create material requests.");
    return;
  }

  // Auto-fill requester name from DB
  const requesterName = user.fullName?.trim() || from.username || `User ${from.id}`;

  await upsertDraft(
    BigInt(from.id),
    "project_name",
    { flowType: "mr", items: [], requestedBy: requesterName },
    user.id,
    "mr"
  );

  const projects = await prisma.project.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, projectType: true },
  });

  if (projects.length === 0) {
    await ctx.reply(
      `📋 *New Material Request*\n\n` +
      `👤 Requester: *${requesterName}*\n\n` +
      `⚠️ No projects registered yet.\n` +
      `Please ask your administrator to add projects first.\n\n` +
      `_You can still type a project name:_`,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
  } else {
    await ctx.reply(
      `📋 *New Material Request*\n\n` +
      `👤 Requester: *${requesterName}*\n\n` +
      `Step 1/2: Select *Project Name* from the list below, or *type to search*:`,
      { parse_mode: "Markdown", reply_markup: projectListKeyboard(projects) }
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main message dispatcher for MR draft
// ──────────────────────────────────────────────────────────────────────────────

export async function handleMrDraftMessage(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from;
  if (!from) return false;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.step === "idle" || draft.flowType !== "mr") return false;

  const step = draft.step;
  const data = getDraftData(draft);

  // If it's an admin-related step, return false so handleAdminDraftMessage can handle it
  if (step === "search_query" || step.startsWith("report_")) {
    return false;
  }

  if (text === MENU_LABELS.CANCEL) {
    await clearDraft(BigInt(from.id));
    const user = await requireUser(BigInt(from.id));
    await ctx.reply("❌ Material request cancelled.", {
      reply_markup: mainMenuKeyboard(user),
    });
    return true;
  }

  switch (step) {
    case "project_type":
      return handleProjectType(ctx, text, data);
    case "project_name":
      return handleProjectName(ctx, text, data);
    case "boq":
      return handleBoq(ctx, text, data);
    case "mr_pick_boq_section":
      return handleMrPickBoqSection(ctx, text, data);
    case "mr_add_boq":
    case "mr_add_boq_section":
      return handleMrAddBoq(ctx, text, data);
    case "item_combined_entry":
      return handleItemCombinedEntry(ctx, text, data);
    case "confirm_replace_all":
      return handleReplaceAllMaterials(ctx, text, data);
    case "edit_item_name":
      return handleEditItemName(ctx, text, data);
    case "edit_item_qty":
      return handleEditItemQty(ctx, text, data);
    case "edit_item_unit":
      return handleEditItemUnit(ctx, text, data);
    case "edit_item_all":
      return handleEditItemAll(ctx, text, data);
    case "item_name": // kept for compatibility
      return handleItemName(ctx, text, data);
    case "item_bulk_entry": // kept for compatibility
      return handleBulkItemEntry(ctx, text, data);
    case "item_quantities_bulk":
      return handleItemQuantitiesBulk(ctx, text, data);
    case "item_units_bulk":
      return handleItemUnitsBulk(ctx, text, data);
    case "item_quantity": // kept for compatibility
      return handleItemQuantity(ctx, text);
    case "item_unit": // kept for compatibility
      return handleItemUnit(ctx, text, data);
    default:
      return handleItemsMenuAction(ctx, text, data, step);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Step handlers
// ──────────────────────────────────────────────────────────────────────────────

async function handleProjectType(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const trimmed = text.trim();
  const isSkip = trimmed.toLowerCase() === "skip" || trimmed === "⏭ Skip";

  if (!isSkip && trimmed.length > 0) {
    await updateDraftData(BigInt(from.id), { projectType: trimmed });
    if (data.projectId) {
      await prisma.project
        .update({
          where: { id: data.projectId },
          data: { projectType: trimmed },
        })
        .catch(console.error);
    }
  }

  await setDraftStep(BigInt(from.id), "boq");
  await showBoqStep(ctx);
  return true;
}

async function handleProjectName(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const name = text.trim();

  // First try exact match (case-insensitive)
  const exactProject = await prisma.project.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, isActive: true }
  });

  if (exactProject) {
    await updateDraftData(BigInt(from.id), {
      projectName: exactProject.name,
      projectId: exactProject.id,
      ...(exactProject.projectType ? { projectType: exactProject.projectType } : {}),
    });
    if (exactProject.projectType) {
      await setDraftStep(BigInt(from.id), "boq");
      await showBoqStep(ctx);
    } else {
      await setDraftStep(BigInt(from.id), "project_type");
      await ctx.reply(
        `🏗 <b>Project Type</b> for <b>${esc(exactProject.name)}</b>\n\n` +
        `The project type is not set yet. Please select or type the Project Type:`,
        {
          parse_mode: "HTML",
          reply_markup: projectTypeSelectionKeyboard(),
        }
      );
    }
    return true;
  }

  // Try partial search (case-insensitive contains)
  const matches = await prisma.project.findMany({
    where: { name: { contains: name, mode: "insensitive" }, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, projectType: true },
    take: 8,
  });

  if (matches.length === 1) {
    // Only one match — auto-select it
    const project = matches[0];
    await updateDraftData(BigInt(from.id), {
      projectName: project.name,
      projectId: project.id,
      ...(project.projectType ? { projectType: project.projectType } : {}),
    });
    if (project.projectType) {
      await setDraftStep(BigInt(from.id), "boq");
      await showBoqStep(ctx);
    } else {
      await setDraftStep(BigInt(from.id), "project_type");
      await ctx.reply(
        `🏗 <b>Project Type</b> for <b>${esc(project.name)}</b>\n\n` +
        `The project type is not set yet. Please select or type the Project Type:`,
        {
          parse_mode: "HTML",
          reply_markup: projectTypeSelectionKeyboard(),
        }
      );
    }
    return true;
  }

  if (matches.length > 1) {
    // Multiple matches — show them as inline buttons for the user to pick
    await ctx.reply(
      `🔍 Found *${matches.length}* project(s) matching "${name}":\n\nPlease select one:`,
      { parse_mode: "Markdown", reply_markup: projectListKeyboard(matches) }
    );
    return true;
  }

  // No match at all
  await ctx.reply(
    `❌ No project found matching "${name}".\n\n` +
    `Please select from the list or type a different search term.`
  );
  return true;
}

async function handleBoq(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const boqVal = text.trim();
  
  let finalBoq: string | undefined = boqVal === "⏭ Skip" ? undefined : boqVal;
  
  // If user entered a BOQ value, search DB or register it automatically
  if (finalBoq) {
    let existingBoq = await prisma.boq.findFirst({
      where: { name: { equals: finalBoq, mode: "insensitive" } }
    });
    // Auto-register if not present in DB
    if (!existingBoq) {
      existingBoq = await prisma.boq.create({
        data: { name: finalBoq, isActive: true },
      });
      await ctx.reply(`✨ Registered new BOQ "*${existingBoq.name}*"!`, { parse_mode: "Markdown" });
    }
    finalBoq = existingBoq.name;
  }
  
  await updateDraftData(BigInt(from.id), { boq: finalBoq, _currentBoqSection: finalBoq });
  await setDraftStep(BigInt(from.id), "items_menu");
  const finalData = getDraftData(await getDraft(BigInt(from.id)));
  await showItemsMenu(ctx, finalData);
  return true;
}

async function handleMrPickBoqSection(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const sectionName = text.trim();

  if (sectionName.length < 2) {
    await ctx.reply("❌ Please enter a valid BOQ section name (at least 2 characters).");
    return true;
  }

  let existing = await prisma.boq.findFirst({
    where: { name: { equals: sectionName, mode: "insensitive" } },
  });

  if (!existing) {
    existing = await prisma.boq.create({
      data: { name: sectionName, isActive: true },
    });
    await ctx.reply(`✨ Registered new BOQ Section "*${existing.name}*"!`, { parse_mode: "Markdown" });
  }

  await updateDraftData(BigInt(from.id), { _currentBoqSection: existing.name });
  await setDraftStep(BigInt(from.id), "item_combined_entry");
  await ctx.reply(
    `✅ BOQ Section set to: <b>${existing.name}</b>\n\n` +
    `Now enter materials for this section:\n` +
    `Format: <code>Material Name, Quantity, Unit</code>\n\n` +
    `Example:\n` +
    `<code>Marble Tiles, 50, sqm; Tile Adhesive, 20, bag</code>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
  return true;
}

async function handleMrAddBoq(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const boqName = text.trim();

  if (boqName.length < 2) {
    await ctx.reply("❌ Please enter a valid BOQ name (at least 2 characters).");
    return true;
  }

  let existing = await prisma.boq.findFirst({
    where: { name: { equals: boqName, mode: "insensitive" } },
  });

  if (!existing) {
    existing = await prisma.boq.create({
      data: { name: boqName, isActive: true },
    });
    await ctx.reply(`✅ Registered new BOQ "${existing.name}"!`);
  } else {
    await ctx.reply(`✅ Selected BOQ "${existing.name}"!`);
  }

  // Select it automatically for the MR
  await updateDraftData(BigInt(from.id), { boq: existing.name, _currentBoqSection: existing.name });
  await setDraftStep(BigInt(from.id), "items_menu");
  const finalData = getDraftData(await getDraft(BigInt(from.id)));
  await showItemsMenu(ctx, finalData);
  return true;
}

/** Called from callback — project selected from inline list */
export async function handleSelectProjectCallback(ctx: Context, projectId: string) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.flowType !== "mr") {
    await ctx.answerCallbackQuery({ text: "Session expired" });
    return;
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    await ctx.answerCallbackQuery({ text: "Project not found" });
    return;
  }

  await ctx.answerCallbackQuery();
  await updateDraftData(BigInt(from.id), {
    projectName: project.name,
    projectId: project.id,
    ...(project.projectType ? { projectType: project.projectType } : {}),
  });

  if (project.projectType) {
    await setDraftStep(BigInt(from.id), "boq");
    await showBoqStep(ctx);
  } else {
    await setDraftStep(BigInt(from.id), "project_type");
    await ctx.reply(
      `🏗 <b>Project Type</b> for <b>${esc(project.name)}</b>\n\n` +
      `The project type is not set yet. Please select or type the Project Type:`,
      {
        parse_mode: "HTML",
        reply_markup: projectTypeSelectionKeyboard(),
      }
    );
  }
}

/** Called from callback — user tapped an inline project type button */
export async function handleSelectProjectTypeCallback(ctx: Context, projectTypeOrSkip: string) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (!draft) {
    await ctx.answerCallbackQuery({ text: "Session expired" });
    return;
  }

  await ctx.answerCallbackQuery();

  // Admin flow: project_add_type
  if (draft.step === "project_add_type") {
    const data = getDraftData(draft);
    const projectId = (data as any)?._adminProjectId;
    const isSkip = projectTypeOrSkip === "skip";
    if (projectId && !isSkip && projectTypeOrSkip.trim()) {
      const updated = await prisma.project.update({
        where: { id: projectId },
        data: { projectType: projectTypeOrSkip.trim() },
      });
      const { upsertProjectRow } = await import("@/lib/google-sheets");
      await upsertProjectRow(updated).catch((err) =>
        console.error("Google Sheets Project sync error:", err)
      );
    }
    await clearDraft(BigInt(from.id));
    const projects = await prisma.project.findMany({
      select: { id: true, name: true, projectType: true, isActive: true },
      orderBy: { name: "asc" },
    });
    const { manageProjectsKeyboard } = await import("../keyboards");
    await ctx.reply(`✅ Project registered successfully!`, {
      parse_mode: "HTML",
      reply_markup: manageProjectsKeyboard(projects),
    });
    return;
  }

  // MR flow
  if (draft.flowType !== "mr") return;
  const data = getDraftData(draft);

  if (projectTypeOrSkip === "skip") {
    await setDraftStep(BigInt(from.id), "boq");
    await showBoqStep(ctx);
    return;
  }

  const type = projectTypeOrSkip.trim();
  await updateDraftData(BigInt(from.id), { projectType: type });
  if (data.projectId) {
    await prisma.project
      .update({
        where: { id: data.projectId },
        data: { projectType: type },
      })
      .catch(console.error);
  }

  await setDraftStep(BigInt(from.id), "boq");
  await showBoqStep(ctx);
}

async function showBoqStep(
  ctx: Context
) {
  const from = ctx.from;
  if (!from) return;
  
  const user = await requireUser(BigInt(from.id));
  const boqs = await prisma.boq.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  const draftData = getDraftData(await getDraft(BigInt(from.id)));

  if (boqs.length === 0) {
    await ctx.reply(
      `✅ Project: *${draftData.projectName}*\n\n` +
      `Step 3/3: Enter *BOQ Reference* (type to register a new BOQ, or tap Skip):`,
      {
        parse_mode: "Markdown",
        reply_markup: skipKeyboard(),
      }
    );
  } else {
    await ctx.reply(
      `✅ Project: *${draftData.projectName}*\n\n` +
      `Step 3/3: Select *BOQ Reference* from the registered list below, or *type a new BOQ name to register*:`,
      {
        parse_mode: "Markdown",
        reply_markup: boqListKeyboard(boqs, true),
      }
    );
  }
}

/** Called from callback — BOQ item selected */
export async function handleSelectBoqCallback(ctx: Context, boqIdOrSkipOrAdd: string) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (!draft || draft.flowType !== "mr") {
    await ctx.answerCallbackQuery({ text: "Session expired" });
    return;
  }

  // Detect if this is a secondary BOQ section pick (triggered from "Add Another BOQ Section")
  const isPickingSection = draft.step === "mr_pick_boq_section";

  if (boqIdOrSkipOrAdd === "skip") {
    await ctx.answerCallbackQuery();
    if (isPickingSection) {
      // Skip means go back to items menu without changing section
      await setDraftStep(BigInt(from.id), "items_menu");
      const finalData = getDraftData(await getDraft(BigInt(from.id)));
      await showItemsMenu(ctx, finalData);
    } else {
      await updateDraftData(BigInt(from.id), { boq: undefined });
      await setDraftStep(BigInt(from.id), "items_menu");
      const finalData = getDraftData(await getDraft(BigInt(from.id)));
      await showItemsMenu(ctx, finalData);
    }
  } else if (boqIdOrSkipOrAdd === "add_new") {
    // Admin is adding a new BOQ
    await ctx.answerCallbackQuery();
    await setDraftStep(BigInt(from.id), "mr_add_boq");
    await ctx.reply("➕ Enter the BOQ name to add:");
  } else {
    // Selected a BOQ by id
    const boq = await prisma.boq.findUnique({ where: { id: boqIdOrSkipOrAdd } });
    if (!boq) {
      await ctx.answerCallbackQuery({ text: "BOQ not found" });
      return;
    }
    await ctx.answerCallbackQuery();

    if (isPickingSection) {
      // This is a secondary section — set _currentBoqSection and go to item entry
      await updateDraftData(BigInt(from.id), { _currentBoqSection: boq.name });
      await setDraftStep(BigInt(from.id), "item_combined_entry");
      await ctx.reply(
        `✅ BOQ Section set to: <b>${boq.name}</b>\n\n` +
        `Now enter materials for this section:\n` +
        `Format: <code>Material Name, Quantity, Unit</code>\n\n` +
        `Example:\n` +
        `<code>Marble Tiles, 50, sqm; Tile Adhesive, 20, bag</code>`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
    } else {
      // Primary BOQ for this MR
      await updateDraftData(BigInt(from.id), { boq: boq.name, _currentBoqSection: boq.name });
      await setDraftStep(BigInt(from.id), "items_menu");
      const finalData = getDraftData(await getDraft(BigInt(from.id)));
      await showItemsMenu(ctx, finalData);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Items menu
// ──────────────────────────────────────────────────────────────────────────────

export async function showItemsMenu(ctx: Context, data: DraftData) {
  const items = (data.items ?? []) as MaterialDraftItem[];
  await ctx.reply(
    `📦 <b>BOQ Items</b> (${items.length})\n\n${formatMaterialItemList(items, data.boq)}\n\n` +
      `Add at least one item, then tap <b>Continue to Review</b>.\n\n` +
      `<i>Date and MR Number will be auto-generated on submit.</i>`,
    { parse_mode: "HTML", reply_markup: itemsMenuKeyboard() }
  );
}

async function handleItemsMenuAction(
  ctx: Context,
  text: string,
  data: DraftData,
  step: string
): Promise<boolean> {
  const from = ctx.from!;

  switch (text) {
    case "➕ Add Material":
      await setDraftStep(BigInt(from.id), "item_combined_entry");
      await ctx.reply(
        `<b>Add Materials</b>\n\n` +
          `Enter materials in one message:\n` +
          `Example:\n` +
          `<code>Cement,50,bag; Sand,30,m3; Gravel,20,m3</code>`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;

    case "🏷 Add Another BOQ Section": {
      const user = await requireUser(BigInt(from.id));
      const boqs = await prisma.boq.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
      
      await updateDraftData(BigInt(from.id), { _currentBoqSection: "__pick__" });
      await setDraftStep(BigInt(from.id), "mr_pick_boq_section");

      if (boqs.length === 0) {
        await ctx.reply(
          "🏷 <b>Add BOQ Section</b>\n\nNo BOQ sections are registered yet.\nEnter a <b>BOQ Section name</b> to register and use:",
          {
            parse_mode: "HTML",
            reply_markup: cancelKeyboard(),
          }
        );
      } else {
        await ctx.reply(
          "🏷 <b>Select BOQ Section</b>\n\nChoose from the registered list below, or <b>type a new section name to register</b>:",
          {
            parse_mode: "HTML",
            reply_markup: boqListKeyboard(boqs, true),
          }
        );
      }
      return true;
    }

    case "✏️ Edit Material": {
      const items = (data.items ?? []) as MaterialDraftItem[];
      if (items.length === 0) {
        await ctx.reply("No materials to edit.");
        return true;
      }
      await ctx.reply("Select material to edit:", {
        reply_markup: editItemKeyboard(items.length),
      });
      return true;
    }

    case "🔄 Replace All Materials": {
      const items = (data.items ?? []) as MaterialDraftItem[];
      if (items.length === 0) {
        await ctx.reply("No materials to replace.");
        return true;
      }
      await setDraftStep(BigInt(from.id), "confirm_replace_all");
      await ctx.reply(
        `⚠️ <b>Warning:</b> This will replace <b>all ${items.length} current materials</b>!\n\n` +
          `Current materials:\n${formatMaterialItemList(items, data.boq)}\n\n` +
          `<b>Send the new materials in one message</b> (or send "cancel" to keep current materials):\n` +
          `<code>Material1,Qty1,Unit1; Material2,Qty2,Unit2</code>`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;
    }

    case "🗑 Remove Material": {
      const items = (data.items ?? []) as MaterialDraftItem[];
      if (items.length === 0) {
        await ctx.reply("No materials to remove.");
        return true;
      }
      await ctx.reply("Select material to remove:", {
        reply_markup: removeItemKeyboard(items.length),
      });
      return true;
    }

    case "📝 Edit All Materials": {
      const items = (data.items ?? []) as MaterialDraftItem[];
      if (items.length === 0) {
        await ctx.reply("No materials to edit.");
        return true;
      }
      await setDraftStep(BigInt(from.id), "item_edit_all");
      await ctx.reply(
        `<b>Edit All Materials</b>\n\n` +
          `Enter all materials in one message, replacing the current list:\n` +
          `- One material: <code>Material Name, Quantity, Unit</code>\n` +
          `- Multiple materials: <code>Material1,Qty1,Unit1; Material2,Qty2,Unit2</code>\n\n` +
          `Current materials:\n` +
          formatMaterialItemList(items, data.boq),
        { parse_mode: "HTML", reply_markup: cancelKeyboard() }
      );
      return true;
    }

    case "📋 Review Materials":
      await showItemsMenu(ctx, data);
      return true;

    case "✅ Continue to Review": {
      const items = (data.items ?? []) as MaterialDraftItem[];
      if (items.length === 0) {
        await ctx.reply("Please add at least one material first.");
        return true;
      }
      await setDraftStep(BigInt(from.id), "review");
      const draft = await getDraft(BigInt(from.id));
      await ctx.reply(formatMrDraftReview(getDraftData(draft)), {
        parse_mode: "HTML",
        reply_markup: mrReviewKeyboard(),
      });
      return true;
    }

    case "✅ Submit Request":
      return handleSubmit(ctx, data);

    case "✏️ Edit Project Info": {
      const draftData = getDraftData(await getDraft(BigInt(from.id)));
      await setDraftStep(BigInt(from.id), "project_name");
      const projects = await prisma.project.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, projectType: true },
      });
      await ctx.reply(
        `Current: *${draftData.projectName ?? "—"}*${draftData.projectType ? ` (${draftData.projectType})` : ""}\n\nSelect new *Project Name*:`,
        { parse_mode: "Markdown", reply_markup: projectListKeyboard(projects) }
      );
      return true;
    }

    case "📦 Edit Materials":
      await setDraftStep(BigInt(from.id), "items_menu");
      await showItemsMenu(ctx, data);
      return true;

    default:
      if (step === "items_menu" || step === "review") {
        await ctx.reply("Please use the menu buttons.");
        return true;
      }
      return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Item field handlers
// ──────────────────────────────────────────────────────────────────────────────

async function handleItemName(ctx: Context, text: string, data: DraftData): Promise<boolean> {
  const from = ctx.from!;
  const names = text
    .split(",")
    .map(n => n.trim())
    .filter(Boolean);

  // Check max bulk items
  if (names.length > MAX_BULK_ITEMS) {
    await ctx.reply(`❌ Too many materials! Maximum ${MAX_BULK_ITEMS} per bulk add.`);
    return true;
  }

  // Validate all names
  for (const name of names) {
    if (name.length < 2) {
      await ctx.reply(`❌ Material name "${name}" must be at least 2 characters long.`);
      return true;
    }
  }

  if (names.length === 1) {
    // Single material - use existing flow
    await updateDraftData(BigInt(from.id), { _currentItemName: names[0] });
    await setDraftStep(BigInt(from.id), "item_quantity");
    await ctx.reply("Enter *Quantity*:", {
      parse_mode: "Markdown",
      reply_markup: cancelKeyboard(),
    });
  } else {
    // Multiple materials - go to bulk flow
    await updateDraftData(BigInt(from.id), { _pendingItemNames: names });
    await setDraftStep(BigInt(from.id), "item_quantities_bulk");
    await ctx.reply(
      `✅ Got ${names.length} materials! Now enter quantities separated by commas (in order):\n` +
      `<i>Example: 50, 30, 20</i>`,
      { parse_mode: "HTML", reply_markup: cancelKeyboard() }
    );
  }
  return true;
}

async function handleItemCombinedEntry(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;

  // Split into individual materials by semicolon
  const materialStrings = text
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  if (materialStrings.length === 0) {
    await ctx.reply("❌ Please enter at least one material!");
    return true;
  }

  if (materialStrings.length > MAX_BULK_ITEMS) {
    await ctx.reply(`❌ Too many materials! Maximum ${MAX_BULK_ITEMS} per add.`);
    return true;
  }

  const newItems: MaterialDraftItem[] = [];

  for (let i = 0; i < materialStrings.length; i++) {
    const materialStr = materialStrings[i];
    const parts = materialStr.split(",").map(p => p.trim());

    if (parts.length < 3) {
      await ctx.reply(`❌ Material ${i+1}: Missing info! Use: <code>Name, Qty, Unit</code>`, {
        parse_mode: "HTML",
      });
      return true;
    }

    const itemName = parts[0];
    const qtyStr = parts[1];
    const unit = parts[2];

    if (itemName.length < 2) {
      await ctx.reply(`❌ Material ${i+1}: Name must be at least 2 characters!`);
      return true;
    }

    const quantity = parseNumberInput(qtyStr);
    if (quantity === null || quantity <= 0) {
      await ctx.reply(`❌ Material ${i+1}: Quantity must be a valid positive number!`);
      return true;
    }

    if (!validateUnit(unit)) {
      await ctx.reply(`❌ Material ${i+1}: Invalid unit! Use letters/numbers only (like m3, kg, bag)!`);
      return true;
    }

    newItems.push({
      itemName,
      quantity,
      unit,
      boqSection: (data as any)._currentBoqSection ?? data.boq ?? undefined,
    });
  }

  // Add new items to existing items
  const items = [...((data.items ?? []) as MaterialDraftItem[]), ...newItems];

  const cleanData: DraftData = {
    ...data,
    items,
  };

  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ Added ${newItems.length} material${newItems.length > 1 ? "s" : ""}!`, {
    parse_mode: "HTML",
  });
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleReplaceAllMaterials(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const input = text.trim().toLowerCase();

  if (input === "cancel") {
    await ctx.reply("✅ Kept current materials!");
    await setDraftStep(BigInt(from.id), "items_menu");
    await showItemsMenu(ctx, data);
    return true;
  }

  // Split into individual materials by semicolon
  const materialStrings = text
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  if (materialStrings.length === 0) {
    await ctx.reply("❌ Please enter at least one material (or send \"cancel\" to keep current)!");
    return true;
  }

  if (materialStrings.length > MAX_BULK_ITEMS) {
    await ctx.reply(`❌ Too many materials! Maximum ${MAX_BULK_ITEMS} (or send \"cancel\" to keep current)!`);
    return true;
  }

  const newItems: MaterialDraftItem[] = [];

  for (let i = 0; i < materialStrings.length; i++) {
    const materialStr = materialStrings[i];
    const parts = materialStr.split(",").map(p => p.trim());

    if (parts.length < 3) {
      await ctx.reply(`❌ Material ${i+1}: Missing info! Use: <code>Name, Qty, Unit</code> (or send \"cancel\" to keep current)!`, {
        parse_mode: "HTML",
      });
      return true;
    }

    const itemName = parts[0];
    const qtyStr = parts[1];
    const unit = parts[2];

    if (itemName.length < 2) {
      await ctx.reply(`❌ Material ${i+1}: Name must be at least 2 characters (or send \"cancel\" to keep current)!`);
      return true;
    }

    const quantity = parseNumberInput(qtyStr);
    if (quantity === null || quantity <= 0) {
      await ctx.reply(`❌ Material ${i+1}: Quantity must be a valid positive number (or send \"cancel\" to keep current)!`);
      return true;
    }

    if (!validateUnit(unit)) {
      await ctx.reply(`❌ Material ${i+1}: Invalid unit! Use letters/numbers only (like m3, kg, bag) (or send \"cancel\" to keep current)!`);
      return true;
    }

    newItems.push({
      itemName,
      quantity,
      unit,
      boqSection: (data as any)._currentBoqSection ?? data.boq ?? undefined,
    });
  }

  const cleanData: DraftData = {
    ...data,
    items: newItems,
  };

  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ Replaced all with ${newItems.length} material${newItems.length > 1 ? "s" : ""}!`, {
    parse_mode: "HTML",
  });
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleEditItemName(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const name = text.trim();
  if (name.length < 2) {
    await ctx.reply("Name must be at least 2 characters long!");
    return true;
  }
  const idx = data.editingItemIndex;
  if (idx === undefined) {
    await ctx.reply("Error: No item selected!");
    return true;
  }
  const items = [...((data.items ?? []) as MaterialDraftItem[])];
  items[idx] = {
    ...items[idx],
    itemName: name,
  };
  const cleanData: DraftData = { ...data, items };
  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ Updated name to "${name}"!`);
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleEditItemQty(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const qty = parseNumberInput(text);
  if (qty === null || qty <= 0) {
    await ctx.reply("Enter a valid positive number!");
    return true;
  }
  const idx = data.editingItemIndex;
  if (idx === undefined) {
    await ctx.reply("Error: No item selected!");
    return true;
  }
  const items = [...((data.items ?? []) as MaterialDraftItem[])];
  items[idx] = {
    ...items[idx],
    quantity: qty,
  };
  const cleanData: DraftData = { ...data, items };
  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ Updated quantity to ${qty}!`);
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleEditItemUnit(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const unit = text.trim();
  if (!validateUnit(unit)) {
    await ctx.reply("Invalid unit! Use letters/numbers only (like m3, kg, pcs)!");
    return true;
  }
  const idx = data.editingItemIndex;
  if (idx === undefined) {
    await ctx.reply("Error: No item selected!");
    return true;
  }
  const items = [...((data.items ?? []) as MaterialDraftItem[])];
  items[idx] = {
    ...items[idx],
    unit,
  };
  const cleanData: DraftData = { ...data, items };
  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ Updated unit to "${unit}"!`);
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleEditItemAll(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length < 3) {
    await ctx.reply("Please enter all three values in this format: Name, Quantity, Unit!");
    return true;
  }
  const name = parts[0];
  const qtyStr = parts[1];
  const unit = parts[2];
  if (name.length < 2) {
    await ctx.reply("Name must be at least 2 characters long!");
    return true;
  }
  const qty = parseNumberInput(qtyStr);
  if (qty === null || qty <= 0) {
    await ctx.reply("Quantity must be a valid positive number!");
    return true;
  }
  if (!validateUnit(unit)) {
    await ctx.reply("Invalid unit! Use letters/numbers only (like m3, kg, pcs)!");
    return true;
  }
  const idx = data.editingItemIndex;
  if (idx === undefined) {
    await ctx.reply("Error: No item selected!");
    return true;
  }
  const items = [...((data.items ?? []) as MaterialDraftItem[])];
  items[idx] = {
    itemName: name,
    quantity: qty,
    unit,
  };
  const cleanData: DraftData = { ...data, items };
  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ Updated material to "${name}" — ${qty} ${unit}!`);
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleBulkItemEntry(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length !== 3) {
    await ctx.reply(
      "❌ Please send exactly 3 lines: materials, quantities, and units.",
      { reply_markup: cancelKeyboard() }
    );
    return true;
  }

  const stripLabel = (value: string, pattern: RegExp) => value.replace(pattern, "").trim();
  const names = stripLabel(lines[0], /^materials?\s*:\s*/i)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  // Check max bulk items
  if (names.length > MAX_BULK_ITEMS) {
    await ctx.reply(`❌ Too many materials! Maximum ${MAX_BULK_ITEMS} per bulk add.`);
    return true;
  }
  const quantities = stripLabel(lines[1], /^quantities?\s*:\s*/i)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const units = stripLabel(lines[2], /^units?\s*:\s*/i)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (names.length === 0) {
    await ctx.reply("❌ Please enter at least one material name.");
    return true;
  }

  if (names.length !== quantities.length || names.length !== units.length) {
    await ctx.reply(
      `❌ The counts must match.\nMaterials: ${names.length}\nQuantities: ${quantities.length}\nUnits: ${units.length}`
    );
    return true;
  }

  const newItems: MaterialDraftItem[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const itemName = names[i];
    const quantity = parseNumberInput(quantities[i]);
    const unit = units[i];

    if (itemName.length < 2) {
      await ctx.reply(`❌ Material ${i + 1} name must be at least 2 characters long.`);
      return true;
    }

    if (quantity === null || quantity <= 0) {
      await ctx.reply(`❌ Quantity ${i + 1} must be a valid positive number.`);
      return true;
    }

    if (!validateUnit(unit)) {
      await ctx.reply(
        `❌ Unit ${i + 1} is invalid. Please use letters only, like pcs, kg, m, bags.`
      );
      return true;
    }

    newItems.push({
      itemName,
      quantity,
      unit,
    });
  }

  const items = [...((data.items ?? []) as MaterialDraftItem[]), ...newItems];
  const cleanData: DraftData = {
    flowType: "mr",
    projectName: data.projectName,
    projectId: data.projectId,
    projectType: data.projectType,
    boq: data.boq,
    requestedBy: data.requestedBy,
    items,
  };

  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ ${newItems.length} materials added successfully.`, {
    parse_mode: "HTML",
  });
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleItemQuantitiesBulk(ctx: Context, text: string, data: DraftData): Promise<boolean> {
  const from = ctx.from!;
  const quantityStrings = text
    .split(",")
    .map(q => q.trim())
    .filter(Boolean);

  const names = data._pendingItemNames;
  if (!names || names.length === 0) {
    await ctx.reply("❌ Session expired, please add materials again.");
    await setDraftStep(BigInt(from.id), "items_menu");
    return true;
  }

  if (quantityStrings.length !== names.length) {
    await ctx.reply(`❌ Please enter exactly ${names.length} quantities (one per material).`);
    return true;
  }

  // Validate quantities
  const quantities: number[] = [];
  for (let i = 0; i < quantityStrings.length; i++) {
    const qty = parseNumberInput(quantityStrings[i]);
    if (qty === null || qty <= 0) {
      await ctx.reply(`❌ Quantity ${i + 1} must be a valid positive number.`);
      return true;
    }
    quantities.push(qty);
  }

  await updateDraftData(BigInt(from.id), { _pendingItemQuantities: quantities });
  await setDraftStep(BigInt(from.id), "item_units_bulk");
  await ctx.reply(
    `✅ Got quantities! Now enter units separated by commas (in order):\n` +
    `<i>Example: bag, m3, m3</i>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
  return true;
}

async function handleItemUnitsBulk(ctx: Context, text: string, data: DraftData): Promise<boolean> {
  const from = ctx.from!;
  const unitStrings = text
    .split(",")
    .map(u => u.trim())
    .filter(Boolean);

  const names = data._pendingItemNames;
  const quantities = data._pendingItemQuantities;
  if (!names || !quantities || names.length === 0 || quantities.length !== names.length) {
    await ctx.reply("❌ Session expired, please add materials again.");
    await setDraftStep(BigInt(from.id), "items_menu");
    return true;
  }

  if (unitStrings.length !== names.length) {
    await ctx.reply(`❌ Please enter exactly ${names.length} units (one per material).`);
    return true;
  }

  // Validate units
  const units: string[] = [];
  for (let i = 0; i < unitStrings.length; i++) {
    const unit = unitStrings[i];
    if (!validateUnit(unit)) {
      await ctx.reply(
        `❌ Unit ${i + 1} is invalid. Please use letters only, like pcs, kg, m, bags.`
      );
      return true;
    }
    units.push(unit);
  }

  // Create new items
  const newItems: MaterialDraftItem[] = [];
  for (let i = 0; i < names.length; i++) {
    newItems.push({
      itemName: names[i],
      quantity: quantities[i],
      unit: units[i],
    });
  }

  // Add to existing items
  const items = [...((data.items ?? []) as MaterialDraftItem[]), ...newItems];
  const cleanData: DraftData = {
    ...data,
    items,
    _pendingItemNames: undefined,
    _pendingItemQuantities: undefined,
  };

  await upsertDraft(BigInt(from.id), "items_menu", cleanData, undefined, "mr");
  await ctx.reply(`✅ ${newItems.length} materials added successfully.`, {
    parse_mode: "HTML",
  });
  await showItemsMenu(ctx, cleanData);
  return true;
}

async function handleItemQuantity(ctx: Context, text: string): Promise<boolean> {
  const from = ctx.from!;
  const qty = parseNumberInput(text);
  if (qty === null || qty <= 0) {
    await ctx.reply("Enter a valid positive number for quantity.");
    return true;
  }
  await updateDraftData(BigInt(from.id), { _currentQuantity: qty });
  await setDraftStep(BigInt(from.id), "item_unit");
  await ctx.reply("Enter *Unit* (e.g. pcs, kg, m, bags):", {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
  return true;
}

async function handleItemUnit(
  ctx: Context,
  text: string,
  data: DraftData
): Promise<boolean> {
  const from = ctx.from!;
  const unit = text.trim();
  if (!validateUnit(unit)) {
    await ctx.reply("❌ Invalid unit name. Please use only alphabetical characters (e.g. pcs, kg, m, bags).");
    return true;
  }

  const draft = await getDraft(BigInt(from.id));
  const draftData = getDraftData(draft);

  const itemName = draftData._currentItemName;
  if (!itemName) {
    await ctx.reply("Error: material name missing. Please add again.");
    await setDraftStep(BigInt(from.id), "items_menu");
    return true;
  }

  const quantity = draftData._currentQuantity ?? 0;
  const newItem: MaterialDraftItem = {
    itemName,
    quantity,
    unit,
  };

  const items = [...((draftData.items ?? []) as MaterialDraftItem[])];
  if (draftData.editingItemIndex !== undefined) {
    items[draftData.editingItemIndex] = newItem;
  } else {
    items.push(newItem);
  }

  const cleanData: DraftData = {
    flowType: "mr",
    projectName: draftData.projectName,
    projectId: draftData.projectId,
    projectType: draftData.projectType,
    boq: draftData.boq,
    requestedBy: draftData.requestedBy,
    items,
  };

  await upsertDraft(BigInt(from.id), "items_menu", cleanData, draft?.userId ?? undefined, "mr");
  await ctx.reply(
    `✅ Material ${draftData.editingItemIndex !== undefined ? "updated" : "added"}: *${itemName}* — ${quantity} ${text}`,
    { parse_mode: "Markdown" }
  );
  await showItemsMenu(ctx, cleanData);
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Submit
// ──────────────────────────────────────────────────────────────────────────────

async function handleSubmit(ctx: Context, data: DraftData): Promise<boolean> {
  const from = ctx.from!;
  const draft = await getDraft(BigInt(from.id));

  if (!draft || draft.flowType !== "mr" || draft.step !== "review") {
    return true;
  }

  await setDraftStep(BigInt(from.id), "submitting");
  const user = await requireUser(BigInt(from.id));

  try {
    const mr = await submitMaterialRequest(user.id, BigInt(from.id), data);
    await ctx.reply(
      `✅ *Material Request Submitted!*\n\nMR Number: *${mr.mrNumber}*\nStatus: Pending Approval\n\nAdministrator has been notified.`,
      {
        parse_mode: "Markdown",
        reply_markup: mainMenuKeyboard(user),
      }
    );
  } catch (err) {
    await setDraftStep(BigInt(from.id), "review");
    const message =
      err instanceof Error && err.message === "NO_ITEMS"
        ? "Please add at least one material."
        : err instanceof Error && err.message === "NO_REQUESTER"
          ? "Requester information is missing."
          : "Failed to submit. Please try again.";
    await ctx.reply(`❌ ${message}`);
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Inline callbacks for item remove/edit
// ──────────────────────────────────────────────────────────────────────────────

export async function handleRemoveItemCallback(ctx: Context, index: number) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (draft?.flowType !== "mr") return;

  const data = getDraftData(draft);
  const items = [...((data.items ?? []) as MaterialDraftItem[])];

  if (index < 0 || index >= items.length) {
    await ctx.answerCallbackQuery({ text: "Invalid item" });
    return;
  }

  items.splice(index, 1);
  await updateDraftData(BigInt(from.id), { items, editingItemIndex: undefined });
  await ctx.answerCallbackQuery({ text: "Material removed" });
  await showItemsMenu(ctx, { ...data, items });
}

export async function handleEditItemCallback(ctx: Context, index: number) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (draft?.flowType !== "mr") return;

  const data = getDraftData(draft);
  const items = (data.items ?? []) as MaterialDraftItem[];

  if (index < 0 || index >= items.length) {
    await ctx.answerCallbackQuery({ text: "Invalid item" });
    return;
  }

  const item = items[index];
  await updateDraftData(BigInt(from.id), {
    editingItemIndex: index,
    _currentItemName: item.itemName,
    _currentQuantity: item.quantity,
    _currentUnit: item.unit,
  });
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Editing material #${index + 1}:\n` +
      `Current: *${item.itemName}* — ${item.quantity} ${item.unit}\n\n` +
      `What would you like to edit?`,
    { 
      parse_mode: "Markdown", 
      reply_markup: editItemOptionsInlineKeyboard(index) 
    }
  );
}

export async function handleEditItemActionCallback(ctx: Context, action: string, index: number) {
  const from = ctx.from;
  if (!from) return;

  const draft = await getDraft(BigInt(from.id));
  if (draft?.flowType !== "mr") return;

  const data = getDraftData(draft);
  const items = (data.items ?? []) as MaterialDraftItem[];

  if (index < 0 || index >= items.length) {
    await ctx.answerCallbackQuery({ text: "Invalid item" });
    return;
  }

  const item = items[index];
  await ctx.answerCallbackQuery();

  switch (action) {
    case "name":
      await setDraftStep(BigInt(from.id), "edit_item_name");
      await ctx.reply(
        `Enter new name for material #${index + 1} (current: ${item.itemName}):`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
      );
      break;
    case "qty":
      await setDraftStep(BigInt(from.id), "edit_item_qty");
      await ctx.reply(
        `Enter new quantity for material #${index + 1} (current: ${item.quantity}):`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
      );
      break;
    case "unit":
      await setDraftStep(BigInt(from.id), "edit_item_unit");
      await ctx.reply(
        `Enter new unit for material #${index + 1} (current: ${item.unit}):`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
      );
      break;
    case "all":
      await setDraftStep(BigInt(from.id), "edit_item_all");
      await ctx.reply(
        `Edit material #${index + 1}:\n` +
          `Current: *${item.itemName}* — ${item.quantity} ${item.unit}\n\n` +
          `Enter new values in this format: Name, Quantity, Unit`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
      );
      break;
  }
}
