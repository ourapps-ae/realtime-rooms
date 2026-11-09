export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; status: 400 | 409 | 422 } };
export type Deps = { now: () => number; rng: () => number; newId: () => string };
export type Actor = { id: string; role: "player" | "spectator" | "display" };
export type Presence = { type: "request-seen"; id: string } | { type: "live-members"; ids: string[] } | { type: "away"; id: string } | { type: "last-connection-close"; id: string; deliberate: boolean };
export type RoomInfo = { id: string; status: string; playerCount: number; names: string[] };
export interface GameAdapter<S, A, V, O> {
  create(now: number): S;
  restore(saved: unknown, schema: number): S;
  options(input: unknown): Result<O>;
  members(state: S): { id: string; name: string }[];
  summary(state: S): Omit<RoomInfo, "id">;
  clearSpectators(state: S): boolean;
  join(state: S, id: string, name: string, rejoining: boolean, deps: Deps): Result<{ state: S; role: "player" | "spectator" }>;
  parseAction(input: unknown): Result<{ action: A; requiresVersion: boolean; leaves: boolean }>;
  apply(state: S, actor: Actor, action: A, deps: Deps): Result<S>;
  presence(state: S, event: Presence, deps: Deps): { state: S; changed: boolean };
  connection(state: S, actor: Actor, message: unknown, options: O, deps: Deps): Result<{ state: S; options: O; changed: boolean }>;
  advance(state: S, deps: Deps): { state: S; changed: boolean };
  nextWake(state: S): number | null;
  view(state: S, actor: Actor | null, options: O, context: { version: number; roomId: string }): V;
}
export interface RoomNamespace {
  getByName(name: string): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}
export interface RoomEnv {
  CODE_VERSION?: string;
  POLL_MS?: string;
  DIRECTORY: RoomNamespace;
  ROOM: RoomNamespace;
  WEB_ORIGINS?: string;
}
export type Settings = { applicationId: string; allowedOrigins: string[]; roomPrefix: string };
// The guest-identity component's records, declared here so this component imports nothing from it.
export type IdentityRecord = { id: string; name: string; token: string; previousToken: string | null; issuedAt: number; lastSeenAt: number };
export type IdentityBook = { records: { [id: string]: IdentityRecord } };
export type IdentityDeps = { now: () => number; newId: () => string; newToken: () => string };
export type IdentityResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
// What a room calls on the guest-identity component (`createIdentityApi(settings)` satisfies it). Each room keeps its own book.
export interface IdentityService {
  // Takes the name (a new guest, or the same one returning); the token before it stops working.
  claim(book: IdentityBook, name: unknown, deps: IdentityDeps): IdentityResult<{ book: IdentityBook; id: string; token: string; rejoined: boolean }>;
  // Who holds this token; `rotatedToken` is the token the device must keep from now on when one is due or was just replaced.
  authenticate(book: IdentityBook, token: string, deps: IdentityDeps): { book: IdentityBook; id: string; name: string; rotatedToken: string | null } | null;
  // Forgets the guest: the name is free and the token stops working.
  release(book: IdentityBook, id: string): IdentityBook;
}
export type Services = { identity: IdentityService; videoGrant?: (request: Request) => Promise<Response> };
