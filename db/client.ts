// The app's own Postgres connection: pooled, because a serverless function opens and drops
// connections constantly and would exhaust a direct one. Every ingest and derive script uses
// db/migration-client.ts instead, which is the direct connection migrations also need. Kept
// separate from drizzle.config.ts, which drizzle-kit reads on its own and never imports.
//
// **The connection is opened on first use, not at import.** It used to be resolved at module
// scope, and that is a worse failure than it looks: Next imports a module to collect a route's
// configuration during the build, and any import of this file in an environment without the
// variable threw there rather than at the query. The build failed with "Failed to collect
// configuration", and at runtime the same throw reached the request as an opaque error digest
// with nothing readable attached. Neither can be caught by a caller, because neither happens
// inside a call.
//
// Resolving lazily means a missing or wrong connection string fails where it can be handled
// and reported: inside the query, in a try/catch, in /api/health, with a driver error code.
//
// Deliberately not `server-only`: this module is imported by the db test suite, which runs
// under plain Node rather than a Next.js server component, and `server-only` throws
// unconditionally outside that context.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveAppDatabaseUrl } from "./env";
import * as schema from "./schema";

type Client = ReturnType<typeof postgres>;
type Database = ReturnType<typeof drizzle<typeof schema>>;

let cachedClient: Client | null = null;
let cachedDb: Database | null = null;

function connect(): { client: Client; db: Database } {
  if (!cachedClient || !cachedDb) {
    // `prepare: false` is not optional on a pooled Supabase connection. Its pooler runs in
    // transaction mode: a connection is handed to one transaction and then to somebody else,
    // so a prepared statement created on it is gone by the next query, and postgres.js
    // prepares by default. Set unconditionally rather than guessed from the URL's port, since
    // it costs a little speed on a pooled connection, nothing on a direct one, and a wrong
    // guess is a total outage.
    cachedClient = postgres(resolveAppDatabaseUrl(), { prepare: false });
    cachedDb = drizzle(cachedClient, { schema });
  }
  return { client: cachedClient, db: cachedDb };
}

/** Open the connection now and hand it back. For callers that want the failure immediately. */
export function getDb(): Database {
  return connect().db;
}

/** The postgres.js handle, for the few places that need the driver rather than drizzle. */
export function getClient(): Client {
  return connect().client;
}

/**
 * The drizzle database, connecting on first property access.
 *
 * A Proxy rather than a plain export because every call site already says `db.select(...)`,
 * and the point of this change is that none of them has to move for the connection to become
 * lazy. Touching a property is the first thing any caller does, and that is where the
 * connection is opened.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(connect().db as object, property, receiver);
  },
  has(_target, property) {
    return Reflect.has(connect().db as object, property);
  },
});

/** The driver handle, same laziness. Kept for compatibility with existing imports. */
export const client: Client = new Proxy({} as Client, {
  get(_target, property, receiver) {
    return Reflect.get(connect().client as object, property, receiver);
  },
  apply(_target, thisArg, args: unknown[]) {
    return Reflect.apply(connect().client as never, thisArg, args);
  },
}) as Client;
