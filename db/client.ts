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

// `prepare: false` is not optional on a pooled Supabase connection, and leaving it out is why
// production returned 500 on every request while the database was populated and healthy.
// Supabase's pooler runs in transaction mode: a connection is handed to one transaction and
// then to somebody else, so a prepared statement created on it is gone by the next query.
// postgres.js prepares by default, so every query failed. Supabase's own documentation
// requires this flag for pooled connections.
//
// It costs a little speed, and costs nothing at all on a session-mode or direct connection,
// so it is set unconditionally rather than guessed at from the URL's port: the app always
// takes the pooled string, and a wrong guess here is a total outage rather than a slow page.
// db/migration-client.ts deliberately does not set it: it takes the direct connection, where
// prepared statements work and migrations want them.
export const client = postgres(url, { prepare: false });
export const db = drizzle(client, { schema });
