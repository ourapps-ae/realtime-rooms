import { createHash } from "node:crypto";

export type IdentityBook = { records: Record<string, { id: string; name: string; token: string; previousToken: string | null; issuedAt: number; lastSeenAt: number }> };
export type RoomRecord = { schema: number; version: number; game: unknown; identity: IdentityBook; spectators: Record<string, string>; displays: Record<string, number>; roomId?: string; listed?: string };
export type Snapshot = { rooms: Record<string, RoomRecord> };
export type Check = { counts: boolean; checksums: boolean; sample: string[] };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

// The application reads the rooms (for example from a protected route in a subclass of Room that returns
// ctx.storage.get("room")); this function turns that snapshot into portable ndjson. The room list belongs to room-directory.
export function exportAll(snapshot: Snapshot): string {
  const ids = Object.keys(snapshot.rooms).sort();
  const lines: unknown[] = [{ type: "header", format: "ae/room-state", version: "1.0.0", rooms: ids.length }];
  for (const roomId of ids) lines.push({ type: "room", roomId, record: snapshot.rooms[roomId], sha256: digest(snapshot.rooms[roomId]) });
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

// Parses and verifies ndjson from exportAll. Throws on a bad header, count, checksum or unsupported storage layout number.
// The application then writes each record back with ctx.storage.put("room", record).
export function importAll(text: string, supportedSchema = 1): Snapshot {
  const lines = text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  const header = lines[0];
  if (!header || header.type !== "header" || header.format !== "ae/room-state" || header.version !== "1.0.0") throw new Error("not an ae/room-state 1.0.0 export");
  const rooms: Record<string, RoomRecord> = {};
  for (const line of lines.slice(1)) {
    if (line.type === "room") {
      if (digest(line.record) !== line.sha256) throw new Error("checksum mismatch for room " + line.roomId);
      if (line.record.schema !== supportedSchema) throw new Error("unsupported storage layout " + line.record.schema + " for room " + line.roomId);
      if (line.roomId in rooms) throw new Error("duplicate room " + line.roomId);
      rooms[line.roomId] = line.record;
    } else throw new Error("unknown line type " + line.type);
  }
  if (Object.keys(rooms).length !== header.rooms) throw new Error("room count mismatch");
  return { rooms };
}

// Compares a snapshot read back from the new store with the exported one: counts, per-record checksums and a sample of room ids.
export function verify(expected: Snapshot, actual: Snapshot, sample = 20): Check {
  const ids = Object.keys(expected.rooms).sort();
  const counts = ids.length === Object.keys(actual.rooms).length;
  const checksums = ids.every((id) => actual.rooms[id] !== undefined && digest(actual.rooms[id]) === digest(expected.rooms[id]));
  return { counts, checksums, sample: ids.slice(0, sample) };
}
