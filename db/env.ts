// Which Postgres connection string a caller should use, and why there are two. Kept free of
// any drizzle-orm or postgres import so drizzle.config.ts, which drizzle-kit loads on its own
// and never imports db/client.ts, can use this without pulling in the rest of the app.
//
// Vercel's Supabase integration sets its own variable names rather than DATABASE_URL, and it
// exposes two connection strings that are not interchangeable: POSTGRES_URL is pooled through
// PgBouncer in transaction mode, and POSTGRES_URL_NON_POOLING is direct. DDL and prepared
// statements do not survive transaction-mode pooling, so migrations and ingest need the direct
// one; the app, a serverless function that opens and drops connections constantly, needs the
// pooled one or it would exhaust a direct pool.

/**
 * The app's connection: pooled. DATABASE_URL first so a hand-set value always wins, then
 * POSTGRES_URL, the pooled string Vercel's Supabase integration provides.
 */
export function resolveAppDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "No database connection string set. Looked for DATABASE_URL, POSTGRES_URL. See .env.example.",
    );
  }
  return url;
}

/**
 * The migration and ingest connection: direct, non-pooling. POSTGRES_URL_NON_POOLING first,
 * the direct string Vercel's Supabase integration provides, then DATABASE_URL, then
 * POSTGRES_URL as a last resort so a run against a plain (non-Supabase) Postgres still works.
 */
export function resolveMigrationDatabaseUrl(): string {
  const url =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "No database connection string set. Looked for POSTGRES_URL_NON_POOLING, DATABASE_URL, " +
        "POSTGRES_URL. See .env.example.",
    );
  }
  return url;
}
