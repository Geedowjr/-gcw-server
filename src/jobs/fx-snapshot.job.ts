import type { Job } from "bullmq";
import { db } from "../db/client.js";
import { fxRates } from "../db/schema.js";
import { logger } from "../logger.js";
import { FALLBACK_FX_RATES } from "../money.js";

/**
 * Hourly: refresh USD->KES and USD->SOS snapshots into fx_rates.
 * In production, swap the fetch() below for a real FX provider (e.g. exchangerate.host,
 * Open Exchange Rates). Falls back to static rates if the fetch fails so cashouts
 * never fully block on FX provider downtime.
 */
export async function processFxSnapshotJob(_job: Job) {
  const pairs = ["USD_KES", "USD_SOS"];
  const results: Record<string, number> = {};

  for (const pair of pairs) {
    let rate = FALLBACK_FX_RATES[pair];
    try {
      const [, quote] = pair.split("_");
      const resp = await fetch(`https://open.er-api.com/v6/latest/USD`).then((r) => r.json());
      if (resp?.rates?.[quote]) rate = resp.rates[quote];
    } catch (err) {
      logger.warn({ err, pair }, "fx-snapshot: fetch failed, using fallback rate");
    }
    results[pair] = rate;
    await db.insert(fxRates).values({ pair, rate: String(rate) });
  }

  logger.info({ results }, "fx-snapshot job complete");
  return results;
}
