// The resolution order db/env.ts promises: which variable each export prefers, and that both
// still refuse to start, naming every variable they looked for, when none is set.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppDatabaseUrl, resolveMigrationDatabaseUrl } from "./env";

const VARS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"] as const;
const original: Record<(typeof VARS)[number], string | undefined> = {
  DATABASE_URL: undefined,
  POSTGRES_URL: undefined,
  POSTGRES_URL_NON_POOLING: undefined,
};

beforeEach(() => {
  for (const name of VARS) {
    original[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of VARS) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("resolveAppDatabaseUrl", () => {
  it("uses DATABASE_URL when only it is set", () => {
    process.env.DATABASE_URL = "postgres://app-database-url";
    expect(resolveAppDatabaseUrl()).toBe("postgres://app-database-url");
  });

  it("uses POSTGRES_URL when only it is set", () => {
    process.env.POSTGRES_URL = "postgres://app-postgres-url";
    expect(resolveAppDatabaseUrl()).toBe("postgres://app-postgres-url");
  });

  it("prefers DATABASE_URL over POSTGRES_URL when both are set", () => {
    process.env.DATABASE_URL = "postgres://app-database-url";
    process.env.POSTGRES_URL = "postgres://app-postgres-url";
    expect(resolveAppDatabaseUrl()).toBe("postgres://app-database-url");
  });

  it("throws naming every variable it looked for when none is set", () => {
    expect(() => resolveAppDatabaseUrl()).toThrow(/DATABASE_URL.*POSTGRES_URL/s);
  });
});

describe("resolveMigrationDatabaseUrl", () => {
  it("uses POSTGRES_URL_NON_POOLING when only it is set", () => {
    process.env.POSTGRES_URL_NON_POOLING = "postgres://non-pooling";
    expect(resolveMigrationDatabaseUrl()).toBe("postgres://non-pooling");
  });

  it("uses DATABASE_URL when only it is set", () => {
    process.env.DATABASE_URL = "postgres://migration-database-url";
    expect(resolveMigrationDatabaseUrl()).toBe("postgres://migration-database-url");
  });

  it("uses POSTGRES_URL when only it is set", () => {
    process.env.POSTGRES_URL = "postgres://migration-postgres-url";
    expect(resolveMigrationDatabaseUrl()).toBe("postgres://migration-postgres-url");
  });

  it("prefers POSTGRES_URL_NON_POOLING over the other two when all three are set", () => {
    process.env.POSTGRES_URL_NON_POOLING = "postgres://non-pooling";
    process.env.DATABASE_URL = "postgres://migration-database-url";
    process.env.POSTGRES_URL = "postgres://migration-postgres-url";
    expect(resolveMigrationDatabaseUrl()).toBe("postgres://non-pooling");
  });

  it("prefers DATABASE_URL over POSTGRES_URL when non-pooling is unset", () => {
    process.env.DATABASE_URL = "postgres://migration-database-url";
    process.env.POSTGRES_URL = "postgres://migration-postgres-url";
    expect(resolveMigrationDatabaseUrl()).toBe("postgres://migration-database-url");
  });

  it("throws naming every variable it looked for when none is set", () => {
    expect(() => resolveMigrationDatabaseUrl()).toThrow(
      /POSTGRES_URL_NON_POOLING.*DATABASE_URL.*POSTGRES_URL/s,
    );
  });
});

describe("a variable set but blank", () => {
  // Production served 500 for a day because DATABASE_URL existed in Vercel as an empty string:
  // `??` kept it, it shadowed a working POSTGRES_URL, and the emptiness check then threw.
  const clean = () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_URL_NON_POOLING;
  };

  it("falls through to the next variable rather than shadowing it", () => {
    const previous = { ...process.env };
    try {
      clean();
      process.env.DATABASE_URL = "";
      process.env.POSTGRES_URL = "postgres://u:p@pooled:6543/db";
      expect(resolveAppDatabaseUrl()).toBe("postgres://u:p@pooled:6543/db");
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it("treats whitespace as blank too", () => {
    const previous = { ...process.env };
    try {
      clean();
      process.env.DATABASE_URL = "   ";
      process.env.POSTGRES_URL = "postgres://u:p@pooled:6543/db";
      expect(resolveAppDatabaseUrl()).toBe("postgres://u:p@pooled:6543/db");
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it("does the same for the migration connection", () => {
    const previous = { ...process.env };
    try {
      clean();
      process.env.POSTGRES_URL_NON_POOLING = "";
      process.env.DATABASE_URL = "postgres://u:p@direct:5432/db";
      expect(resolveMigrationDatabaseUrl()).toBe("postgres://u:p@direct:5432/db");
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it("still throws when every variable is blank", () => {
    const previous = { ...process.env };
    try {
      clean();
      process.env.DATABASE_URL = "";
      process.env.POSTGRES_URL = "  ";
      expect(() => resolveAppDatabaseUrl()).toThrow(/set but blank/);
    } finally {
      Object.assign(process.env, previous);
    }
  });
});
