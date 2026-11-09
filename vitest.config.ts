import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { projects: [
  { test: { name: "web", include: ["tests/live.test.ts"] } },
  { plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { POLL_MS: "20" } } })], test: { name: "rooms", include: ["tests/rooms.test.ts"] } },
] } });
