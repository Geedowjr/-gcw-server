import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
