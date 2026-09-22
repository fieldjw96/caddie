import { defineConfig } from "vitest/config";

// The database tests, apart from the unit suite: they need a migrated Postgres at
// DATABASE_URL, which `npm run test` must not. CI runs them in the `migrate` job.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.db.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    fileParallelism: false,
  },
});
