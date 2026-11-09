# Realtime rooms

## Purpose and facilities

Identity and token rotation come from the guest-identity component through a required `guest-identity` port; the directory object belongs to room-directory. `rooms` supplies persistent game-independent rooms, private views, display sessions, live connections, long polling and notifications to a directory object.

## User inputs

The caller supplies applicationId, allowedOrigins and roomPrefix through Settings. No collected secrets or source substitution is required.

## Artefacts and dependencies

Source entrypoints are implementation/server/index.ts, implementation/web/live.ts, implementation/apple/Sources/LiveConnection.swift and implementation/android/src/main/java/ae/rooms/RoomTransport.kt. Installed paths replace implementation/ with components/realtime-rooms/. Test tools are locked in package-lock.json. Android consumes the application's locked OkHttp and coroutine dependencies. Licence selection is deferred.

## Provided interfaces

`session` version 1.0.0 provides createRoomClass and createWorker (listed in interfaces/room-session.json). The directory object is not provided here: rooms post their summaries to the `DIRECTORY` binding and the worker forwards `/rooms` and `/rooms/ws` to it; the application binds `DIRECTORY` to the class from room-directory (`createDirectoryClass`). See interfaces/wire.md and the exported types. State is persisted before notifications. Clock-only advancement preserves the visible version. String request bodies are checked after reading, with a limit of 4096 code units. A player's token is replaced when the same name joins again, and rotates when guest-identity says it is due (`x-rotated-token` response header, `{type:"token"}` live message). Display tokens are the room's own, never rotate and cannot act. Live pings occur every 25 seconds; the server drops silent players after 75 seconds. Displays are capped at six and idle display tokens expire after one hour when another display joins.

## Required interfaces

`game` version 1.0.0 is GameAdapter<S,A,V,O>, defined in implementation/server/adapter.ts and listed method by method in interfaces/required/game-adapter.json. The directory calls rooms make are listed in interfaces/required/room-directory.json. `guest-identity` version 1.0.0 is `Services.identity`, an injected object with `claim`, `authenticate` and `release` (IdentityService in implementation/server/adapter.ts, listed in interfaces/required/guest-identity.json); guest-identity's `createIdentityApi(settings)` satisfies it, and this component imports nothing from it. It is required, so `createRoomClass` throws without it. Each room keeps its own identity book in its storage record. `claim` runs on join (a refused name is answered 422 with the code it gives, for example `badName`), `authenticate` on every request and live message, `release` when a player or spectator leaves. The game adapter still owns all game state, rules, lifecycle, options and redaction. Serializable state must include any game memory. restore must migrate or reject incompatible persisted state. Cloudflare supplies storage, alarms and live connection hibernation. Optional Services.videoGrant receives a request with roomId, roomPrefix, playerId, name, now and canPublish; it returns the application's grant response.

## Integration

See INSTRUCTIONS.md for selection and configuration and suitability.json for the free and paid Cloudflare profiles. fixtures/worker.ts is a complete counter application without poker imports; its `fixtures/identity.ts` is a small stand-in for guest-identity (one-hour rotation) so this package tests alone. Export a concrete subclass of the room factory, export the directory class from room-directory under the name `Directory`, then export createWorker(settings, roomIds). The fixture uses a small stand-in `Directory` for tests. Game views are produced separately for each authenticated actor. Inject addresses and decoding into client transports; callers own game models and rendering.

## Visual definition and connected examples

visual/definition.json exposes game and guest-identity inputs and the session output. visual/examples/counter.json connects the counter adapter, an identity provider and the browser consumer; generated images and descriptions are retained in visual/output/.

## Infrastructure

Cloudflare Workers and Durable Objects are required for deployment. Local tests use the locked local runtime and loopback connections. Hosted costs are unmeasured; no account or credentials are needed for local checks.

## Verification

Run npm ci --ignore-scripts --no-audit --no-fund, npm test, npm run types and npm run typecheck. npm run types invokes Wrangler from the locked installed dependencies. tests/rooms.test.ts exercises hidden values, stale versions, display rejection, spectator rejection, token replacement, a name the identity component refuses, leaving, token rotation by header and by live message, the missing-identity error, multiple connections, deliberate/lost close, restart, clock-only advancement, alarms and publication to the directory binding (against the stand-in). tests/interfaces.test.ts checks that the interface files match adapter.ts and index.ts, including the required guest-identity port. Swift source is independently type-checked with swiftc; Android and native runtime checks belong to the assembled application.

Authoring check: with the installer on PYTHONPATH, run python3 -m unittest discover -s tests -p test_packaged_review.py -v. It executes actual archive review and guardian verification with temporary test identities and authorized dependency preparation, including rejection of the undeclared-tool declaration.

Run node --test tests/migration.test.ts (needs only node) for the room-state export, import and verification functions in examples/migration.ts. Run node tests/request-body.mjs for the local-worker upload regression. Rejected display and invalid-token action bodies are drained without retaining their contents before returning 422 or 401. The test streams both uploads through the actual local worker and checks for request-stream errors.

## Scenarios and presentation

A counter member sees only their private value. A watcher and shared display see no private value. A replaced token is rejected; restart retains members and counters; the final connection close distinguishes deliberate departure from loss. Example service routes and message envelopes are documented in interfaces/wire.md.

## Updates and removal

Patch updates replace source files after application verification. Persisted state belongs to the deployment; removing source does not delete hosted objects. migration.json describes the stored data (Room storage key room, schema in interfaces/room-state.schema.json), the portable ndjson export and import, verification by counts and sha256 per record, limits and retention. The Directory store (key rooms) is described by room-directory/migration.json. Storage layout number is 1. Each room stores its guest-identity book as `identity`. Applications pass `services.identity` (guest-identity's `createIdentityApi(settings)`) to `createRoomClass`.
