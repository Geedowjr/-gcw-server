import { describe, it, expect } from "vitest";
import { CREATOR_TIERS, calculateLevelFromCoins, resolveTierForGift } from "../tiers.js";
import { splitFee, usdToCents, centsToUsd } from "../money.js";

describe("calculateLevelFromCoins", () => {
  it("returns level1 below 350,000", () => {
    expect(calculateLevelFromCoins(0)).toBe("level1");
    expect(calculateLevelFromCoins(349_999)).toBe("level1");
  });

  it("returns level2 at/above 350,000 and below 500,000", () => {
    expect(calculateLevelFromCoins(350_000)).toBe("level2");
    expect(calculateLevelFromCoins(499_999)).toBe("level2");
  });

  it("returns level3 at/above 500,000 and below 850,000", () => {
    expect(calculateLevelFromCoins(500_000)).toBe("level3");
    expect(calculateLevelFromCoins(849_999)).toBe("level3");
  });

  it("returns level4 at/above 850,000", () => {
    expect(calculateLevelFromCoins(850_000)).toBe("level4");
    expect(calculateLevelFromCoins(10_000_000)).toBe("level4");
  });
});

describe("resolveTierForGift — mid-gift tier crossing", () => {
  it("uses lifetime_coins + gift.coins (post-gift total) to pick the tier", () => {
    // Creator has 349,900 lifetime coins; a 200-coin gift pushes them to 350,100 -> level2
    const { tierKey, totalAfter } = resolveTierForGift(349_900, 200);
    expect(totalAfter).toBe(350_100);
    expect(tierKey).toBe("level2");
    expect(CREATOR_TIERS[tierKey].cut).toBe(0.18);
  });

  it("stays in the same tier when the gift does not cross a threshold", () => {
    const { tierKey } = resolveTierForGift(100_000, 500);
    expect(tierKey).toBe("level1");
  });
});

describe("money helpers", () => {
  it("usdToCents / centsToUsd round-trip", () => {
    expect(usdToCents(150)).toBe(15000);
    expect(centsToUsd(15000)).toBe(150);
  });

  it("splitFee never loses cents (platform + creator == gross)", () => {
    const gross = 15000; // $150.00 gift
    const { platformFeeCents, creatorShareCents } = splitFee(gross, CREATOR_TIERS.level1.cut);
    expect(platformFeeCents + creatorShareCents).toBe(gross);
    expect(platformFeeCents).toBe(3300); // 22% of 15000
    expect(creatorShareCents).toBe(11700);
  });

  it("splitFee is exact for all four tiers on a representative gross amount", () => {
    const gross = 100_00;
    for (const tier of Object.values(CREATOR_TIERS)) {
      const { platformFeeCents, creatorShareCents } = splitFee(gross, tier.cut);
      expect(platformFeeCents + creatorShareCents).toBe(gross);
    }
  });
});
