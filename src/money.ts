// All money is represented as integer cents (BIGINT in Postgres). Never use floats.

export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

export function splitFee(grossCents: number, platformCutPct: number) {
  // platformCutPct is CREATOR_TIERS[tier].cut — the PLATFORM's take rate
  // (e.g. 0.22 = platform keeps 22%, creator keeps the remaining 78%).
  // Higher creator tiers have a SMALLER platformCutPct, i.e. a better rev share.
  const platformFeeCents = Math.round(grossCents * platformCutPct);
  const creatorShareCents = grossCents - platformFeeCents;
  return { platformFeeCents, creatorShareCents };
}

export function applyFxRate(usdCents: number, rate: number): number {
  // rate = local currency units per 1 USD, expressed with up to 8 decimal places.
  return Math.round(usdCents * rate);
}

export function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/** In-memory FX fallback used if fx_rates table has no fresh snapshot yet. */
export const FALLBACK_FX_RATES: Record<string, number> = {
  "USD_KES": 129.5,
  "USD_SOS": 570.0,
};
