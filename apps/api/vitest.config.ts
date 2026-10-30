import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * The real wrangler migration files, parsed by the plugin so statement
 * splitting matches production behaviour (`db.exec()` on raw file contents
 * fails: D1 splits SQL on newlines).
 */
const migrations = await readD1Migrations(new URL("../../migrations", import.meta.url).pathname);

export default defineConfig({
  define: {
    __MIGRATIONS__: JSON.stringify(migrations),
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    name: "api",
    setupFiles: ["./src/test/setup.ts"],
  },
});
