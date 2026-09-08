import type { Prisma } from "@prisma/client";
import prisma from "./prisma";

export async function logActivity(
  action: string,
  entityType: string,
  entityId: string,
  userId?: string,
  details?: Record<string, unknown>
) {
  await prisma.activityLog.create({
    data: {
      action,
      entityType,
      entityId,
      userId,
      details: details as Prisma.InputJsonValue | undefined,
    },
  });
}
