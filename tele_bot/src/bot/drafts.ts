import prisma from "@/lib/prisma";
import type { DraftData } from "@/lib/calculations";
import type { Prisma } from "@prisma/client";

function toJson(data: DraftData): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}

export async function getDraft(telegramId: bigint) {
  return prisma.formDraft.findUnique({
    where: { telegramId },
  });
}

export async function upsertDraft(
  telegramId: bigint,
  step: string,
  data: DraftData,
  userId?: string,
  flowType: "mr" | "purchase" | "supplier" = "mr"
) {
  const json = toJson({ ...data, flowType });
  return prisma.formDraft.upsert({
    where: { telegramId },
    create: { telegramId, step, data: json, userId, flowType },
    update: { step, data: json, userId, flowType },
  });
}

export async function updateDraftData(
  telegramId: bigint,
  partial: Partial<DraftData>
) {
  const draft = await getDraft(telegramId);
  const current = (draft?.data as DraftData) ?? {};
  const merged = { ...current, ...partial };
  
  if (draft) {
    return prisma.formDraft.update({
      where: { telegramId },
      data: { data: toJson(merged) }
    });
  }
  return upsertDraft(telegramId, "idle", merged);
}

export async function setDraftStep(telegramId: bigint, step: string) {
  const draft = await getDraft(telegramId);
  
  if (draft) {
    return prisma.formDraft.update({
      where: { telegramId },
      data: { step }
    });
  }
  return upsertDraft(telegramId, step, {});
}

export async function clearOldDrafts(olderThanDays: number = 7) {
  const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return prisma.formDraft.deleteMany({
    where: { updatedAt: { lt: cutoffDate } }
  });
}

export async function clearDraft(telegramId: bigint) {
  await prisma.formDraft.deleteMany({
    where: { telegramId },
  });
}

export function getDraftData(draft: { data: unknown } | null): DraftData {
  return (draft?.data as DraftData) ?? {};
}
