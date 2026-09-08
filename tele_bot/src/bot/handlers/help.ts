import type { Context } from "grammy";
import { requireUser } from "@/lib/auth";
import { formatHelp } from "../formatters";
import { mainMenuKeyboard } from "../keyboards";

export async function handleHelp(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await requireUser(BigInt(from.id));

  await ctx.reply(formatHelp(user.role), {
    parse_mode: "Markdown",
    reply_markup: mainMenuKeyboard(user),
  });
}
