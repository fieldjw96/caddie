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
 * The first of these variables that holds an actual value, ignoring ones that are set but
 * blank.
 *
 * `??` alone is not enough, and this is not hypothetical: production served 500 for a day
 * because `DATABASE_URL` existed in Vercel as an empty string. `??` only falls through on
 * `null` and `undefined`, so the empty string won, shadowed a perfectly good `POSTGRES_URL`,
 * and then failed the emptiness check below. `/api/health` reported both variables set and
 * the resolver reporting neither, which is the contradiction that found it.
 *
 * A variable set to nothing means the same as one not set at all, and a platform's
 * configuration UI makes an empty value easy to create by accident.
 */
function firstNonBlank(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * The app's connection: pooled. DATABASE_URL first so a hand-set value always wins, then
 * POSTGRES_URL, the pooled string Vercel's Supabase integration provides.
 */
export function resolveAppDatabaseUrl(): string {
  const url = firstNonBlank(["DATABASE_URL", "POSTGRES_URL"]);
  if (!url) {
    throw new Error(
      "No database connection string set. Looked for DATABASE_URL, POSTGRES_URL, and ignored " +
        "any that were set but blank. See .env.example.",
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
  const url = firstNonBlank(["POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL"]);
  if (!url) {
    throw new Error(
      "No database connection string set. Looked for POSTGRES_URL_NON_POOLING, DATABASE_URL, " +
        "POSTGRES_URL, and ignored any that were set but blank. See .env.example.",
    );
  }
  return url;
}
