import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    // Use a simple query with a short timeout
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}

export async function waitForDatabase(
  maxAttempts: number = 5,
  delay: number = 3000
): Promise<boolean> {
  console.log(`⏳ Waiting for database to be ready (max ${maxAttempts} attempts)...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isHealthy = await checkDatabaseHealth();
    if (isHealthy) {
      console.log(`✅ Database is ready! (attempt ${attempt})`);
      return true;
    }
    console.log(`⏳ Database not ready yet (attempt ${attempt}/${maxAttempts}), waiting ${delay/1000}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  console.log(`⚠️ Database not ready after ${maxAttempts} attempts`);
  return false;
}