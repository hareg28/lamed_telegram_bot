import prisma from "@/lib/prisma";
import {
  type DraftData,
  type PurchaseDraftItem,
  calculateTotals,
  generatePrNumber,
} from "@/lib/calculations";
import {
  notifyPurchaseSubmitted,
  notifyPurchaseApproved,
  notifyPurchaseRejected,
} from "@/lib/notifications";
import {
  upsertPurchaseRequestRows,
  appendPriceHistoryRows,
} from "@/lib/google-sheets";
import { logActivity } from "@/lib/activity-log";

// ──────────────────────────────────────────────────────────────────────────────
// Save as Draft
// ──────────────────────────────────────────────────────────────────────────────

export async function savePurchaseRequestDraft(
  purchaserId: string,
  telegramId: bigint,
  data: DraftData
) {
  const items = (data.items ?? []) as PurchaseDraftItem[];
  const activeItems = items.filter((item) => item.quantity > 0 && item.unitPrice > 0);
  if (activeItems.length === 0) throw new Error("NO_ITEMS");
  if (!data.materialRequestId) throw new Error("NO_MR");
  if (!data.supplierName?.trim()) throw new Error("NO_SUPPLIER");

  const mr = await prisma.materialRequest.findUnique({
    where: { id: data.materialRequestId },
  });
  if (!mr) throw new Error("INVALID_MR_STATUS");

  const totals = calculateTotals(activeItems);
  const prNumber = await generatePrNumber();

  let supplier = await prisma.supplier.findFirst({
    where: { name: { equals: data.supplierName.trim(), mode: "insensitive" } },
  });
  if (!supplier && data.supplierId) {
    supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
  }
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name: data.supplierName.trim(),
        phone: data.supplierPhone,
      },
    });
  }

  const pr = await prisma.purchaseRequest.create({
    data: {
      prNumber,
      materialRequestId: mr.id,
      purchaserId,
      supplierId: supplier?.id,
      supplierName: data.supplierName.trim(),
      supplierCompanyName: data.supplierCompanyName,
      supplierPhone: data.supplierPhone,
      supplierBankName: data.supplierBankName,
      accountNumber: data.accountNumber,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      grandTotal: totals.grandTotal,
      vatStatus: totals.computedVatStatus,
      status: "DRAFT",
      items: {
        create: activeItems.map((item) => ({
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          priceType: item.priceType,
          discountPct: item.discountPct,
          discountAmount: item.discountAmount,
          vatPct: item.vatPct,
          vatAmount: item.vatAmount,
          amount: item.amount,
          materialRequestItemId: item.materialItemId,
          lineId: item.lineId,
        })),
      },
    },
    include: { items: true, purchaser: true },
  });

  await prisma.formDraft.deleteMany({ where: { telegramId } });
  return pr;
}

// ──────────────────────────────────────────────────────────────────────────────
// Get draft PRs for a purchaser
// ──────────────────────────────────────────────────────────────────────────────

