// The app's own Postgres connection: pooled, because a serverless function opens and drops
// connections constantly and would exhaust a direct one. Every ingest and derive script uses
// db/migration-client.ts instead, which is the direct connection migrations also need. Kept
// separate from drizzle.config.ts, which drizzle-kit reads on its own and never imports.
//
// Deliberately not `server-only`: this module is imported by the db test suite, which runs
// under plain Node rather than a Next.js server component, and `server-only` throws
// unconditionally outside that context.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveAppDatabaseUrl } from "./env";
import * as schema from "./schema";

// No fallback URL: a script that silently ran against the wrong database would be worse than
// one that refused to start. See db/env.ts for the resolution order and why it exists.
const url = resolveAppDatabaseUrl();

export const client = postgres(url);
export const db = drizzle(client, { schema });
