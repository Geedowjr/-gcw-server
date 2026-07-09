import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { env } from "../src/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  const migrationsDir = path.join(__dirname, "..", "src", "db", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  for (const file of files) {
    const { rows } = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
    if (rows.length > 0) {
      console.log(`skip (already applied): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`applying: ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  console.log("migrations complete");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
