# Realtime rooms instructions

Package `ourapps-ae/realtime-rooms` version `0.6.1`. It provides `session` (type `ae/room-session`, version 1.0.0) and requires `game` (type `ae/game-adapter`, version 1.0.0) and `guest-identity` (type `ae/guest-identity`, version 1.0.0).

## For the agent

- Select this component when the application has private multiplayer rooms with live updates (the recipe's `players` answer is more than one person).
- Connect the required `game` port to the component that implements `GameAdapter` (in the OurPoker recipe, `turn-engine`). Connect the provided `session` port to `room-directory`, `server-host` and the client transports. The directory object comes from `room-directory`, not from this component. Connect the required `guest-identity` port to the `guest-identity` component: it owns names, tokens and token rotation, and the server code passes its `createIdentityApi(settings)` as `services.identity`.
- Settings the recipe supplies: `applicationId`, `allowedOrigins` (exact origins of the web and desktop clients) and `roomPrefix` (including its separator, also used for video rooms).
- Job: server-host on Cloudflare. Use the `free` profile for small private use and `paid` above 100,000 requests a day (see `suitability.json`). Ask for a Cloudflare account by reference only; never ask for a token value. The `own-hardware` profile applies when `server-host` runs the rooms on Node.
- Data is kept: room state lives in Durable Object storage. See `migration.json` before moving it.

## For the developer

- Install paths: `components/realtime-rooms/server/{index,worker,adapter}.ts`, `components/realtime-rooms/web/live.ts`, `components/realtime-rooms/apple/Sources/LiveConnection.swift`, `components/realtime-rooms/android/src/main/java/ae/rooms/RoomTransport.kt`.
- Implement `GameAdapter<S,A,V,O>` (`server/adapter.ts`): it owns all state, rules, options and per-viewer redaction. Serialisable state must include any game memory. `restore(saved, schema)` rejects saved state it cannot read.
- Wire the worker as `fixtures/worker.ts` does: export `Room extends createRoomClass(adapter, { identity: createIdentityApi(identitySettings) }, settings)` (`createIdentityApi` from `components/guest-identity/server/identity.ts`; `services.identity` is required) and `Directory extends createDirectoryClass(DurableObject, { roomIds, maxConnections })` (the latter imported from `components/room-directory/server/directory.ts`), then `export default createWorker(settings, roomIds)`. `fixtures/worker.ts` uses small stand-ins for `Directory` and for the identity service so this package tests alone.
- Cloudflare: bind `ROOM` and `DIRECTORY` Durable Objects and declare `new_sqlite_classes` in a migration (see `wrangler.jsonc`). Set `CODE_VERSION` on each deploy so running objects restart onto the new code. Set `WEB_ORIGINS` for extra allowed origins.
- Clients send the token they hold for a room as the bearer token on the join request too: a name in use is given back only with its token (otherwise `409 nameTaken`).
- Clients keep the token the join answer gives and replace it when a response carries `x-rotated-token` or a live connection sends `{type:"token"}` (rotation is off unless guest-identity's `tokenRotationSeconds` is above 0).
- Optional `Services.videoGrant` returns the application's video grant response (see `video-calls`).
- Client transports take injected addresses and decoding: `Live` (web), `LiveConnection<Message>` (Apple), `RoomTransport` (Android). Routes are in `interfaces/room-session-http.json` (OpenAPI 3.1.1) and live messages in `interfaces/room-session-live.json` (AsyncAPI 3.1.0); the library calls are in `interfaces/room-session.json` (OpenRPC 1.3.2).
- Moving data: see `examples/migration.ts` (ndjson export and import with checksums) and `interfaces/room-state.schema.json`.

## How to check

From the component directory (needs `npm ci --ignore-scripts --no-audit --no-fund` once):

- `npm test` (counter game on the local Workers runtime)
- `node tests/request-body.mjs`
- `npm run types`, then `npm run typecheck`
- `node --test tests/migration.test.ts tests/interfaces.test.ts` (needs only node)
- `python3 -m aepm review <digest> --store STORE --policy POLICY --trusted --allow-network` checks an archive fetched with `python3 -m aepm fetch ourapps-ae/realtime-rooms@VERSION --store STORE --from https://ourapps.app` and runs its suites.

Against a deployed worker: join a room, take an action, close the connection and reconnect; the player token should still work and the private value should still show.
