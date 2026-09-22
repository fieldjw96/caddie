// The Postgres connection scripts write through. Not imported by app code, which does not
// exist yet for this table; kept separate from drizzle.config.ts, which drizzle-kit reads
// on its own and never imports.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// No fallback URL: a script that silently ran against the wrong database would be worse than
// one that refused to start.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

export const client = postgres(url);
export const db = drizzle(client, { schema });
