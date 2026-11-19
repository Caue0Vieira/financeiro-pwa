import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Automatic categorisation in the Worker: rules learned from the user's corrections
 * (table category_rules, filled by the learn_category trigger) and Workers AI for what is left.
 */

/** Same normalisation as public.description_key() in the category_rules migration. */
export function descriptionKey(description: string) {
  return description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .slice(0, 200)
    .trim();
}

export async function loadRules(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from("category_rules").select("description_key, category").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((rule) => [rule.description_key as string, rule.category as string]));
}

/** Minimal shape of the Workers AI binding (env.AI). */
export type Ai = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

export const aiModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Expense categories the app already uses (src/worker/mapping.ts and src/frontend/merchants.ts). */
export const expenseCategories = [
  "Mercado",
  "Alimentação",
  "Transporte",
  "Saúde",
  "Moradia",
  "Assinaturas",
  "Compras",
  "Lazer",
  "Educação",
  "Investimentos",
  "Tarifas e impostos",
  "Transferências",
];
const unsure = "Sem categoria";
const batchSize = 40;

type Pending = { description: string; amount_cents: number };

export function aiRequest(items: readonly Pending[], categories: readonly string[], examples: readonly [string, string][]) {
  const lines = items.map((item, i) => `${i}. ${item.description} (R$ ${(Math.abs(item.amount_cents) / 100).toFixed(2)})`);
  const learned = examples.length
    ? `\nExemplos de como este usuário classifica (descrição normalizada → categoria):\n${examples.map(([key, category]) => `- ${key} → ${category}`).join("\n")}\n`
    : "";
  return {
    messages: [
      {
        role: "system",
        content:
          "Você classifica despesas de extratos bancários e faturas de cartão do Brasil. " +
          `Use exatamente uma destas categorias: ${[...categories, unsure].join(", ")}. ` +
          `Se a descrição não deixar claro o tipo de gasto (por exemplo, um Pix para uma pessoa), responda "${unsure}". ` +
          "Não invente categorias. Responda só com JSON.",
      },
      {
        role: "user",
        content: `${learned}\nClassifique cada lançamento pelo número:\n${lines.join("\n")}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { i: { type: "integer" }, category: { type: "string" } },
              required: ["i", "category"],
            },
          },
        },
        required: ["items"],
      },
    },
    temperature: 0,
    max_tokens: 2048,
  };
}

/** One category per item (null when the model skipped it), keeping only allowed names. */
export function parseAiAnswer(result: unknown, count: number, categories: readonly string[]) {
  const answers: (string | null)[] = Array(count).fill(null);
  let response = (result as { response?: unknown } | null)?.response;
  if (typeof response === "string") {
    try {
      response = JSON.parse(response.slice(response.indexOf("{"), response.lastIndexOf("}") + 1));
    } catch {
      return answers;
    }
  }
  const items = (response as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return answers;
  const byName = new Map([...categories, unsure].map((name) => [descriptionKey(name), name]));
  for (const item of items) {
    const i = Number(item?.i);
    const name = typeof item?.category === "string" ? byName.get(descriptionKey(item.category)) : undefined;
    if (Number.isInteger(i) && i >= 0 && i < count && name) answers[i] = name;
  }
  return answers;
}

/**
 * Classifies the user's newest uncategorised expenses with Workers AI and records the answer
 * (category_source = 'ai', also when unsure, so a row is asked only once). Returns how many
 * rows got a category.
 */
export async function categorizePending(db: SupabaseClient, ai: Ai, userId: string) {
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  const pending = await db.from("transactions")
    .select("id, description, amount_cents, kind")
    .eq("user_id", userId).eq("category", unsure).is("category_source", null)
    .in("kind", ["expense", "uncategorized"]).neq("source", "settlement")
    .order("occurred_on", { ascending: false }).limit(batchSize);
  fail(pending.error);
  const rows = (pending.data ?? []) as (Pending & { id: string; kind: string })[];
  if (!rows.length) return 0;

  const [used, rules] = await Promise.all([
    db.from("transactions").select("category").eq("user_id", userId).eq("kind", "expense").neq("category", unsure).limit(2000),
    loadRules(db, userId),
  ]);
  fail(used.error);
  const own = (used.data ?? []).map(({ category }) => (category as string).trim()).filter(Boolean);
  const categories = [...new Set([...expenseCategories, ...own])].filter((name) => !["Estorno", "Cartão", unsure].includes(name));
  const examples = [...rules].slice(0, 40);

  const answers = parseAiAnswer(await ai.run(aiModel, aiRequest(rows, categories, examples)), rows.length, categories);

  const groups = new Map<string, string[]>();
  rows.forEach((row, i) => {
    const category = answers[i] ?? unsure;
    const key = `${category}\u0000${category === "Investimentos" && row.kind === "expense" ? "investment" : row.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
  });
  let categorized = 0;
  for (const [key, ids] of groups) {
    const [category, kind] = key.split("\u0000");
    const { error } = await db.from("transactions")
      .update({ category, kind, category_source: "ai" })
      .eq("user_id", userId).in("id", ids).eq("category", unsure).is("category_source", null);
    fail(error);
    if (category !== unsure) categorized += ids.length;
  }
  return categorized;
}

/** Cron: every user with uncategorised expenses, one batch each. */
export async function categorizeEveryone(db: SupabaseClient, ai: Ai) {
  const { data, error } = await db.from("transactions").select("user_id")
    .eq("category", unsure).is("category_source", null).in("kind", ["expense", "uncategorized"]).limit(1000);
  if (error) throw new Error(error.message);
  for (const userId of new Set((data ?? []).map(({ user_id }) => user_id as string))) {
    await categorizePending(db, ai, userId).catch((failure) => console.error("ai categorize", userId, failure));
  }
}
