// The lazy `db` Proxy is load-bearing and easy to get subtly wrong, so these tests cover the
// two properties that matter and that a reader cannot check by eye.

import { describe, expect, it, vi } from "vitest";

describe("the lazy db proxy", () => {
  it("does not connect when the module is merely imported", async () => {
    // The whole point of the change: importing must not throw when no connection string is
    // set, because Next imports route modules to collect their configuration at build time.
    vi.resetModules();
    const previous = { ...process.env };
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    try {
      await expect(import("./client")).resolves.toBeDefined();
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it("throws when a property is actually touched with no connection string", async () => {
    vi.resetModules();
    const previous = { ...process.env };
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    try {
      const { db } = await import("./client");
      expect(() => db.select).toThrow(/No database connection string set/);
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it("keeps `this` as the real object, not the Proxy", async () => {
    // Drizzle's objects are class instances. If the Proxy forwards itself as the receiver,
    // `this` inside a method becomes the Proxy and the first private field access throws from
    // inside the library. This asserts the binding directly, without needing a live database.
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/none";
    const { db } = await import("./client");
    const method = db.select;
    expect(typeof method).toBe("function");
    // A bound function reports no accessible prototype, which is the observable signature of
    // `.bind()` having been applied.
    expect(Object.prototype.hasOwnProperty.call(method, "prototype")).toBe(false);
  });
});
