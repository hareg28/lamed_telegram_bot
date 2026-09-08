import { PrismaClient } from '@prisma/client';

// Create a single Prisma instance
const prisma = new PrismaClient();

// Retry function for database operations
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Only retry on connection errors
      const errorMessage = error.message?.toLowerCase() || '';
      const isConnectionError = 
        errorMessage.includes("can't reach database server") ||
        errorMessage.includes("terminating connection") ||
        errorMessage.includes("connection terminated") ||
        errorMessage.includes("connection refused") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("e57p01") ||
        errorMessage.includes("connect etimedout") ||
        errorMessage.includes("pooler");
      
      if (isConnectionError && attempt < maxRetries) {
        console.log(`⏳ Database connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If it's not a connection error or we're out of retries, throw
      throw error;
    }
  }
  
  throw lastError || new Error('Database operation failed after retries');
}

// Simple db object with wrapped methods
export const db = {
  // User methods
  user: {
    findUnique: (args: any) => withRetry(() => prisma.user.findUnique(args)),
    findMany: (args: any) => withRetry(() => prisma.user.findMany(args)),
    findFirst: (args: any) => withRetry(() => prisma.user.findFirst(args)),
    create: (args: any) => withRetry(() => prisma.user.create(args)),
    update: (args: any) => withRetry(() => prisma.user.update(args)),
    delete: (args: any) => withRetry(() => prisma.user.delete(args)),
    count: (args?: any) => withRetry(() => prisma.user.count(args)),
    upsert: (args: any) => withRetry(() => prisma.user.upsert(args)),
    updateMany: (args: any) => withRetry(() => prisma.user.updateMany(args)),
    deleteMany: (args: any) => withRetry(() => prisma.user.deleteMany(args)),
  },
  
  // MaterialRequest methods
  materialRequest: {
    findUnique: (args: any) => withRetry(() => prisma.materialRequest.findUnique(args)),
    findMany: (args: any) => withRetry(() => prisma.materialRequest.findMany(args)),
    findFirst: (args: any) => withRetry(() => prisma.materialRequest.findFirst(args)),
    create: (args: any) => withRetry(() => prisma.materialRequest.create(args)),
    update: (args: any) => withRetry(() => prisma.materialRequest.update(args)),
    delete: (args: any) => withRetry(() => prisma.materialRequest.delete(args)),
    count: (args?: any) => withRetry(() => prisma.materialRequest.count(args)),
    upsert: (args: any) => withRetry(() => prisma.materialRequest.upsert(args)),
    updateMany: (args: any) => withRetry(() => prisma.materialRequest.updateMany(args)),
    deleteMany: (args: any) => withRetry(() => prisma.materialRequest.deleteMany(args)),
  },
  
  // MaterialRequestItem methods
  materialRequestItem: {
    findUnique: (args: any) => withRetry(() => prisma.materialRequestItem.findUnique(args)),
    findMany: (args: any) => withRetry(() => prisma.materialRequestItem.findMany(args)),
    findFirst: (args: any) => withRetry(() => prisma.materialRequestItem.findFirst(args)),
    create: (args: any) => withRetry(() => prisma.materialRequestItem.create(args)),
    update: (args: any) => withRetry(() => prisma.materialRequestItem.update(args)),
    delete: (args: any) => withRetry(() => prisma.materialRequestItem.delete(args)),
    count: (args?: any) => withRetry(() => prisma.materialRequestItem.count(args)),
    upsert: (args: any) => withRetry(() => prisma.materialRequestItem.upsert(args)),
    updateMany: (args: any) => withRetry(() => prisma.materialRequestItem.updateMany(args)),
    deleteMany: (args: any) => withRetry(() => prisma.materialRequestItem.deleteMany(args)),
  },
  
  // PurchaseRequest methods
  purchaseRequest: {
    findUnique: (args: any) => withRetry(() => prisma.purchaseRequest.findUnique(args)),
    findMany: (args: any) => withRetry(() => prisma.purchaseRequest.findMany(args)),
    findFirst: (args: any) => withRetry(() => prisma.purchaseRequest.findFirst(args)),
    create: (args: any) => withRetry(() => prisma.purchaseRequest.create(args)),
    update: (args: any) => withRetry(() => prisma.purchaseRequest.update(args)),
    delete: (args: any) => withRetry(() => prisma.purchaseRequest.delete(args)),
    count: (args?: any) => withRetry(() => prisma.purchaseRequest.count(args)),
    upsert: (args: any) => withRetry(() => prisma.purchaseRequest.upsert(args)),
    updateMany: (args: any) => withRetry(() => prisma.purchaseRequest.updateMany(args)),
    deleteMany: (args: any) => withRetry(() => prisma.purchaseRequest.deleteMany(args)),
  },
  
  // PurchaseRequestItem methods
  purchaseRequestItem: {
    findUnique: (args: any) => withRetry(() => prisma.purchaseRequestItem.findUnique(args)),
    findMany: (args: any) => withRetry(() => prisma.purchaseRequestItem.findMany(args)),
    findFirst: (args: any) => withRetry(() => prisma.purchaseRequestItem.findFirst(args)),
    create: (args: any) => withRetry(() => prisma.purchaseRequestItem.create(args)),
    update: (args: any) => withRetry(() => prisma.purchaseRequestItem.update(args)),
    delete: (args: any) => withRetry(() => prisma.purchaseRequestItem.delete(args)),
    count: (args?: any) => withRetry(() => prisma.purchaseRequestItem.count(args)),
    upsert: (args: any) => withRetry(() => prisma.purchaseRequestItem.upsert(args)),
    updateMany: (args: any) => withRetry(() => prisma.purchaseRequestItem.updateMany(args)),
    deleteMany: (args: any) => withRetry(() => prisma.purchaseRequestItem.deleteMany(args)),
  },
  
  // Supplier methods
  supplier: {
    findUnique: (args: any) => withRetry(() => prisma.supplier.findUnique(args)),
    findMany: (args: any) => withRetry(() => prisma.supplier.findMany(args)),
    findFirst: (args: any) => withRetry(() => prisma.supplier.findFirst(args)),
    create: (args: any) => withRetry(() => prisma.supplier.create(args)),
    update: (args: any) => withRetry(() => prisma.supplier.update(args)),
    delete: (args: any) => withRetry(() => prisma.supplier.delete(args)),
    count: (args?: any) => withRetry(() => prisma.supplier.count(args)),
    upsert: (args: any) => withRetry(() => prisma.supplier.upsert(args)),
    updateMany: (args: any) => withRetry(() => prisma.supplier.updateMany(args)),
    deleteMany: (args: any) => withRetry(() => prisma.supplier.deleteMany(args)),
  },

  // Raw query for keep-alive
  $queryRaw: (query: any) => withRetry(() => prisma.$queryRaw(query)),
  $executeRaw: (query: any) => withRetry(() => prisma.$executeRaw(query)),
  
  // Connection management
  $connect: () => prisma.$connect(),
  $disconnect: () => prisma.$disconnect(),
};

export default db;