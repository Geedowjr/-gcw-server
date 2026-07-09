import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import { pool } from "../db/client.js";
import { redis } from "../redis.js";

export const app = buildApp();

export function uniqueEmail() {
  return `test_${randomUUID()}@example.com`;
}

export async function closeAll() {
  await pool.end();
  await redis.quit();
}
