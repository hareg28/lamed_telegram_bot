import type {
  MaterialRequest,
  MaterialRequestItem,
  PurchaseRequest,
  PurchaseRequestItem,
  User,
} from "@prisma/client";
import {
  formatDate,
  formatMoney,
  roundMoney,
  statusLabel,
  getRequesterDisplayName,
  type DraftData,
  type MaterialDraftItem,
  type PurchaseDraftItem,
} from "@/lib/calculations";
import { getCompanyName } from "@/lib/config";

// Safely converts Prisma Decimals, numbers, strings, or nulls to javascript numbers
function safeNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object" && val !== null) {
    if ("toNumber" in val && typeof (val as { toNumber: unknown }).toNumber === "function") {
      return (val as { toNumber: () => number }).toNumber();
    }
    if ("toString" in val && typeof (val as { toString: unknown }).toString === "function") {
      return parseFloat((val as { toString: () => string }).toString()) || 0;
    }
  }
  return 0;
}

type MRFull = MaterialRequest & {
  items: MaterialRequestItem[];
  requestedBy: User;
  approvalHistory?: any[];
  purchaseRequests?: (PurchaseRequest & {
    items: PurchaseRequestItem[];
    purchaser: User;
    approvedBy: User | null;
  })[];
};

export function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cleanMrNumber(mrNumber: string): string {
  return mrNumber.replace(/^MR-/i, "");
}

function cleanPrNumber(prNumber: string): string {
  return prNumber.replace(/^PR-/i, "");
}

// ──────────────────────────────────────────────────────────────────────────────
// MR Draft Review
// ──────────────────────────────────────────────────────────────────────────────

