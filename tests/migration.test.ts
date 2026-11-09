import assert from "node:assert/strict";
import test from "node:test";
import { exportAll, importAll, verify, type Snapshot } from "../examples/migration.ts";

const snapshot: Snapshot = {
  rooms: {
    "table-b": { schema: 1, version: 7, game: { value: 3, members: [{ id: "a1", name: "Ada" }] }, identity: { records: { a1: { id: "a1", name: "Ada", token: "t1", previousToken: "t0", issuedAt: 1700000000000, lastSeenAt: 1700000001000 } } }, spectators: {}, displays: { d1: 1700000000000 }, roomId: "table-b", listed: "[[\"Ada\"],\"active\"]" },
    "table-a": { schema: 1, version: 0, game: { value: 0, members: [] }, identity: { records: {} }, spectators: {}, displays: {} },
  },
};

test("export is portable ndjson with a header and sorted room lines", () => {
  const lines = exportAll(snapshot).trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.type), ["header", "room", "room"]);
  assert.equal(lines[0].rooms, 2);
  assert.deepEqual(lines.slice(1, 3).map((line) => line.roomId), ["table-a", "table-b"]);
});

test("round trip preserves every record and verification passes", () => {
  const imported = importAll(exportAll(snapshot));
  assert.deepEqual(imported, snapshot);
  assert.deepEqual(verify(snapshot, imported), { counts: true, checksums: true, sample: ["table-a", "table-b"] });
});

test("key order does not change checksums", () => {
  const reordered: Snapshot = JSON.parse(JSON.stringify({ rooms: Object.fromEntries(Object.entries(snapshot.rooms).reverse()) }));
  assert.equal(exportAll(reordered), exportAll(snapshot));
});

test("tampered, miscounted, duplicate or unsupported input is rejected", () => {
  const text = exportAll(snapshot);
  assert.throws(() => importAll(text.replace('"value":3', '"value":4')), /checksum mismatch for room table-b/);
  assert.throws(() => importAll(text.replace('"rooms":2', '"rooms":3')), /room count mismatch/);
  assert.throws(() => importAll(text, 2), /unsupported storage layout 1/);
  assert.throws(() => importAll("{}\n"), /not an ae\/room-state/);
});

test("verification detects a missing or changed record", () => {
  const changed: Snapshot = { rooms: { ...snapshot.rooms, "table-b": { ...snapshot.rooms["table-b"], version: 8 } } };
  assert.equal(verify(snapshot, changed).checksums, false);
  const missing: Snapshot = { rooms: { "table-a": snapshot.rooms["table-a"] } };
  assert.equal(verify(snapshot, missing).counts, false);
});
