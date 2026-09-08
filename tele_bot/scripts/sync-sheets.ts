import { PrismaClient } from "@prisma/client";
import {
  upsertMaterialRequestRows,
  upsertPurchaseRequestRows,
  appendSupplierRow,
  appendPriceHistoryRows,
  upsertProjectRow,
} from "../src/lib/google-sheets";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Google Sheets synchronization...");

  // 0. Sync Projects
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Syncing ${projects.length} projects...`);
  for (const project of projects) {
    await upsertProjectRow(project);
  }

  // 1. Sync Suppliers
  const suppliers = await prisma.supplier.findMany();
  console.log(`Syncing ${suppliers.length} suppliers...`);
  for (const supplier of suppliers) {
    await appendSupplierRow(supplier);
  }

  // 2. Sync Material Requests
  const materialRequests = await prisma.materialRequest.findMany({
    include: {
      items: true,
      requestedBy: true,
      approvalHistory: {
        include: { performedBy: true }
      },
    },
  });
  console.log(`Syncing ${materialRequests.length} material requests...`);
  for (const mr of materialRequests) {
    // Attempt to extract rejection reason and approved by name from history
    let rejectionReason = undefined;
    
    // Find the latest approval action to get the approver
    const approvalAction = mr.approvalHistory.find(h => h.action === "MR_APPROVED");
    let approvedByName = approvalAction?.performedBy?.fullName;
    
    if (mr.status === "REJECTED") {
      const rejAction = mr.approvalHistory.find(h => h.action === "MR_REJECTED");
      if (rejAction) rejectionReason = rejAction.remarks ?? undefined;
    }

    await upsertMaterialRequestRows(mr as any, {
      rejectionReason,
      approvedByName,
    });
  }

  // 3. Sync Purchase Requests
  const purchaseRequests = await prisma.purchaseRequest.findMany({
    include: {
      items: true,
      purchaser: true,
      approvedBy: true,
      materialRequest: {
        include: { requestedBy: true, items: true }
      },
      approvalHistory: true,
    },
  });
  console.log(`Syncing ${purchaseRequests.length} purchase requests...`);
  for (const pr of purchaseRequests) {
    let rejectionReason = pr.rejectionReason ?? undefined;
    if (pr.status === "REJECTED" && !rejectionReason) {
      const rejAction = pr.approvalHistory.find(h => h.action === "PURCHASE_REJECTED");
      if (rejAction) rejectionReason = rejAction.remarks ?? undefined;
    }

    await upsertPurchaseRequestRows(pr as any, { rejectionReason });

    // 4. Sync Price History for completed PRs
    if (pr.status === "COMPLETED") {
      await appendPriceHistoryRows(pr as any);
    }
  }

  console.log("Synchronization complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
