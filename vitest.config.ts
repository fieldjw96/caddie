import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // Database tests need a migrated Postgres and run under vitest.db.config.ts instead.
    exclude: ["node_modules/**", ".next/**", "**/*.db.test.ts"],
  },
});
