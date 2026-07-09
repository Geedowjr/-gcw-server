import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { users, creatorProfiles, wallets, giftCatalog } from "../src/db/schema.js";
import { hashPassword } from "../src/auth/password.js";

const GIFTS: Array<{ id: string; name: string; emoji: string; coins: number; usdCents: number; premium?: boolean }> = [
  { id: "vibe_shades", name: "Vibe Shades", emoji: "😎", coins: 100, usdCents: 100 },
  { id: "aero_flare", name: "Aero Flare", emoji: "✨", coins: 250, usdCents: 250 },
  { id: "hir", name: "Hir", emoji: "🌸", coins: 500, usdCents: 500 },
  { id: "glow_drop", name: "Glow Drop", emoji: "💧", coins: 750, usdCents: 750 },
  { id: "holo_disc", name: "Holo Disc", emoji: "💿", coins: 1000, usdCents: 1000 },
  { id: "kalluun", name: "Kalluun", emoji: "🐟", coins: 1500, usdCents: 1500 },
  { id: "dhaanto", name: "Dhaanto", emoji: "💃", coins: 2500, usdCents: 2500 },
  { id: "dufaan", name: "Dufaan", emoji: "🌪️", coins: 5000, usdCents: 5000, premium: true },
  { id: "star", name: "Star", emoji: "⭐", coins: 15000, usdCents: 15000, premium: true },
  { id: "gashaan", name: "Gashaan", emoji: "🛡️", coins: 25000, usdCents: 25000, premium: true },
  { id: "libaax", name: "Libaax", emoji: "🦁", coins: 50000, usdCents: 50000, premium: true },
  { id: "guul", name: "Guul", emoji: "🏆", coins: 100000, usdCents: 100000, premium: true },
];

async function upsertUser(params: {
  email: string;
  username: string;
  password: string;
  displayName: string;
  role: string;
}) {
  const existing = await db.select().from(users).where(eq(users.email, params.email));
  if (existing.length) return existing[0];

  const passwordHash = await hashPassword(params.password);
  const [user] = await db
    .insert(users)
    .values({
      email: params.email,
      username: params.username,
      passwordHash,
      displayName: params.displayName,
      role: params.role,
      emailVerifiedAt: new Date(),
    })
    .returning();
  return user;
}

async function main() {
  console.log("Seeding gift catalog...");
  for (const gift of GIFTS) {
    await db
      .insert(giftCatalog)
      .values({ ...gift, premium: gift.premium ?? false, active: true })
      .onConflictDoUpdate({
        target: giftCatalog.id,
        set: { name: gift.name, emoji: gift.emoji, coins: gift.coins, usdCents: gift.usdCents },
      });
  }

  console.log("Seeding admin...");
  await upsertUser({
    email: "admin@gcw.app",
    username: "admin",
    password: "Admin!234",
    displayName: "Admin",
    role: "admin",
  });

  console.log("Seeding creator habaryare_live (L2, KYC approved, 2FA disabled)...");
  const creator = await upsertUser({
    email: "habaryare_live@gcw.app",
    username: "habaryare_live",
    password: "Password!234",
    displayName: "Habaryare Live",
    role: "creator",
  });

  await db
    .insert(creatorProfiles)
    .values({
      userId: creator.id,
      lifetimeCoins: 412000, // crosses level2 threshold (350,000) per CREATOR_TIERS
      lifetimeEarningsCents: 82_400_00, // illustrative historical earnings
      payoutBalanceCents: 15_000_00,
      pendingBalanceCents: 3_000_00,
      currentLevel: 2,
      kycStatus: "approved",
      payoutCountry: "SO",
    })
    .onConflictDoUpdate({
      target: creatorProfiles.userId,
      set: {
        lifetimeCoins: 412000,
        currentLevel: 2,
        kycStatus: "approved",
        payoutCountry: "SO",
      },
    });

  console.log("Seeding one QA fixture creator per tier (L1/L2/L3/L4)...");
  const tierFixtures = [
    { level: 1, coins: 10_000, username: "qa_level1", email: "qa_level1@gcw.app" },
    { level: 2, coins: 400_000, username: "qa_level2", email: "qa_level2@gcw.app" },
    { level: 3, coins: 600_000, username: "qa_level3", email: "qa_level3@gcw.app" },
    { level: 4, coins: 1_000_000, username: "qa_level4", email: "qa_level4@gcw.app" },
  ];
  for (const fixture of tierFixtures) {
    const fixtureUser = await upsertUser({
      email: fixture.email,
      username: fixture.username,
      password: "Password!234",
      displayName: `QA Level ${fixture.level}`,
      role: "creator",
    });
    await db
      .insert(creatorProfiles)
      .values({
        userId: fixtureUser.id,
        lifetimeCoins: fixture.coins,
        currentLevel: fixture.level,
        kycStatus: "approved",
      })
      .onConflictDoUpdate({
        target: creatorProfiles.userId,
        set: { lifetimeCoins: fixture.coins, currentLevel: fixture.level, kycStatus: "approved" },
      });
  }

  console.log("Seeding test viewer wallet with 50,000 coins...");
  const existingWallets = await db.select().from(wallets).where(eq(wallets.coinBalance, 50000));
  if (!existingWallets.length) {
    const [wallet] = await db.insert(wallets).values({ coinBalance: 50000 }).returning();
    console.log(`  wallet_token=${wallet.walletToken}`);
  }

  console.log("Seed complete.");
  console.log("  Admin login:   admin@gcw.app / Admin!234");
  console.log("  Creator login: habaryare_live@gcw.app / Password!234 (username: habaryare_live)");
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
