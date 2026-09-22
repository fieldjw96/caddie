// The migration and ingest connection: direct, non-pooling. Every script under scripts/ and
// drizzle.config.ts (which resolves its own url with db/env.ts directly, since drizzle-kit
// never imports this module) use this one, never db/client.ts's pooled connection: DDL and
// prepared statements do not survive a transaction-mode pooler.
//
// max: 1 and a silenced onnotice because this runs one script at a time and exits, unlike the
// app's long-lived pooled connection in db/client.ts.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveMigrationDatabaseUrl } from "./env";
import * as schema from "./schema";

const url = resolveMigrationDatabaseUrl();

export const client = postgres(url, { max: 1, onnotice: () => {} });
export const db = drizzle(client, { schema });
