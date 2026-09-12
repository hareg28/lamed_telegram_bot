import prisma from "@/lib/prisma";
import {
  type DraftData,
  type MaterialDraftItem,
  generateMrNumber,
} from "@/lib/calculations";
import {
  notifyMrSubmitted,
  notifyMrApproved,
  notifyMrRejected,
} from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";
import type { RequestStatus } from "@prisma/client";

export const MR_FULL_INCLUDE = {
  requestedBy: true,
  items: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      purchaseItems: {
        include: {
          purchase: true,
          materialRequestItem: true,
        }
      }
    }
  },
  purchaseRequests: {
    include: {
      items: { orderBy: { sortOrder: "asc" as const } },
      purchaser: true,
      approvedBy: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
  approvalHistory: {
    include: { performedBy: true },
    orderBy: { createdAt: "desc" as const },
  },
};

export async function submitMaterialRequest(
  userId: string,
  telegramId: bigint,
  data: DraftData
) {
  const items = (data.items ?? []) as MaterialDraftItem[];
  if (items.length === 0) {
    throw new Error("NO_ITEMS");
  }
  if (!data.projectName?.trim()) {
    throw new Error("NO_PROJECT");
  }
  if (!data.requestedBy?.trim()) {
    throw new Error("NO_REQUESTER");
  }

  const mrNumber = await generateMrNumber();
  const now = new Date();

  const project = await prisma.project.findFirst({
    where: { name: { equals: data.projectName.trim(), mode: "insensitive" } },
  });
  if (!project) {
    throw new Error("INVALID_PROJECT");
  }

  const projectType = data.projectType?.trim() || project.projectType || null;
  if (data.projectType?.trim() && !project.projectType) {
    await prisma.project
      .update({
        where: { id: project.id },
        data: { projectType: data.projectType.trim() },
      })
      .catch(console.error);
  }

  const mr = await prisma.materialRequest.create({
    data: {
      mrNumber,
      projectName: data.projectName.trim(),
      projectType,
      boq: data.boq?.trim() || null,
      projectId: project.id,
      requestedById: userId,
      requesterName: data.requestedBy.trim(),
      prNumber: data.prNumber?.trim() || null,
      requestDate: now,
      status: "PENDING_APPROVAL",
      items: {
        create: items.map((item, index) => {
          const cleanItemName = item.itemName.replace(/^\[.*?\]\s*/, "").trim();
          return {
            lineId: `${mrNumber}/${String(index + 1).padStart(3, "0")}`,
            boqSection: item.boqSection?.trim() || data.boq?.trim() || null,
            itemName: cleanItemName,
            quantity: item.quantity,
            unit: item.unit,
            sortOrder: index,
          };
        }),
      },
      approvalHistory: {
        create: {
          action: "MR_SUBMITTED",
          performedById: userId,
        },
      },
    },
    include: {
      items: true,
      requestedBy: true,
    },
  });

  await prisma.formDraft.deleteMany({ where: { telegramId } });

  // Sync to Google Sheets Sheet 1 (Material Requests) upon submission
  const { upsertMaterialRequestRows } = await import("@/lib/google-sheets");
  await upsertMaterialRequestRows(mr as any).catch((err) =>
    console.error("Google Sheets MR sync error:", err)
  );

  await notifyMrSubmitted(mr.id);
  await logActivity("MR_SUBMITTED", "MaterialRequest", mr.id, userId, {
    mrNumber,
  });

  return mr;
}

export async function approveMaterialRequest(
  mrId: string,
  adminId: string,
  remarks?: string
) {
  const mr = await prisma.materialRequest.findUnique({ where: { id: mrId } });
  if (!mr || mr.status !== "PENDING_APPROVAL") {
    throw new Error("INVALID_STATUS");
  }

  const updated = await prisma.materialRequest.update({
    where: { id: mrId },
    data: { status: "APPROVED_FOR_PURCHASING" },
    include: { items: true, requestedBy: true },
  });

  await prisma.approvalHistory.create({
    data: {
      materialRequestId: mrId,
      action: "MR_APPROVED",
      performedById: adminId,
    },
  });

  await notifyMrApproved(mrId);

  // Sync to Google Sheets Sheet 1 (Material Requests)
  const { upsertMaterialRequestRows } = await import("@/lib/google-sheets");
  const admin = await prisma.user.findUnique({ where: { id: adminId } });
  await upsertMaterialRequestRows(updated, { approvedByName: admin?.fullName ?? undefined }).catch((err) =>
    console.error("Google Sheets MR sync error:", err)
  );

  await logActivity("MR_APPROVED", "MaterialRequest", mrId, adminId);

  return updated;
}

export async function rejectMaterialRequest(
  mrId: string,
  adminId: string,
  remarks?: string
) {
  const mr = await prisma.materialRequest.findUnique({ where: { id: mrId } });
  if (!mr || mr.status !== "PENDING_APPROVAL") {
    throw new Error("INVALID_STATUS");
  }

  const updated = await prisma.materialRequest.update({
    where: { id: mrId },
    data: { status: "REJECTED" },
    include: { items: true, requestedBy: true },
  });

  await prisma.approvalHistory.create({
    data: {
      materialRequestId: mrId,
      action: "MR_REJECTED",
      performedById: adminId,
    },
  });

  await notifyMrRejected(mrId, remarks);

  // Sync rejection to Google Sheets Sheet 1
  const { upsertMaterialRequestRows } = await import("@/lib/google-sheets");
  await upsertMaterialRequestRows(updated, { rejectionReason: remarks ?? "" }).catch((err) =>
    console.error("Google Sheets MR sync error:", err)
  );

  await logActivity("MR_REJECTED", "MaterialRequest", mrId, adminId, { remarks });

  return updated;
}

export interface SearchFilters {
  status?: RequestStatus | RequestStatus[];
  projectName?: string;
  supplierName?: string;
  requesterId?: string;
  purchaserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export async function searchMaterialRequests(
  filters: SearchFilters,
  page = 1,
  pageSize = 5
) {
  const where: Record<string, unknown> = {};

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      where.status = { in: filters.status };
    } else {
      where.status = filters.status;
    }
  }
  if (filters.projectName) {
    where.projectName = { contains: filters.projectName, mode: "insensitive" };
  }
  if (filters.requesterId) where.requestedById = filters.requesterId;
  if (filters.dateFrom || filters.dateTo) {
    where.requestDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.search) {
    where.OR = [
      { mrNumber: { contains: filters.search, mode: "insensitive" } },
      { projectName: { contains: filters.search, mode: "insensitive" } },
      {
        items: {
          some: { itemName: { contains: filters.search, mode: "insensitive" } },
        },
      },
      {
        purchaseRequests: {
          some: {
            OR: [
              { prNumber: { contains: filters.search, mode: "insensitive" } },
              { supplierName: { contains: filters.search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }
  if (filters.supplierName) {
    where.purchaseRequests = {
      some: {
        supplierName: { contains: filters.supplierName, mode: "insensitive" },
      },
    };
  }
  if (filters.purchaserId) {
    where.purchaseRequests = {
      some: {
        purchaserId: filters.purchaserId,
      },
    };
  }

  const [results, total] = await prisma.$transaction([
    prisma.materialRequest.findMany({
      where,
      include: {
        requestedBy: true,
        items: true,
        purchaseRequests: {
          include: { items: true, purchaser: true, approvedBy: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.materialRequest.count({ where }),
  ]);

  return {
    results,
    total,
    totalPages: Math.ceil(total / pageSize),
    page,
    pageSize,
  };
}

export async function getMaterialRequestById(id: string) {
  return prisma.materialRequest.findUnique({
    where: { id },
    include: {
      requestedBy: true,
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          purchaseItems: {
            include: {
              purchase: true,
              materialRequestItem: true,
            }
          }
        }
      },
      purchaseRequests: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          purchaser: true,
          approvedBy: true,
        },
        orderBy: { createdAt: "desc" },
      },
      approvalHistory: {
        include: { performedBy: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function getMaterialRequestByMrNumber(mrNumber: string) {
  let searchNumber = mrNumber.trim().toUpperCase();
  if (/^\d+$/.test(searchNumber)) {
    searchNumber = `MR-${searchNumber.padStart(6, "0")}`;
  } else if (/^MR-\d+$/i.test(searchNumber)) {
    const numPart = searchNumber.replace(/^MR-/i, "");
    searchNumber = `MR-${numPart.padStart(6, "0")}`;
  }

  return prisma.materialRequest.findUnique({
    where: { mrNumber: searchNumber },
    include: {
      requestedBy: true,
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          purchaseItems: {
            include: {
              purchase: true,
              materialRequestItem: true,
            }
          }
        }
      },
      purchaseRequests: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          purchaser: true,
          approvedBy: true,
        },
        orderBy: { createdAt: "desc" },
      },
      approvalHistory: {
        include: { performedBy: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function getUserMaterialRequests(
  userId: string, 
  limit = 20,
  options?: { 
    status?: string | string[], 
    dateFrom?: Date, 
    dateTo?: Date 
  }
) {
  const where: any = { requestedById: userId };
  
  if (options?.status) {
    if (Array.isArray(options.status)) {
      where.status = { in: options.status };
    } else {
      where.status = options.status;
    }
  }
  
  if (options?.dateFrom || options?.dateTo) {
    where.requestDate = {};
    if (options.dateFrom) where.requestDate.gte = options.dateFrom;
    if (options.dateTo) where.requestDate.lte = options.dateTo;
  }
  
  return prisma.materialRequest.findMany({
    where,
    include: MR_FULL_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function getItemFulfillment(item: any) {
  const requestedQty = Number(item.quantity ?? 0);
  const purchasedQty = (item.purchaseItems ?? [])
    .filter((pi: any) => pi.purchase?.status !== "REJECTED")
    .reduce((sum: number, pi: any) => sum + Number(pi.quantity ?? 0), 0);
  
  const remainingQty = Math.max(0, requestedQty - purchasedQty);
  let statusBadge = "🔴 Pending";
  if (purchasedQty >= requestedQty && requestedQty > 0) {
    statusBadge = "🟢 Purchased";
  } else if (purchasedQty > 0) {
    statusBadge = `🟡 Partial (${purchasedQty}/${requestedQty} ${item.unit})`;
  }

  return {
    requestedQty,
    purchasedQty,
    remainingQty,
    statusBadge,
    isFullyPurchased: purchasedQty >= requestedQty,
  };
}

export function hasRemainingItems(mr: any): boolean {
  for (const item of mr.items) {
    const fulfillment = getItemFulfillment(item);
    if (fulfillment.remainingQty > 0) {
      return true;
    }
  }
  return false;
}

export async function getApprovedMaterialRequests(limit = 20, options?: { status?: string | string[]; dateFrom?: Date; dateTo?: Date }) {
  const where: any = {};
  if (options?.status) {
    where.status = Array.isArray(options.status) ? { in: options.status } : options.status;
  } else {
    where.status = "APPROVED_FOR_PURCHASING";
  }
  
  if (options?.dateFrom) {
    where.updatedAt = where.updatedAt || {};
    where.updatedAt.gte = options.dateFrom;
  }
  
  if (options?.dateTo) {
    where.updatedAt = where.updatedAt || {};
    where.updatedAt.lt = options.dateTo;
  }
  
  const allApproved = await prisma.materialRequest.findMany({
    where,
    include: {
      requestedBy: true,
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          purchaseItems: {
            include: {
              purchase: true,
              materialRequestItem: true,
            }
          }
        }
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  
  return allApproved.filter(mr => hasRemainingItems(mr));
}

export async function getPurchaserHistory(purchaserId: string, limit = 20) {
  return prisma.materialRequest.findMany({
    where: {
      purchaseRequests: { some: { purchaserId } },
    },
    include: {
      requestedBy: true,
      items: true,
      purchaseRequests: { include: { items: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export async function getReportData(
  type: "daily" | "weekly" | "monthly" | "project" | "supplier" | "requester",
  filter?: string,
  status?: RequestStatus,
  page = 1,
  pageSize = 100
) {
  const now = new Date();
  let dateFrom: Date | undefined;

  switch (type) {
    case "daily":
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "weekly":
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "monthly":
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }

  const filters: SearchFilters = { 
    dateFrom 
  };
  
  if (status) {
    filters.status = status;
  }

  if (type === "project" && filter) filters.projectName = filter;
  if (type === "requester" && filter) {
    // Search for user by name or username
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { fullName: { contains: filter, mode: "insensitive" } },
          { telegramUsername: { contains: filter, mode: "insensitive" } }
        ]
      }
    });
    if (users.length > 0) {
      filters.requesterId = users[0].id;
    }
  }
  if (type === "supplier" && filter) filters.supplierName = filter;

  const searchResult = await searchMaterialRequests(filters, page, pageSize);
  return searchResult.results;
}
