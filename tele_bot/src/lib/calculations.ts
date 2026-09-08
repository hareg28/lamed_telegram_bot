import { Decimal } from "@prisma/client/runtime/library";

export interface MaterialDraftItem {
  itemName: string;
  quantity: number;
  unit: string;
  boqSection?: string;
  materialItemId?: string;
  lineId?: string;
}

export interface PurchaseDraftItem extends MaterialDraftItem {
  unitPrice: number;
  priceType: string;       // "Including VAT" | "Excluding VAT"
  vatPct: number;          // 15 or 0
  vatAmount: number;
  amount: number;          // grand total for this line
  // Keep these as 0 always (discount removed) for backward compat with DB
  discountPct: number;
  discountAmount: number;
}

export function getRequesterDisplayName(mr: {
  requesterName?: string | null;
  requestedBy: { fullName: string };
}): string {
  return (mr.requesterName?.trim() || mr.requestedBy.fullName).trim();
}

export interface DraftData {
  flowType?: "mr" | "purchase" | "supplier";
  materialRequestId?: string;
  mrNumber?: string;
  projectName?: string;
  projectId?: string;
  projectType?: string;
  boq?: string;
  requestedBy?: string;
  prNumber?: string;
  requestDate?: string;
  // Supplier fields
  supplierName?: string;
  supplierCompanyName?: string;
  supplierPhone?: string;
  supplierBankName?: string;
  vatReceiptNumber?: string;
  contactPerson?: string;
  supplierAccountName?: string;
  accountNumber?: string;
  supplierAccountNumber?: string; // For compatibility
  supplierId?: string;
  // Purchase fields
  vatStatus?: string;
  items?: MaterialDraftItem[] | PurchaseDraftItem[];
  editingItemIndex?: number;
  // Per-item edit state
  _currentItemName?: string;
  _currentQuantity?: number;
  _currentUnit?: string;
  _currentUnitPrice?: number;
  _itemPriceType?: string;
  _itemVatPct?: number;
  // Bulk add multiple items
  _pendingItemNames?: string[];
  _pendingItemQuantities?: number[];
  // Batch price entry state
  _batchPrices?: number[];
  _batchVatIndex?: number;  // which item we're setting VAT for in batch
  // Supplier search inline flow
  _supplierSearchResults?: Array<{ id: string; name: string; companyName?: string; phone?: string }>;
  _registeringNewSupplier?: boolean;
  // Admin project management
  assignRole?: string;
  _adminProjectId?: string;
  _adminBoqId?: string;
  mrId?: string;
  prId?: string;
  _boqEditIndex?: number;
  // Current BOQ section for multi-BOQ MR flow
  _currentBoqSection?: string;
  // Report fields
  reportType?: string;
}

/** Calculate all line totals for one item including VAT (no discount) */
export function calculateItemTotals(
  quantity: number,
  unitPrice: number,
  priceType: string,       // "Including VAT" | "Excluding VAT"
  _discountPct: number,    // kept for compat, always 0
  vatPct: number           // e.g. 15 or 0
): {
  baseAmount: number;
  discountAmount: number;
  afterDiscount: number;
  vatAmount: number;
  amount: number;          // grand total for line
} {
  const baseAmount = roundMoney(quantity * unitPrice);
  const discountAmount = 0;
  const afterDiscount = baseAmount;

  let vatAmount = 0;
  let amount = afterDiscount;

  if (priceType === "Including VAT") {
    // Price already includes VAT — extract it
    vatAmount = roundMoney(afterDiscount - afterDiscount / (1 + vatPct / 100));
    amount = afterDiscount; // total stays the same
  } else {
    // Excluding VAT — add VAT on top
    vatAmount = roundMoney(afterDiscount * (vatPct / 100));
    amount = roundMoney(afterDiscount + vatAmount);
  }

  return { baseAmount, discountAmount, afterDiscount, vatAmount, amount };
}

/** Legacy: simple qty × price */
export function calculateItemAmount(quantity: number, unitPrice: number): number {
  return roundMoney(quantity * unitPrice);
}

