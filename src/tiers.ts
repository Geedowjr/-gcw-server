// Single source of truth for creator tier economics.
// The frontend and backend must never diverge from these numbers.

export const CREATOR_TIERS = {
  level1: { cut: 0.22, nextMilestone: 350000 },
  level2: { cut: 0.18, nextMilestone: 500000 },
  level3: { cut: 0.15, nextMilestone: 850000 },
  level4: { cut: 0.12, nextMilestone: null },
} as const;

export type TierKey = keyof typeof CREATOR_TIERS;

export function calculateLevelFromCoins(totalCoins: number): TierKey {
  if (totalCoins >= 850000) return "level4";
  if (totalCoins >= 500000) return "level3";
  if (totalCoins >= 350000) return "level2";
  return "level1";
}

export function levelNumberFromKey(key: TierKey): number {
  return Number(key.replace("level", ""));
}

export function tierForLevelNumber(level: number): TierKey {
  const key = `level${Math.min(Math.max(level, 1), 4)}` as TierKey;
  return key;
}

/**
 * Given a creator's lifetime coins BEFORE a gift and the coins in the incoming gift,
 * determine which tier's cut applies. Per spec: "Apply the new tier's cut the instant
 * a gift crosses the threshold — compute with lifetime_coins + gift.coins inside the
 * DB transaction." So the tier used for revenue split is based on the POST-gift total.
 */
export function resolveTierForGift(lifetimeCoinsBefore: number, giftCoins: number) {
  const totalAfter = lifetimeCoinsBefore + giftCoins;
  const tierKey = calculateLevelFromCoins(totalAfter);
  const tier = CREATOR_TIERS[tierKey];
  return { tierKey, tier, totalAfter };
}
