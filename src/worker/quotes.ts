import type { SupabaseClient } from "@supabase/supabase-js";
import { saoPauloDate } from "./mapping.ts";

/**
 * Quotes for B3 assets (stocks, FIIs, ETFs, BDRs). brapi.dev is the main source (free token,
 * one ticker per request on the free plan); Yahoo Finance's unofficial chart endpoint is the
 * backup when brapi fails or the token is missing. Prices arrive about 15 minutes late.
 */
export type Quote = { priceCents: number; at: string };
export type QuoteSource = (ticker: string) => Promise<Quote>;
type Fetch = typeof fetch;

export class QuoteError extends Error {}

const tickerPattern = /^[A-Z]{4}[0-9]{1,2}$/;

/** "petr4", " PETR4.SA " → "PETR4"; anything else → null. */
export function normalizeTicker(value: unknown) {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase().replace(/\.SA$/, "");
  return tickerPattern.test(ticker) ? ticker : null;
}

export const toCents = (price: number) => Math.round(price * 100);
export const valueCents = (quantity: number, priceCents: number) => Math.round(quantity * priceCents);

function validQuote(price: unknown, at: Date): Quote {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) throw new QuoteError("Cotação inválida.");
  return { priceCents: toCents(price), at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString() };
}

export function brapiSource(token: string, fetcher: Fetch = fetch): QuoteSource {
  return async (ticker) => {
    const response = await fetcher(`https://brapi.dev/api/quote/${ticker}?token=${encodeURIComponent(token)}`);
    const body = (await response.json().catch(() => ({}))) as {
      results?: { regularMarketPrice?: number; regularMarketTime?: string }[];
      message?: string;
    };
    if (!response.ok) throw new QuoteError(`brapi ${response.status}: ${body.message ?? ticker}`);
    const result = body.results?.[0];
    return validQuote(result?.regularMarketPrice, new Date(result?.regularMarketTime ?? Date.now()));
  };
}

export function yahooSource(fetcher: Fetch = fetch): QuoteSource {
  return async (ticker) => {
    const response = await fetcher(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=1d&interval=1d`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
    });
    if (!response.ok) throw new QuoteError(`yahoo ${response.status}: ${ticker}`);
    const body = (await response.json().catch(() => ({}))) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[] };
    };
    const meta = body.chart?.result?.[0]?.meta;
    return validQuote(meta?.regularMarketPrice, new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000));
  };
}

/** Tries each source in order and returns the first quote. */
export function firstOf(...sources: QuoteSource[]): QuoteSource {
  return async (ticker) => {
    let failure: unknown = new QuoteError("Nenhuma fonte de cotação.");
    for (const source of sources) {
      try {
        return await source(ticker);
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  };
}

export const quoteSourceFor = (brapiToken?: string) =>
  brapiToken ? firstOf(brapiSource(brapiToken), yahooSource()) : yahooSource();

type Holding = { id: string; ticker: string; quantity: number | string; quoted_at: string | null };

/**
 * Prices every holding with a ticker (or only `userId`'s), asking each ticker once. Holdings quoted
 * less than `minAgeMs` ago are skipped, so the app's button cannot burn the brapi quota. A failing
 * ticker does not stop the others; it is reported in `failed`.
 */
export async function refreshQuotes(
  db: SupabaseClient,
  quote: QuoteSource,
  options: { userId?: string; minAgeMs?: number; now?: number } = {},
) {
  const now = options.now ?? Date.now();
  let query = db.from("investments").select("id, ticker, quantity, quoted_at").not("ticker", "is", null);
  if (options.userId) query = query.eq("user_id", options.userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const minAge = options.minAgeMs ?? 0;
  const stale = (data as Holding[]).filter(({ quoted_at }) => !quoted_at || now - Date.parse(quoted_at) >= minAge);
  const byTicker = new Map<string, Holding[]>();
  for (const holding of stale) byTicker.set(holding.ticker, [...(byTicker.get(holding.ticker) ?? []), holding]);

  let updated = 0;
  const failed: string[] = [];
  for (const [ticker, holdings] of byTicker) {
    let price: Quote;
    try {
      price = await quote(ticker);
    } catch (failure) {
      console.error("quote", ticker, failure);
      failed.push(ticker);
      continue;
    }
    for (const holding of holdings) {
      const { error: saveError } = await db.from("investments").update({
        price_cents: price.priceCents,
        value_cents: valueCents(Number(holding.quantity), price.priceCents),
        as_of: saoPauloDate(price.at),
        quoted_at: new Date(now).toISOString(),
      }).eq("id", holding.id);
      if (saveError) throw new Error(saveError.message);
      updated += 1;
    }
  }
  return { updated, failed };
}
