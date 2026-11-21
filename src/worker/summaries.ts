import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSummary, fallbackText, summaryPrompt, usableComment, type SummaryInputs } from "../summary.ts";
import { aiModel, type Ai } from "./categorize.ts";

/**
 * Monthly summary (day 1, cron; or on demand from the app): totals from the database, numbers from
 * buildSummary and a short comment from Workers AI. One query and one write for every user, plus
 * one AI call per user (a Cloudflare binding, outside the external subrequest limit).
 */

type Inputs = Omit<SummaryInputs, "month"> & { user_id: string };

/** Asks the AI for the comment; the app's own text when it fails or brings numbers. */
export async function summaryComment(ai: Ai | undefined, numbers: ReturnType<typeof buildSummary>, month: string) {
  if (!ai) return fallbackText(numbers, month);
  try {
    const result = await ai.run(aiModel, { messages: summaryPrompt(numbers, month), max_tokens: 220, temperature: 0.4 });
    return usableComment((result as { response?: unknown })?.response) ?? fallbackText(numbers, month);
  } catch (error) {
    console.error("summary comment", error);
    return fallbackText(numbers, month);
  }
}

/** Creates the summaries of `month` (YYYY-MM) still missing; returns the ones created. */
export async function generateSummaries(db: SupabaseClient, ai: Ai | undefined, month: string, userId?: string) {
  const { data, error } = await db.rpc("monthly_summary_inputs", { p_month: `${month}-01`, p_users: userId ? [userId] : null });
  if (error) throw new Error(error.message);
  const rows = await Promise.all((data as Inputs[] ?? []).map(async (input) => {
    const numbers = buildSummary({ ...input, month });
    return { user_id: input.user_id, month: `${month}-01`, numbers, text: await summaryComment(ai, numbers, month) };
  }));
  if (rows.length) {
    const saved = await db.from("monthly_summaries").upsert(rows, { ignoreDuplicates: true });
    if (saved.error) throw new Error(saved.error.message);
  }
  return rows;
}
