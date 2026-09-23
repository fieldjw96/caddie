// What production is actually doing, when the page will only say 500.
//
// Next masks a server component's exception in production behind an error digest, which is
// the correct default and was also why a completely dead site took most of a day to diagnose:
// the database was populated, the migrations applied, the right commit deployed, and every
// check green, all at once. Nothing could say why.
//
// This route answers that, and is careful about how much it says. It reports the *names* of
// the connection variables that are set and never a value, the host and port it reached and
// never the credentials, and a driver error's code and message with anything credential-shaped
// removed. That is enough to tell a missing variable from a refused connection from an empty
// table, which is the whole question, and not enough to hand anyone a way in.

import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { resolveAppDatabaseUrl } from "@/db/env";

// A health check that reads a cached answer is not a health check.
export const dynamic = "force-dynamic";

/** The connection variables the app resolves, reported as set or not. Never their values. */
const CONNECTION_VARS = ["DATABASE_URL", "POSTGRES_URL"] as const;

/**
 * Strip anything shaped like a credential out of a driver message before it leaves the server.
 * postgres.js usually does not echo the URL, but "usually" is not a property to rely on when
 * the output is public.
 */
function redact(text: string): string {
  return text
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:/@\s]+:[^@\s]+@/g, "$1***:***@")
    .replace(/(password=)[^\s&]+/gi, "$1***");
}

/** Host and port only, so a reader can tell pooled from direct without seeing the credentials. */
function endpoint(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "unparseable";
  }
}

export async function GET() {
  const variables = Object.fromEntries(
    CONNECTION_VARS.map((name) => [name, process.env[name] !== undefined]),
  );

  let url: string;
  try {
    url = resolveAppDatabaseUrl();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "resolve",
        detail: "No connection string is set in this environment.",
        variables,
        error: redact(error instanceof Error ? error.message : String(error)),
      },
      { status: 503 },
    );
  }

  try {
    const [row] = await db.execute<{ tournaments: number }>(
      sql`select count(*)::int as tournaments from tournaments`,
    );
    return NextResponse.json({
      ok: true,
      stage: "query",
      variables,
      endpoint: endpoint(url),
      tournaments: row?.tournaments ?? 0,
    });
  } catch (error) {
    // The interesting case. A refused connection, a TLS failure, a pooler rejecting a
    // prepared statement and a missing table all land here and all look identical from
    // outside, so the driver's own code is the thing worth surfacing.
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : null;
    return NextResponse.json(
      {
        ok: false,
        stage: "query",
        variables,
        endpoint: endpoint(url),
        code,
        error: redact(error instanceof Error ? error.message : String(error)),
      },
      { status: 503 },
    );
  }
}
