import type { User, UserRole } from "@prisma/client";
import prisma from "./prisma";
import { resolveRoleFromTelegramId } from "./config";

// ============================================================
// DATABASE RETRY HELPER WITH EXPONENTIAL BACKOFF
// ============================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a connection error
      const errorMessage = error.message?.toLowerCase() || '';
      const isConnectionError = 
        errorMessage.includes("can't reach database server") ||
        errorMessage.includes("terminating connection") ||
        errorMessage.includes("connection terminated") ||
        errorMessage.includes("connection refused") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("database is waking up") ||
        errorMessage.includes("e57p01") ||
        errorMessage.includes("connect etimedout") ||
        errorMessage.includes("pooler") ||
        errorMessage.includes("connection pool");
      
      if (isConnectionError && attempt < maxRetries) {
        console.log(`⏳ DB retry ${attempt}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 10000); // Exponential backoff, max 10s
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('Database operation failed after retries');
}

// ============================================================
// AUTH FUNCTIONS WITH RETRY
// ============================================================

export async function findOrCreateUser(
  telegramId: bigint,
  username?: string,
  fullName?: string
) {
  return withRetry(async () => {
    const existing = await prisma.user.findUnique({
      where: { telegramId },
    });

    const envRole = resolveRoleFromTelegramId(telegramId);

    if (existing) {
      const updates: Partial<User> = {};
      if (username && username !== existing.telegramUsername) {
        updates.telegramUsername = username;
      }
      if (existing.role !== envRole && envRole !== "REQUESTER") {
        updates.role = envRole;
      }
      if (Object.keys(updates).length > 0) {
        return prisma.user.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      return existing;
    }

    const name = fullName?.trim() || username || `User ${telegramId}`;

    return prisma.user.create({
      data: {
        telegramId,
        telegramUsername: username,
        fullName: name,
        role: envRole,
      },
    });
  });
}

export async function requireUser(telegramId: bigint, username?: string, fullName?: string) {
  return findOrCreateUser(telegramId, username, fullName);
}

export function hasRole(user: User, ...roles: UserRole[]): boolean {
  return roles.includes(user.role);
}

export async function requireRole(telegramId: bigint, ...roles: UserRole[]) {
  const user = await requireUser(telegramId);
  if (!hasRole(user, ...roles)) {
    throw new Error("FORBIDDEN");
  }
  return user;
}

export async function requireAdministrator(telegramId: bigint) {
  return requireRole(telegramId, "ADMINISTRATOR");
}

export async function requirePurchaser(telegramId: bigint) {
  return requireRole(telegramId, "PURCHASER", "ADMINISTRATOR");
}

export async function requireRequester(telegramId: bigint) {
  return requireRole(telegramId, "REQUESTER");
}

export async function setUserRole(userId: string, role: UserRole) {
  return withRetry(async () => {
    return prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  });
}

export async function setUserFullName(userId: string, fullName: string) {
  return withRetry(async () => {
    return prisma.user.update({
      where: { id: userId },
      data: { fullName: fullName.trim() },
    });
  });
}

export async function listUsers(limit = 50) {
  return withRetry(async () => {
    return prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  });
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "REQUESTER":
      return "Requester";
    case "ADMINISTRATOR":
      return "Administrator";
    case "PURCHASER":
      return "Purchaser";
    case "VIEWER":
      return "Viewer";
    default:
      return role;
  }
}