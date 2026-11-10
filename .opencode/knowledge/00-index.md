# realtime-rooms ownership

Repository: https://github.com/ourapps-ae/realtime-rooms.git (local only; nothing pushed). Package `ourapps-ae/realtime-rooms`, provides `session` (`ae/room-session`), requires `game` (`ae/game-adapter`).
Standard: `/Users/george/Projects/com/my/.opencode/knowledge/component-standard.md`. Generic transport belongs here; poker rules and the adapter belong in the OurPoker recipe.

Code: `implementation/server/{adapter,index,worker}.ts`, `implementation/web/live.ts`, `implementation/apple/Sources/LiveConnection.swift`, `implementation/android/src/main/java/ae/rooms/RoomTransport.kt`. `tests/rooms.test.ts` uses an independent counter game; `fixtures/worker.ts` supplies its worker.
Artefacts: `component.json`, `CONTRACT.md`, `INSTRUCTIONS.md`, `SOURCE.md` (table with frozen line ranges), `suitability.json` (free and paid Cloudflare profiles, limits cited from the Workers and Durable Objects limits pages), `migration.json`, `interfaces/room-state.schema.json`, `examples/migration.ts`, `tests/migration.test.ts`, `tools.lock.json`, `interfaces/room-session.json` (OpenRPC 1.3.2), `interfaces/room-session-http.json` (OpenAPI 3.1.1), `interfaces/room-session-live.json` (AsyncAPI 3.1.0).
Data is kept in Durable Object storage (Room key `room`; the Directory key `rooms` belongs to room-directory). The ndjson functions are real and tested; the storage read and write routes are the application's to write.
`tsconfig.json` allows `.ts` imports and includes `examples` so the migration test type-checks.
`package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `fixtures/` and `scripts/` are listed in `component.json` but sit outside the standard checker's allowlist; the checker reports them as layout errors. `node_modules/` and `.wrangler/` are local, ignored, and make the checker report `node_modules present`.
`scripts/package-metadata.py` regenerates `component.json` and the visual example. Render the diagram with the aepm generator after changing the version in `visual/definition.json`.
