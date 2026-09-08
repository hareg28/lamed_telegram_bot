
import "dotenv/config";
import prisma from "@/lib/prisma";
import { approveMaterialRequest, getMaterialRequestById } from "@/lib/material-request";

console.log("Testing material request approval...");

async function testApproval() {
  try {
    console.log("Getting first pending MR...");
    const mr = await prisma.materialRequest.findFirst({
      where: { status: "PENDING_APPROVAL" },
    });
    if (!mr) {
      console.log("No pending MRs found!");
      return;
    }
    console.log(`Found MR: ${mr.mrNumber} (ID: ${mr.id})`);
    const admin = await prisma.user.findFirst({
      where: { role: "ADMINISTRATOR" },
    });
    if (!admin) {
      console.log("No admin user found!");
      return;
    }
    console.log(`Using admin: ${admin.fullName} (ID: ${admin.id})`);
    const result = await approveMaterialRequest(mr.id, admin.id);
    console.log(`✅ Approval succeeded! Status: ${result.status}`);
  } catch (err) {
    console.error("❌ Approval error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testApproval();
