# Local workflow

Local only: no commits, pushes, remote changes or publishing without George's say-so. Licence wording remains deferred.
Do not edit `mcinpoker/`, `skull/`, `aepm/`, `OurPoker/proof/` or `OurPoker/recipe/`.

Commands from the package root: `npm ci --ignore-scripts --no-audit --no-fund` (needs network; skip if `node_modules/` exists), `npm test`, `node tests/request-body.mjs`, `npm run types`, `npm run typecheck`, `node --test tests/migration.test.ts tests/interfaces.test.ts` (needs only node).
Validate: `PYTHONPATH=/Users/george/Projects/com/my/aepm /Users/george/.pyenv/versions/3.12.8/bin/python3.12 -B /Users/george/Projects/com/my/tools/check_component.py components/realtime-rooms`. The checker does not run suite `prepare` steps, so the three npm suites fail in it unless `node_modules/` is present in the checker's package copy. Always `-B`.
