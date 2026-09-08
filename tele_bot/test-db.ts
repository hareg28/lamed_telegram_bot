
import "dotenv/config";
import prisma from "@/lib/prisma";

console.log("Testing database connection...");

async function testDb() {
  try {
    console.log("Attempting to connect...");
    const userCount = await prisma.user.count();
    console.log(`✅ Connected! Found ${userCount} users!`);
    console.log("Testing material request query...");
    const mrCount = await prisma.materialRequest.count();
    console.log(`✅ Found ${mrCount} material requests!`);
  } catch (err) {
    console.error("❌ Database connection error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDb();
