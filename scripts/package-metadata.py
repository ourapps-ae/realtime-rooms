"""Produce explicit package metadata and a connected example from owned source paths."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
definition = json.loads((root / "visual/definition.json").read_text())
design = {
    "schemaVersion": 1, "id": "counter", "title": "Counter room example", "status": "example", "view": "component", "focus": "rooms",
    "definitions": [definition,
        {"id": "counter", "name": "Counter adapter", "kind": "application", "status": "example", "revision": "0.1.0", "ports": [{"id": "game", "name": "Counter rules", "direction": "output", "kind": "interface", "type": "ae/game-adapter", "version": "1.0.0"}], "settings": []},
        {"id": "identity", "name": "Guest identity", "kind": "application", "status": "example", "revision": "0.1.0", "ports": [{"id": "guest-identity", "name": "Guest identity", "direction": "output", "kind": "interface", "type": "ae/guest-identity", "version": "1.0.0"}], "settings": []},
        {"id": "browser", "name": "Browser", "kind": "application", "status": "example", "revision": "0.1.0", "ports": [{"id": "room", "name": "Room session", "direction": "input", "kind": "interface", "type": "ae/room-session", "version": "1.0.0", "required": True, "cardinality": "one"}], "settings": []}],
    "instances": [{"id": i, "name": n, "definition": d, "configuration": {}} for i, n, d in [("counter", "Counter", "counter"), ("identity", "Identity", "identity"), ("rooms", "Rooms", definition["id"]), ("browser", "Browser", "browser")]],
    "connections": [{"source": {"instance": "counter", "port": "game"}, "target": {"instance": "rooms", "port": "game"}}, {"source": {"instance": "identity", "port": "guest-identity"}, "target": {"instance": "rooms", "port": "guest-identity"}}, {"source": {"instance": "rooms", "port": "session"}, "target": {"instance": "browser", "port": "room"}}],
}
(root / "visual/examples").mkdir(exist_ok=True)
(root / "visual/examples/counter.json").write_text(json.dumps(design, indent=2) + "\n")
files = ["CONTRACT.md", "INSTRUCTIONS.md", "LICENCE", "SOURCE.md", "suitability.json", "migration.json", "tools.lock.json", "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "wrangler.jsonc"]
for directory in ["implementation", "interfaces", "fixtures", "examples", "tests", "visual", "scripts"]:
    files.extend(p.relative_to(root).as_posix() for p in (root / directory).rglob("*") if p.is_file())
for output in ["visual/output/counter.svg", "visual/output/counter.png"]:
    if output not in files:
        files.append(output)
prepare = [{"argv": ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], "cwd": ".", "network": True}]
suite = {"root": "package", "cwd": ".", "prepare": prepare, "tools": {"node": "26.5.0", "npm": "11.17.0"}, "fixtures": ["fixtures/worker.ts"], "locks": ["package-lock.json"], "network": False, "timeoutSeconds": 120, "expectedExit": 0, "scope": "required-local", "requirements": []}
manifest = {
    "format": 1, "kind": "component",
    "identity": {"name": "ourapps-ae/realtime-rooms", "version": "0.5.0", "sourceRevision": "19905b75dbea89fbfd424d67fe26c81aaed0e018", "sourceTreeDigest": "0" * 64, "licenceStatus": "deferred"},
    "facilities": [{"id": "rooms", "description": "Persistent private game rooms and native transports"}],
    "documents": {"contract": "CONTRACT.md", "interfaces": ["interfaces/room-session.json", "interfaces/required/game-adapter.json", "interfaces/required/room-directory.json", "interfaces/required/guest-identity.json", "implementation/server/adapter.ts", "interfaces/wire.md", "interfaces/room-state.schema.json", "suitability.json", "migration.json"], "examples": ["fixtures/worker.ts", "examples/migration.ts"], "licenceNotice": "LICENCE"},
    "collect": [], "files": [{"path": p, "executable": False} for p in sorted(set(files))],
    "artefacts": [{"source": p, "destination": "components/realtime-rooms/" + p.removeprefix("implementation/"), "template": False, "executable": False} for p in sorted(files) if p.startswith("implementation/")],
    "dependencies": [],
    "provides": [{"id": "session", "type": "ae/room-session", "version": "1.0.0", "path": "interfaces/room-session.json"}],
    "requires": [{"id": "game", "type": "ae/game-adapter", "version": "1.0.0", "path": "interfaces/required/game-adapter.json"}, {"id": "guest-identity", "type": "ae/guest-identity", "version": "1.0.0", "path": "interfaces/required/guest-identity.json"}],
    "visual": {"definition": "visual/definition.json", "examples": ["visual/examples/counter.json"], "outputs": ["visual/output/counter.svg", "visual/output/counter.png"], "descriptions": ["visual/output/counter.md"]},
    "capabilities": {"hosts": ["localhost", "127.0.0.1"], "secrets": [], "writes": ["components/realtime-rooms"]},
    "infrastructure": {"accounts": ["Cloudflare for deployment"], "costStatus": "unmeasured", "deployedReason": "Local runtime only; deployment requires an authorized Cloudflare account."},
    "verification": [{**suite, "id": "rooms", "argv": ["npm", "test"]}, {**suite, "id": "request-bodies", "argv": ["node", "tests/request-body.mjs"]}, {**suite, "id": "types", "argv": ["npm", "run", "typecheck"], "prepare": prepare + [{"argv": ["npm", "run", "types"], "cwd": ".", "network": False}]}, {**suite, "id": "migration", "argv": ["node", "--test", "tests/migration.test.ts", "tests/interfaces.test.ts"], "prepare": [], "tools": {"node": "26.5.0"}, "fixtures": ["examples/migration.ts", "interfaces/room-session.json"], "locks": ["tools.lock.json"]}],
    "upgrade": {"policy": "patch", "migration": "files-only"},
}
(root / "component.json").write_text(json.dumps(manifest, indent=2) + "\n")
