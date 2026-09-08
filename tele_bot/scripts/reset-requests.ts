import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log(" Wiping Material Requests, Purchase Requests, and History...");
  
  // Delete child records first to satisfy foreign key constraints
  await prisma.purchaseRequestItem.deleteMany({});
  await prisma.purchaseRequest.deleteMany({});
  await prisma.materialRequestItem.deleteMany({});
  await prisma.materialRequest.deleteMany({});
  await prisma.approvalHistory.deleteMany({});
  await prisma.formDraft.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.activityLog.deleteMany({});
  
  console.log("✅ Database cleared! User accounts, roles, and project list are preserved.");
  console.log("MR sequence reset to: MR-000001");
  console.log("PR sequence reset to: PR-000001");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
