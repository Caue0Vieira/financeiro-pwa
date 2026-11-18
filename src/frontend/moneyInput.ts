import { parseBrazilianAmount } from "../imports/parsers.ts";

export function centsFromDigits(value: string): number | undefined {
  const digits = value.replace(/\D/g, "");
  const cents = Number(digits);
  return digits && Number.isSafeInteger(cents) ? cents : undefined;
}

export function centsFromPaste(value: string): number | undefined {
  const text = value.trim();
  if (!text || text.includes("-")) return undefined;
  try {
    return parseBrazilianAmount(text);
  } catch {
    try {
      return /^\d+\.\d{1,2}$/.test(text) ? parseBrazilianAmount(text.replace(".", ",")) : undefined;
    } catch {
      return undefined;
    }
  }
}
