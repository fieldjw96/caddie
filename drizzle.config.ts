import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./db/env";

// Migrating through a transaction-mode pooler fails: DDL and prepared statements do not
// survive it. This must stay the direct, non-pooling connection db/migration-client.ts also
// uses, never the app's pooled one in db/client.ts. Do not "simplify" the two back into one.
//
// No fallback URL: a migration that silently ran against the wrong database would be worse
// than one that refused to start. See db/env.ts for the resolution order.
const url = resolveMigrationDatabaseUrl();

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
