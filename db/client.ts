// The one Postgres connection every ingest and every server read goes through. No fallback
// URL: a script that silently ran against the wrong database would be worse than one that
// refused to start. See drizzle.config.ts, which makes the same call for migrations.
//
// Deliberately not `server-only`: this module is imported by scripts/ingest-schedule.ts and
// by the db test suite, both of which run under plain Node rather than a Next.js server
// component, and `server-only` throws unconditionally outside that context.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

export const client = postgres(url);

export const db = drizzle(client, { schema });
