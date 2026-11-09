import { DurableObject } from "cloudflare:workers";
import { createFixtureIdentity } from "./identity";
import { createRoomClass, createWorker, type GameAdapter, type Result, type RoomEnv, type RoomInfo } from "../implementation/server/index";
type State = { members: { id: string; name: string; secret: string }[]; value: number; live: string[]; closes: boolean[]; clock: number; wake: number | null };
type Action = "increment" | "leave" | "alarm";
type View = { version: number; value: number; secret: string | null; live: string[]; closes: boolean[]; clock: number };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(): Result<T> => ({ ok: false, error: { code: "notAllowed", status: 422, message: "Not allowed." } });
export const adapter: GameAdapter<State, Action, View, Record<string, never>> = {
  create: now => ({ members: [], value: 0, live: [], closes: [], clock: now, wake: null }),
  restore(saved, schema) { if (schema !== 1 || !Array.isArray((saved as State)?.members)) throw new Error("Unsupported state"); return saved as State; },
  options: () => ok({}),
  members: s => s.members,
  summary: s => ({ status: "active", playerCount: s.members.length, names: s.members.map(m => m.name) }),
  clearSpectators: () => false,
  join(s, id, name, rejoining) {
    if (!name) return fail();
    if (name.startsWith("watch")) return ok({ state: s, role: "spectator" });
    return ok({ state: rejoining ? s : { ...s, members: [...s.members, { id, name, secret: `private-${id}` }] }, role: "player" });
  },
  parseAction(input) { const type = (input as { type?: string }).type; return type === "increment" || type === "leave" || type === "alarm" ? ok({ action: type, requiresVersion: type !== "leave", leaves: type === "leave" }) : fail(); },
  apply(s, actor, action, deps) {
    if (action === "leave") return ok({ ...s, members: s.members.filter(m => m.id !== actor.id) });
    if (actor.role !== "player") return fail();
    return ok(action === "alarm" ? { ...s, wake: deps.now() + 150 } : { ...s, value: s.value + 1 });
  },
  presence(s, event) {
    if (event.type === "live-members") return { state: { ...s, live: event.ids }, changed: false };
    if (event.type === "last-connection-close") return { state: { ...s, closes: [...s.closes, event.deliberate] }, changed: true };
    return { state: s, changed: false };
  },
  connection: (state, actor, message, options) => ok({ state, options, changed: false }),
  advance(s, deps) { const due = s.wake !== null && s.wake <= deps.now(); return { state: { ...s, clock: deps.now(), value: s.value + Number(due), wake: due ? null : s.wake }, changed: due }; },
  nextWake: s => s.wake,
  view: (s, actor, options, context) => ({ version: context.version, value: s.value, secret: s.members.find(m => m.id === actor?.id)?.secret ?? null, live: s.live, closes: s.closes, clock: s.clock }),
};
const settings = { applicationId: "counter", allowedOrigins: [], roomPrefix: "counter-" };
export class Room extends createRoomClass(adapter, { identity: createFixtureIdentity(3600) }, settings) {}
// Test stand-in for the room-directory component: keeps what rooms post and returns it on GET.
// An application exports room-directory's createDirectoryClass(DurableObject, options) under the same name instead.
export class Directory extends DurableObject<RoomEnv> {
  async fetch(request: Request): Promise<Response> {
    const rooms = (await this.ctx.storage.get<Record<string, RoomInfo>>("rooms")) ?? {};
    if (request.method === "POST") { const info = (await request.json()) as RoomInfo; rooms[info.id] = info; await this.ctx.storage.put("rooms", rooms); return new Response(null, { status: 204 }); }
    return Response.json(Object.values(rooms));
  }
}
export default createWorker(settings, ["one"]);