export async function getDraftPurchaseRequests(purchaserId: string) {
  return prisma.purchaseRequest.findMany({
    where: { purchaserId, status: "DRAFT" },
    include: {
      items: true,
      materialRequest: { select: { mrNumber: true, projectName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getPurchaseRequestsByPurchaser(
  userId: string,
  limit = 20,
  options?: { status?: string | string[]; dateFrom?: Date; dateTo?: Date }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const isAdmin = user?.role === "ADMINISTRATOR";
  
  const where: any = {};
  
  if (!isAdmin) {
    where.purchaserId = userId;
  }
  
  if (options?.status) {
    if (Array.isArray(options.status)) {
      where.status = { in: options.status };
    } else {
      where.status = options.status;
    }
  }
  
  if (options?.dateFrom) {
    where.createdAt = where.createdAt || {};
    where.createdAt.gte = options.dateFrom;
  }
  
  if (options?.dateTo) {
    where.createdAt = where.createdAt || {};
    where.createdAt.lt = options.dateTo;
  }
  
  return prisma.purchaseRequest.findMany({
    where,
    include: {
      items: true,
      materialRequest: { 
        select: { mrNumber: true, projectName: true, requesterName: true } 
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Submit Purchase Request
// ──────────────────────────────────────────────────────────────────────────────

export async function submitPurchaseRequest(
  purchaserId: string,
  telegramId: bigint,
  data: DraftData
) {
  const items = (data.items ?? []) as PurchaseDraftItem[];
  const activeItems = items.filter((item) => item.quantity > 0 && item.unitPrice > 0);
  if (activeItems.length === 0) throw new Error("NO_ITEMS");
  if (!data.materialRequestId) throw new Error("NO_MR");
  if (!data.supplierName?.trim()) throw new Error("NO_SUPPLIER");

  const mr = await prisma.materialRequest.findUnique({
    where: { id: data.materialRequestId },
    include: { items: true },
  });

  if (!mr || (mr.status !== "APPROVED_FOR_PURCHASING" && mr.status !== "WAITING_FINAL_APPROVAL")) {
    throw new Error("INVALID_MR_STATUS");
  }

  const totals = calculateTotals(activeItems);
  const prNumber = await generatePrNumber();

  let supplier = await prisma.supplier.findFirst({
    where: { name: { equals: data.supplierName.trim(), mode: "insensitive" } },
  });
  if (!supplier && data.supplierId) {
    supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
  }
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name: data.supplierName.trim(),
        phone: data.supplierPhone,
      },
    });
  }

  const purchase = await prisma.$transaction(async (tx) => {
    const pr = await tx.purchaseRequest.create({
      data: {
        prNumber,
        materialRequestId: mr.id,
        purchaserId,
        supplierId: supplier!.id,
        supplierName: data.supplierName!.trim(),
        supplierCompanyName: data.supplierCompanyName,
        supplierPhone: data.supplierPhone,
        supplierBankName: data.supplierBankName,
        accountNumber: data.accountNumber,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        grandTotal: totals.grandTotal,
        vatStatus: totals.computedVatStatus,
        status: "PENDING_APPROVAL",
        items: {
          create: activeItems.map((item) => ({
            itemName: item.itemName,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            priceType: item.priceType,
            discountPct: item.discountPct,
            discountAmount: item.discountAmount,
            vatPct: item.vatPct,
            vatAmount: item.vatAmount,
            amount: item.amount,
            materialRequestItemId: item.materialItemId,
            lineId: item.lineId,
          })),
        },
      },
      include: { items: true, purchaser: true },
    });

    await tx.materialRequest.update({
      where: { id: mr.id },
      data: { status: "WAITING_FINAL_APPROVAL" },
    });

    await tx.approvalHistory.create({
      data: {
        materialRequestId: mr.id,
        purchaseRequestId: pr.id,
        action: "PURCHASE_SUBMITTED",
        performedById: purchaserId,
      },
    });

    return pr;
  }, { timeout: 20000 });

  await prisma.formDraft.deleteMany({ where: { telegramId } });

  await notifyPurchaseSubmitted(mr.id, purchase.id);
  await logActivity("PURCHASE_SUBMITTED", "PurchaseRequest", purchase.id, purchaserId);

  // Sync submitted PR to Google Sheets (as Pending Approval)
  const full = await getPurchaseRequestById(purchase.id);
  if (full) {
    await upsertPurchaseRequestRows(full as any).catch((err) =>
      console.error("Google Sheets PR sync error:", err)
    );
  }

  return purchase;
}

// ──────────────────────────────────────────────────────────────────────────────
// Approve Purchase Request
// ──────────────────────────────────────────────────────────────────────────────

export async function approvePurchaseRequest(
  prId: string,
  adminId: string,
  remarks?: string
) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
    include: {
      items: true,
      purchaser: true,
      materialRequest: {
        include: {
          requestedBy: true,
          items: {
            include: {
              purchaseItems: {
                include: {
                  purchase: true,
                  materialRequestItem: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!pr || pr.status !== "PENDING_APPROVAL") {
    throw new Error("INVALID_STATUS");
  }

  const mr = pr.materialRequest;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.update({
      where: { id: prId },
      data: {
        status: "APPROVED",
        approvalDate: now,
        approvedById: adminId,
      },
    });

    await tx.materialRequest.update({
      where: { id: mr.id },
      data: { status: "APPROVED_FOR_PURCHASING" },
    });

    await tx.approvalHistory.create({
      data: {
        materialRequestId: mr.id,
        purchaseRequestId: prId,
        action: "PURCHASE_APPROVED",
        performedById: adminId,
      },
    });
  }, { timeout: 20000 });

  const completed = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
    include: {
      items: true,
      purchaser: true,
      approvedBy: true,
      materialRequest: {
        include: { requestedBy: true, items: true },
      },
    },
  });

  if (completed) {
    await notifyPurchaseApproved(mr.id, prId);
    await logActivity("PURCHASE_APPROVED", "PurchaseRequest", prId, adminId);

    // Sync to Sheet 2 (Purchase Requests)
    await upsertPurchaseRequestRows(completed as any).catch((err) =>
      console.error("Google Sheets PR sync error:", err)
    );

    // Also sync MR status update to Sheet 1
    const updatedMr = await prisma.materialRequest.findUnique({
      where: { id: mr.id },
      include: { items: true, requestedBy: true },
    });
    if (updatedMr) {
      const { upsertMaterialRequestRows } = await import("@/lib/google-sheets");
      const admin = await prisma.user.findUnique({ where: { id: adminId } });
      await upsertMaterialRequestRows(updatedMr as any, {
        approvedByName: admin?.fullName,
      }).catch((err) => console.error("Google Sheets MR sync error:", err));
    }
  }

  return completed;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reject Purchase Request
// ──────────────────────────────────────────────────────────────────────────────

export async function rejectPurchaseRequest(
  prId: string,
  adminId: string,
  remarks?: string
) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
    include: { materialRequest: true, items: true, purchaser: true, approvedBy: true },
  });

  if (!pr || pr.status !== "PENDING_APPROVAL") {
    throw new Error("INVALID_STATUS");
  }

  const mr = pr.materialRequest;

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.update({
      where: { id: prId },
      data: {
        status: "REJECTED",
        rejectionReason: remarks,
      },
    });

    const pendingPrs = await tx.purchaseRequest.count({
      where: {
        materialRequestId: mr.id,
        status: "PENDING_APPROVAL",
        id: { not: prId },
      },
    });

    await tx.materialRequest.update({
      where: { id: mr.id },
      data: { status: pendingPrs > 0 ? "WAITING_FINAL_APPROVAL" : "APPROVED_FOR_PURCHASING" },
    });

    await tx.approvalHistory.create({
      data: {
        materialRequestId: mr.id,
        purchaseRequestId: prId,
        action: "PURCHASE_REJECTED",
        performedById: adminId,
      },
    });
  }, { timeout: 20000 });

  await notifyPurchaseRejected(mr.id, prId, remarks);
  await logActivity("PURCHASE_REJECTED", "PurchaseRequest", prId, adminId, { remarks });

  // Sync rejection to Sheet 2
  const updated = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
    include: {
      items: true,
      purchaser: true,
      approvedBy: true,
      materialRequest: { include: { requestedBy: true } },
    },
  });
  if (updated) {
    await upsertPurchaseRequestRows(updated as any, { rejectionReason: remarks }).catch((err) =>
      console.error("Google Sheets PR sync error:", err)
    );
  }

  return pr;
}

// ──────────────────────────────────────────────────────────────────────────────
// Lookups
// ──────────────────────────────────────────────────────────────────────────────

export async function getPurchaseRequestById(id: string) {
  return prisma.purchaseRequest.findUnique({
    where: { id },
    include: {
      items: {
        include: { materialRequestItem: true },
        orderBy: { sortOrder: "asc" },
      },
      purchaser: true,
      approvedBy: true,
      materialRequest: { include: { requestedBy: true, items: true } },
    },
  });
}

export async function getPurchaseRequestByPrNumber(prNumber: string) {
  return prisma.purchaseRequest.findUnique({
    where: { prNumber: prNumber.trim().toUpperCase() },
    include: {
      items: {
        include: { materialRequestItem: true },
        orderBy: { sortOrder: "asc" },
      },
      purchaser: true,
      approvedBy: true,
      materialRequest: { include: { requestedBy: true, items: true } },
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Mark PR as Purchased (ORDERED)
// ──────────────────────────────────────────────────────────────────────────────

export async function markPurchaseRequestAsPurchased(
  prId: string,
  userId: string
) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
  });

  if (!pr || pr.status !== "APPROVED") {
    throw new Error("INVALID_STATUS");
  }

  await prisma.purchaseRequest.update({
    where: { id: prId },
    data: {
      status: "ORDERED",
    },
  });

  const fullPr = await getPurchaseRequestById(prId);
  if (fullPr) {
    await logActivity("PURCHASE_ORDERED", "PurchaseRequest", prId, userId);
    // Sync to Sheet 2 (Purchase Requests)
    await upsertPurchaseRequestRows(fullPr as any).catch((err) =>
      console.error("Google Sheets PR sync error:", err)
    );
  }

  return fullPr;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mark PR as Completed
// ──────────────────────────────────────────────────────────────────────────────

export async function markPurchaseRequestAsCompleted(
  prId: string,
  userId: string
) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: prId },
    include: {
      items: true,
      materialRequest: {
        include: {
          items: {
            include: {
              purchaseItems: {
                include: {
                  purchase: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!pr || pr.status !== "ORDERED") {
    throw new Error("INVALID_STATUS");
  }

  const now = new Date();

  // Transaction to update PR status and check MR status
  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.update({
      where: { id: prId },
      data: {
        status: "COMPLETED",
        actualDeliveryDate: now,
        deliveryStatus: "DELIVERED",
      },
    });

    const mr = pr.materialRequest;

    // Check if all items in MR are completed (fully purchased and delivered)
    let allItemsCompleted = true;
    for (const item of mr.items) {
      const completedQty = item.purchaseItems
        .filter((pi) =>
          pi.purchase?.id === prId
            ? true
            : pi.purchase?.status === "COMPLETED"
        )
        .reduce((sum, pi) => sum + Number(pi.quantity), 0);

      if (completedQty < Number(item.quantity)) {
        allItemsCompleted = false;
        break;
      }
    }

    if (allItemsCompleted) {
      await tx.materialRequest.update({
        where: { id: mr.id },
        data: { status: "COMPLETED" },
      });
    }
  }, { timeout: 20000 });

  const completedPr = await getPurchaseRequestById(prId);
  if (completedPr) {
    await logActivity("PURCHASE_COMPLETED", "PurchaseRequest", prId, userId);

    // Sync to Sheet 2 (Purchase Requests) and Sheet 4 (Price History)
    await upsertPurchaseRequestRows(completedPr as any).catch((err) =>
      console.error("Google Sheets PR sync error:", err)
    );
    await appendPriceHistoryRows(completedPr as any).catch((err) =>
      console.error("Google Sheets Price History sync error:", err)
    );

    // If MR status updated to COMPLETED, sync MR to Sheet 1
    const mr = completedPr.materialRequest;
    const updatedMr = await prisma.materialRequest.findUnique({
      where: { id: mr.id },
      include: { items: true, requestedBy: true },
    });
    if (updatedMr && updatedMr.status === "COMPLETED") {
      const { upsertMaterialRequestRows } = await import("@/lib/google-sheets");
      const approver = completedPr.approvedBy;
      await upsertMaterialRequestRows(updatedMr as any, {
        approvedByName: approver?.fullName ?? undefined,
      }).catch((err) => console.error("Google Sheets MR sync error:", err));
    }
  }

  return completedPr;
}