export function calculateTotals(
  items: Pick<PurchaseDraftItem, "amount" | "vatAmount" | "vatPct" | "quantity" | "unitPrice" | "priceType">[],
  _vatStatus?: string
): {
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  computedVatStatus: string;
} {
  // Sum the per-item amounts (already correct including/excluding VAT)
  const grandTotal = roundMoney(items.reduce((sum, item) => sum + safeNumber(item.amount), 0));
  // Sum VAT extracted/added per item
  const vatAmount = roundMoney(items.reduce((sum, item) => sum + safeNumber(item.vatAmount), 0));
  // Subtotal = grandTotal - vatAmount (base before VAT)
  const subtotal = roundMoney(grandTotal - vatAmount);
  const hasVat = items.some(i => safeNumber(i.vatPct) > 0);
  const computedVatStatus = hasVat ? "VAT 15%" : "No VAT";

  return { subtotal, vatAmount, grandTotal, computedVatStatus };
}

// Safely converts values to numbers for calculation
function safeNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object" && val !== null) {
    if ("toNumber" in val && typeof (val as { toNumber: unknown }).toNumber === "function") {
      return (val as { toNumber: () => number }).toNumber();
    }
  }
  return 0;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function decimalToNumber(value: Decimal | number): number {
  if (typeof value === "number") return value;
  return Number(value.toString());
}

export function formatMoney(value: number | Decimal): string {
  const num = typeof value === "number" ? value : decimalToNumber(value);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function generateMrNumber(): Promise<string> {
  const { prisma } = await import("./prisma");

  // Fetch all MR numbers and find the max numerically to avoid lexicographic sorting issues
  const all = await prisma.materialRequest.findMany({
    select: { mrNumber: true },
  });

  let maxNum = 0;
  for (const { mrNumber } of all) {
    const numPart = mrNumber.replace(/^MR-0*/i, "");
    const parsed = parseInt(numPart, 10);
    if (!isNaN(parsed) && parsed > maxNum) maxNum = parsed;
  }

  return `MR-${String(maxNum + 1).padStart(6, "0")}`;
}

export async function generatePrNumber(): Promise<string> {
  const { prisma } = await import("./prisma");

  // Fetch all PR numbers and find the max numerically
  const all = await prisma.purchaseRequest.findMany({
    select: { prNumber: true },
  });

  let maxNum = 0;
  for (const { prNumber } of all) {
    const numPart = prNumber.replace(/^PR-0*/i, "");
    const parsed = parseInt(numPart, 10);
    if (!isNaN(parsed) && parsed > maxNum) maxNum = parsed;
  }

  return `PR-${String(maxNum + 1).padStart(6, "0")}`;
}

export function parseDateInput(input: string): Date | null {
  const trimmed = input.trim();
  if (trimmed.toLowerCase() === "today") {
    return new Date();
  }
  const ddmmyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(date.getTime())) return date;
  }
  const iso = new Date(trimmed);
  if (!isNaN(iso.getTime())) return iso;
  return null;
}

export function parseNumberInput(input: string): number | null {
  const num = parseFloat(input.replace(/,/g, "").trim());
  if (isNaN(num) || num < 0) return null;
  return num;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "PENDING_APPROVAL":
      return "Pending Approval";
    case "APPROVED_FOR_PURCHASING":
      return "Approved for Purchasing";
    case "WAITING_FINAL_APPROVAL":
      return "Waiting for Final Approval";
    case "COMPLETED":
      return "Completed";
    case "REJECTED":
      return "Rejected";
    default:
      return status;
  }
}

export function validatePhone(input: string): boolean {
  return /^\+?[\d\s\-]{8,20}$/.test(input.trim());
}

export function validateTin(input: string): boolean {
  return /^\d{6,15}$/.test(input.trim());
}

export function validateAccount(input: string): boolean {
  // Accept 5–35 characters: digits, letters, hyphens, slashes, dots, spaces
  return /^[a-zA-Z0-9\-\s\/\.]{5,35}$/.test(input.trim());
}

export function validateUnit(input: string): boolean {
  return /^[a-zA-Z0-9\s]{1,10}$/.test(input.trim());
}