export function formatMrDraftReview(data: DraftData): string {
  const items = (data.items ?? []) as MaterialDraftItem[];
  const company = getCompanyName();

  let text = `<b>${esc(company)}</b>\n\n`;
  text += `📅 Date: <i>Auto-generated on submit</i>\n`;
  text += `👤 Requested By: <b>${esc(data.requestedBy ?? "—")}</b>\n`;
  text += `🏗 Project Type: <b>${esc(data.projectType ?? "—")}</b>\n`;
  text += `📁 Project: <b>${esc(data.projectName ?? "—")}</b>\n`;
  text += `📄 MR No. : <b><i>Auto-generated on submit</i></b>\n`;
  text += `📄 PR No. : <b>—</b>\n\n`;

  // Group items by boqSection if available
  const sectionsMap = new Map<string, MaterialDraftItem[]>();
  items.forEach((item) => {
    const sec = item.boqSection?.trim() || data.boq?.trim() || "Main Section";
    if (!sectionsMap.has(sec)) sectionsMap.set(sec, []);
    sectionsMap.get(sec)!.push(item);
  });

  sectionsMap.forEach((secItems, secName) => {
    text += `📦 <b>BOQ Section — ${esc(secName)}</b>\n`;
    secItems.forEach((item, i) => {
      text += `${i + 1}. <b>${esc(item.itemName)}</b> — ${safeNumber(item.quantity)} ${esc(item.unit ?? "pcs")}\n`;
    });
    text += `\n`;
  });

  return text.trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Purchase Draft Review
// ──────────────────────────────────────────────────────────────────────────────

export function formatPurchaseDraftReview(data: DraftData): string {
  const items = (data.items ?? []) as PurchaseDraftItem[];
  const company = getCompanyName();
  const boqName = data.boq?.trim() || "Material List";

  // Use per-item amounts already computed via calculateItemTotals
  const grandTotal = roundMoney(items.reduce((sum, item) => sum + safeNumber(item.amount), 0));
  const vatAmount = roundMoney(items.reduce((sum, item) => sum + safeNumber(item.vatAmount), 0));
  const subtotal = roundMoney(grandTotal - vatAmount);

  let text = `<b>${esc(company)}</b>\n\n`;
  text += `📅 Date: <i>Auto-generated on submit</i>\n`;
  text += `👤 Requested By: <b>${esc(data.requestedBy ?? "—")}</b>\n`;
  text += `🏗 Project Type: <b>${esc(data.projectType ?? "—")}</b>\n`;
  text += `📁 Project: <b>${esc(data.projectName ?? "—")}</b>\n`;
  text += `📄 MR No. : <b>${esc(data.mrNumber ? cleanMrNumber(data.mrNumber) : "—")}</b>\n`;
  text += `📄 PR No. : <b><i>Auto-generated on submit</i></b>\n\n`;

  text += `🎯 <b>Supplier Information</b>\n`;
  text += `👤 Name: <b>${esc(data.supplierName ?? "—")}</b>\n`;
  text += `🏢 Company Name: <b>${esc(data.supplierCompanyName ?? "—")}</b>\n`;
  text += `🏦 Bank Name: <b>${esc(data.supplierBankName ?? "—")}</b>\n`;
  text += `🏦 Account Number: <b>${esc(data.accountNumber ?? data.supplierAccountNumber ?? "—")}</b>\n\n`;

  // Group items by boqSection if available
  const sectionsMap = new Map<string, Array<{ item: PurchaseDraftItem; globalIndex: number }>>();
  items.forEach((item, index) => {
    const { section, cleanName } = extractBoqSectionAndName(item);
    const secName = item.boqSection?.trim() || section || boqName;
    if (!sectionsMap.has(secName)) sectionsMap.set(secName, []);
    sectionsMap.get(secName)!.push({ item: { ...item, itemName: cleanName }, globalIndex: index + 1 });
  });

  sectionsMap.forEach((secItems, secName) => {
    text += `📦 <b>BOQ Section — ${esc(secName)}</b>\n\n`;
    secItems.forEach(({ item, globalIndex }) => {
      const qty = safeNumber(item.quantity);
      const price = safeNumber(item.unitPrice);
      const itemTotal = safeNumber(item.amount);
      const itemVat = safeNumber(item.vatAmount);
      const baseAmt = roundMoney(itemTotal - itemVat);

      text += `${globalIndex}. <b>${esc(item.itemName)}</b> — ${qty} ${esc(item.unit ?? "pcs")}\n`;
      text += `   💰 Price: ${qty} × ${formatMoney(price)} = ETB <b>${formatMoney(baseAmt)}</b>\n`;
    });
    text += `\n`;
  });

  text += `\n💰 <b>Cost Summary</b>\n\n`;
  text += `👉 Total Before VAT: <b>ETB ${formatMoney(subtotal)}</b>\n`;
  text += `👉 VAT Amount:     <b>ETB ${formatMoney(vatAmount)}</b>\n`;
  text += `👉 Total with VAT: <b>ETB ${grandTotal > 0 ? formatMoney(grandTotal) : "—"}</b>\n\n`;

  text += `✅ <b>Approvals:</b>\n`;
  text += `• Site Engineer: <i>Pending</i>\n`;
  text += `• Project Manager: <i>Pending</i>`;

  return text;
}

// ──────────────────────────────────────────────────────────────────────────────
// Material item list for MR form
// ──────────────────────────────────────────────────────────────────────────────

export function formatMaterialItemList(items: MaterialDraftItem[], defaultBoq?: string): string {
  if (items.length === 0) return "No items added yet.";

  const sectionsMap = new Map<string, Array<{ item: MaterialDraftItem; globalIndex: number }>>();

  items.forEach((item, index) => {
    const { section, cleanName } = extractBoqSectionAndName(item);
    const secName = item.boqSection?.trim() || section || defaultBoq?.trim() || "Main Section";
    if (!sectionsMap.has(secName)) {
      sectionsMap.set(secName, []);
    }
    sectionsMap.get(secName)!.push({ item: { ...item, itemName: cleanName }, globalIndex: index + 1 });
  });

  const parts: string[] = [];
  sectionsMap.forEach((secItems, secName) => {
    let text = `🏷 <b>BOQ Section — ${esc(secName)}</b>\n`;
    text += secItems
      .map(
        ({ item, globalIndex }) =>
          `${globalIndex}. <b>${esc(item.itemName)}</b>\n   📦 ${safeNumber(item.quantity)} ${esc(item.unit ?? "pcs")}`
      )
      .join("\n\n");
    parts.push(text);
  });

  return parts.join("\n\n");
}

// ──────────────────────────────────────────────────────────────────────────────
// Purchase item list — shows pending/purchased status
// ──────────────────────────────────────────────────────────────────────────────

export function formatPurchaseItemList(items: PurchaseDraftItem[], defaultBoq?: string): string {
  if (items.length === 0) return "No items.";

  const sectionsMap = new Map<string, Array<{ item: PurchaseDraftItem; globalIndex: number }>>();

  items.forEach((item, index) => {
    const { section, cleanName } = extractBoqSectionAndName(item);
    const secName = (item as any).boqSection?.trim() || section || defaultBoq?.trim() || "Main Section";
    if (!sectionsMap.has(secName)) {
      sectionsMap.set(secName, []);
    }
    sectionsMap.get(secName)!.push({ item: { ...item, itemName: cleanName }, globalIndex: index + 1 });
  });

  const parts: string[] = [];
  sectionsMap.forEach((secItems, secName) => {
    let text = `🏷 <b>BOQ Section — ${esc(secName)}</b>\n`;
    text += secItems
      .map(({ item, globalIndex }) => {
        const qty = safeNumber(item.quantity);
        const price = safeNumber(item.unitPrice);
        const lineTotal = safeNumber(item.amount);
        const vatAmt = safeNumber(item.vatAmount);
        const baseAmt = roundMoney(lineTotal - vatAmt);
        const isPriced = price > 0;
        const statusIcon = isPriced ? "✅" : "⏳";
        return isPriced
          ? `${statusIcon} ${globalIndex}. <b>${esc(item.itemName)}</b> — ${qty} ${esc(item.unit ?? "pcs")}\n` +
            `   💰 Price: ${qty} × ${formatMoney(price)} = ETB ${formatMoney(baseAmt)}`
          : `${statusIcon} ${globalIndex}. <b>${esc(item.itemName)}</b> — ${qty} ${esc(item.unit ?? "pcs")} — <i>Price not set</i>`;
      })
      .join("\n\n");
    parts.push(text);
  });

  return parts.join("\n\n");
}


function extractBoqSectionAndName(item: { itemName: string; boqSection?: string | null }): { section?: string; cleanName: string } {
  if (item.boqSection) {
    return { section: item.boqSection, cleanName: item.itemName.replace(/^\[.*?\]\s*/, "") };
  }
  const match = item.itemName.match(/^\[(.*?)\]\s*(.+)$/);
  if (match) {
    return { section: match[1], cleanName: match[2] };
  }
  return { section: undefined, cleanName: item.itemName };
}

// ──────────────────────────────────────────────────────────────────────────────
// Full MR details
// ──────────────────────────────────────────────────────────────────────────────

export function formatMrDetails(mr: MRFull, hidePrices: boolean = false): string {
  const company = getCompanyName();
  const requester = getRequesterDisplayName(mr);

  // Find who approved the MR (Site Engineer)
  const mrApproval = mr.approvalHistory?.find((h: any) => h.action === "MR_APPROVED");
  const siteEngineer = mrApproval?.performedBy?.fullName || "—";

  let text = `<b>${esc(company)}</b>\n\n`;
  text += `📅 Date: <b>${formatDate(mr.requestDate)}</b>\n`;
  text += `👤 Requested By: <b>${esc(requester)}</b>\n`;
  text += `🏗 Project Type: <b>${esc(mr.projectType ?? "—")}</b>\n`;
  text += `📁 Project: <b>${esc(mr.projectName)}</b>\n`;
  text += `📄 MR No. : <b>${esc(cleanMrNumber(mr.mrNumber))}</b>\n`;

  const prs = mr.purchaseRequests ?? [];
  const activePr = prs[0]; // Get the primary or latest PR

  if (activePr) {
    text += `📄 PR No. : <b>${esc(cleanPrNumber(activePr.prNumber))}</b>\n\n`;

    if (!hidePrices) {
      text += `🎯 <b>Supplier Information</b>\n`;
      text += `👤 Name: <b>${esc(activePr.supplierName)}</b>\n`;
      text += `🏢 Company Name: <b>${esc((activePr as any).supplierCompanyName ?? "—")}</b>\n`;
      text += `🏦 Bank Name: <b>${esc((activePr as any).supplierBankName ?? "—")}</b>\n`;
      text += `🏦 Account Number: <b>${esc(activePr.accountNumber ?? "—")}</b>\n\n`;
    }
  } else {
    text += `📄 PR No. : <b>—</b>\n\n`;
  }

  if (activePr) {
    const sectionsMap = new Map<string, Array<{ item: typeof activePr.items[0]; globalIndex: number }>>();
    const prItems = activePr.items ?? [];
    prItems.forEach((item, i) => {
      const { section, cleanName } = extractBoqSectionAndName(item);
      const secName = (item as any).boqSection?.trim() || section || mr.boq || "Main Section";
      if (!sectionsMap.has(secName)) sectionsMap.set(secName, []);
      sectionsMap.get(secName)!.push({ item: { ...item, itemName: cleanName }, globalIndex: i + 1 });
    });

    sectionsMap.forEach((secItems, secName) => {
      text += `📦 <b>BOQ Section — ${esc(secName)}</b>\n`;
      secItems.forEach(({ item, globalIndex }) => {
        const qty = safeNumber(item.quantity);
        text += `${globalIndex}. <b>${esc(item.itemName)}</b> — ${qty} ${esc(item.unit)}\n`;
        if (!hidePrices) {
          const price = safeNumber(item.unitPrice);
          const itemTotal = safeNumber(item.amount);
          const itemVat = safeNumber((item as any).vatAmount ?? 0);
          const baseAmt = roundMoney(itemTotal - itemVat);
          text += `   💰 Price: ${qty} × ${formatMoney(price)} = ETB <b>${formatMoney(baseAmt)}</b>\n`;
        }
      });
      text += `\n`;
    });

    if (!hidePrices) {
      text += `💰 <b>Cost Summary</b>\n\n`;
      text += `👉 Total Before VAT: <b>ETB ${formatMoney(safeNumber(activePr.subtotal))}</b>\n`;
      text += `👉 VAT Amount:     <b>ETB ${formatMoney(safeNumber(activePr.vatAmount))}</b>\n`;
      text += `👉 Total with VAT: <b>ETB ${formatMoney(safeNumber(activePr.grandTotal))}</b>\n\n`;
    }
  } else {
    const sectionsMap = new Map<string, Array<{ item: typeof mr.items[0]; globalIndex: number }>>();
    const mrItems = mr.items ?? [];
    mrItems.forEach((item, i) => {
      const { section, cleanName } = extractBoqSectionAndName(item);
      const secName = (item as any).boqSection?.trim() || section || mr.boq || "Main Section";
      if (!sectionsMap.has(secName)) sectionsMap.set(secName, []);
      sectionsMap.get(secName)!.push({ item: { ...item, itemName: cleanName }, globalIndex: i + 1 });
    });

    sectionsMap.forEach((secItems, secName) => {
      text += `📦 <b>BOQ Section — ${esc(secName)}</b>\n`;
      secItems.forEach(({ item, globalIndex }) => {
        text += `${globalIndex}. <b>${esc(item.itemName)}</b> — ${safeNumber(item.quantity)} ${esc(item.unit)}\n`;
      });
      text += `\n`;
    });
  }

  text += `✅ <b>Approvals:</b>\n`;
  text += `• Site Engineer: <b>${esc(siteEngineer)}</b>\n`;
  text += `• Project Manager: <b>${esc(activePr?.approvedBy?.fullName || "—")}</b>`;

  return text;
}

// ──────────────────────────────────────────────────────────────────────────────
// MR list item (keeps Markdown compatibility or simple text)
// ──────────────────────────────────────────────────────────────────────────────

export function formatMrListItem(
  mr: MaterialRequest & { purchaseRequests?: PurchaseRequest[] }
): string {
  const statusEmoji =
    mr.status === "COMPLETED"
      ? "✅"
      : mr.status === "REJECTED"
      ? "❌"
      : mr.status === "PENDING_APPROVAL"
      ? "⏳"
      : mr.status === "WAITING_FINAL_APPROVAL"
      ? "🔔"
      : "🛒";

  const prs = mr.purchaseRequests ?? [];
  const prCount = prs.length > 0 ? ` | ${prs.length} PR(s)` : "";

  return `${statusEmoji} *${mr.mrNumber}* — ${mr.projectName}\n   ${statusLabel(mr.status)}${prCount}`;
}

export function formatPrListItem(
  pr: PurchaseRequest & { materialRequest?: { mrNumber: string; projectName: string; requesterName?: string | null } }
): string {
  const statusEmoji =
    pr.status === "COMPLETED"
      ? "✅"
      : pr.status === "REJECTED"
      ? "❌"
      : pr.status === "PENDING_APPROVAL"
      ? "⏳"
      : pr.status === "APPROVED"
      ? "✅"
      : pr.status === "ORDERED"
      ? "🚚"
      : "⏳";

  const mrLabel = pr.materialRequest?.mrNumber ? ` | MR: ${pr.materialRequest.mrNumber}` : "";

  return `${statusEmoji} *${pr.prNumber}* — ${pr.materialRequest?.projectName || "—"}\n   ${statusLabel(pr.status)}${mrLabel}`;
}

export function formatPrDetails(pr: any): string {
  const company = getCompanyName();

  let text = `<b>${esc(company)}</b>\n\n`;
  text += `📋 PR Number: <b>${esc(cleanPrNumber(pr.prNumber))}</b>\n`;
  text += `📄 MR: <b>${esc(pr.materialRequest?.mrNumber || "—")}</b>\n`;
  text += `📁 Project: <b>${esc(pr.materialRequest?.projectName || "—")}</b>\n`;
  if (pr.materialRequest?.projectType) {
    text += `🏗 Project Type: <b>${esc(pr.materialRequest.projectType)}</b>\n`;
  }
  text += `🎯 Supplier: <b>${esc(pr.supplierName || "—")}</b>\n`;
  if (pr.supplierCompanyName) {
    text += `🏢 Company: <b>${esc(pr.supplierCompanyName)}</b>\n`;
  }
  if (pr.supplierBankName) {
    text += `🏦 Bank: <b>${esc(pr.supplierBankName)}</b>\n`;
  }
  if (pr.accountNumber) {
    text += `💳 Account: <b>${esc(pr.accountNumber)}</b>\n`;
  }
  text += `📊 Status: <b>${esc(statusLabel(pr.status))}</b>\n`;
  if (pr.actualDeliveryDate) {
    text += `✅ Delivered On: <b>${formatDate(pr.actualDeliveryDate)}</b>\n`;
  }
  if (pr.createdAt) {
    text += `🕒 Created On: <b>${formatDate(pr.createdAt)}</b>\n`;
  }
  text += `\n📦 Items:\n`;

  (pr.items || []).forEach((item: any, index: number) => {
    const qty = safeNumber(item.quantity);
    const price = safeNumber(item.unitPrice);
    const total = safeNumber(item.amount);
    text += `${index + 1}. <b>${esc(item.itemName)}</b> — ${qty} ${esc(item.unit)}\n`;
    text += `   💰 Price: ${qty} × ${formatMoney(price)} = ETB <b>${formatMoney(total)}</b>\n`;
  });

  text += `\n💰 <b>Cost Summary:</b>\n`;
  text += `• Subtotal: ETB ${formatMoney(safeNumber(pr.subtotal))}\n`;
  text += `• VAT (15%): ETB ${formatMoney(safeNumber(pr.vatAmount))}\n`;
  text += `• Grand Total: <b>ETB ${formatMoney(safeNumber(pr.grandTotal))}</b>\n`;

  return text;
}

// ──────────────────────────────────────────────────────────────────────────────
// Help text
// ──────────────────────────────────────────────────────────────────────────────

export function formatHelp(role: string): string {
  let text = `ℹ️ <b>Procurement Bot Help</b>\n\n`;

  if (role === "REQUESTER" || role === "ADMINISTRATOR") {
    text += `<b>Requester:</b>\n`;
    text += `• 📋 New Material Request — Create MR\n`;
    text += `• 📄 My Requests — View your material requests\n`;
    text += `• 📊 Request Status — Track by MR number\n\n`;
  }

  if (role === "PURCHASER" || role === "ADMINISTRATOR") {
    text += `<b>Purchaser:</b>\n`;
    text += `• 🛒 Approved Requests — Process approved MRs\n`;
    text += `• ⏳ Pending Requests — View submitted PRs waiting for approval\n`;
    text += `• 📜 Purchase History — View past purchases by date\n`;
    text += `• 🏢 Supplier Master — Manage suppliers\n\n`;
  }

  if (role === "ADMINISTRATOR") {
    text += `<b>Administrator:</b>\n`;
    text += `• 📑 View All Requests — Browse & filter\n`;
    text += `• 📁 Manage Projects — Add projects & BOQ references\n`;
    text += `• ✅ Approve MR / ❌ Reject MR — First approval\n`;
    text += `• ✅ Final Approve / ❌ Final Reject — Purchase approval\n`;
    text += `• 👥 Manage Users — Assign roles\n`;
    text += `• /search &lt;term&gt; — Search requests\n`;
    text += `• /report daily|weekly|monthly — Generate reports\n\n`;
  }

  if (role === "VIEWER") {
    text += `<b>Viewer (read-only):</b>\n`;
    text += `• 📑 View All Requests\n`;
    text += `• 📜 Purchase History\n`;
    text += `• /search &lt;term&gt;\n\n`;
  }

  text += `MR/PR numbers and dates are auto-generated.\nVAT is 15% calculated at once.\nMR Line IDs track items across the workflow.`;

  return text;
}
