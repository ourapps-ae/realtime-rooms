# Local workflow

Local only: no commits, pushes, remote changes or publishing without George's say-so. Licence wording remains deferred.

Commands from the package root: `npm ci --ignore-scripts --no-audit --no-fund` (needs network; skip if `node_modules/` exists), `npm test`, `node tests/request-body.mjs`, `npm run types`, `npm run typecheck`, `node --test tests/migration.test.ts tests/interfaces.test.ts` (needs only node).
Review a fetched archive: `python3 -m aepm review <digest> --store STORE --policy POLICY --trusted --allow-network`. Always `-B`.
