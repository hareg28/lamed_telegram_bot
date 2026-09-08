import type { Context } from "grammy";
import { findOrCreateUser, requireUser, roleLabel } from "@/lib/auth";
import { getCompanyName } from "@/lib/config";
import { mainMenuKeyboard } from "../keyboards";
import { clearDraft } from "../drafts";

export async function handleStart(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await clearDraft(BigInt(from.id));

  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ");
  const user = await findOrCreateUser(
    BigInt(from.id),
    from.username,
    fullName
  );

  await ctx.reply(
    `Welcome to *${getCompanyName()}*\n*Procurement & Material Request System*!\n\n` +
      `Your role: *${roleLabel(user.role)}*\n\nUse the menu below to get started.`,
    {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(user),
    }
  );
}

export async function handleCancel(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  await clearDraft(BigInt(from.id));
  const user = await requireUser(BigInt(from.id));

  await ctx.reply("❌ Operation cancelled.", {
    reply_markup: mainMenuKeyboard(user),
  });
}

export async function returnToMenu(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));
  await ctx.reply("Main menu:", {
    reply_markup: mainMenuKeyboard(user),
  });
}
