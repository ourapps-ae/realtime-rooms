import { DurableObject } from "cloudflare:workers";
import type { Actor, Deps, GameAdapter, IdentityBook, IdentityDeps, Presence, RoomEnv, Services, Settings } from "./adapter";
export type * from "./adapter";
export { createWorker } from "./worker";

export const POLL_MS = 25_000;
export const MAX_DISPLAYS = 6;
export const DISPLAY_IDLE_MS = 60 * 60_000;
export const LIVE_MS = 75_000;
type Attachment<O> = { token: string; display: boolean; options: O; at: number };
type Record_<S> = { schema: number; version: number; game: S; identity: IdentityBook; spectators: Record<string, string>; displays: Record<string, number>; roomId?: string; listed?: string };
type Waiter = { resolve: () => void; timer: ReturnType<typeof setTimeout> };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function failure(code: string, status = 400, message = "Malformed request."): Response { return json({ error: code, message }, status); }
function resultError(result: { ok: false; error: { code: string; status: number; message: string } }): Response { return failure(result.error.code, result.error.status, result.error.message); }
function bearer(request: Request): string { const h = request.headers.get("Authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; }
async function readJson(request: Request): Promise<any> {
  const text = await request.text();
  if (text.length > 4096) throw new Error("Body too large.");
  return text ? JSON.parse(text) : {};
}

export function createRoomClass<S, A, V, O>(adapter: GameAdapter<S, A, V, O>, services: Services, settings: Settings) {
  const identity = services?.identity;
  if (!identity || typeof identity.claim !== "function" || typeof identity.authenticate !== "function" || typeof identity.release !== "function") throw new TypeError("createRoomClass needs services.identity, the guest-identity component (createIdentityApi(settings))");
  return class Room extends DurableObject<RoomEnv> {
    protected services = services;
    private rec!: Record_<S>;
    private waiters = new Set<Waiter>();
    private deps: Deps = { now: () => Date.now(), rng: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32, newId: () => crypto.randomUUID().slice(0, 8) };
    constructor(ctx: DurableObjectState, env: RoomEnv) {
      super(ctx, env);
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
      ctx.blockConcurrencyWhile(async () => {
        const stored = await ctx.storage.get<Record_<S>>("room");
        if (!stored) this.rec = { schema: 1, version: 0, game: adapter.create(this.deps.now()), identity: { records: {} }, spectators: {}, displays: {} };
        else this.rec = { ...stored, game: adapter.restore(stored.game, stored.schema) };
      });
    }
    async fetch(request: Request): Promise<Response> {
      if ((request.headers.get("x-code-version") ?? "") !== (this.env.CODE_VERSION ?? "")) this.ctx.abort("new deploy");
      const id = request.headers.get("x-room-id");
      if (id && id !== this.rec.roomId) { this.rec.roomId = id; await this.save(); }
      const rotated = this.refreshToken(bearer(request));
      const response = await this.route(request);
      if (rotated !== null && response.status !== 101) response.headers.set("x-rotated-token", rotated);
      return response;
    }
    private async route(request: Request): Promise<Response> {
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/ws") return this.accept(request);
        if (request.method === "GET" && url.pathname === "/room") return json(this.info());
        if (request.method === "POST" && url.pathname === "/join") return await this.join(request);
        if (request.method === "POST" && url.pathname === "/display") return await this.displayJoin(request);
        if (request.method === "POST" && url.pathname === "/display/leave") {
          await readJson(request);
          const token = bearer(request);
          if (this.rec.displays[token] === undefined) return this.badToken();
          delete this.rec.displays[token]; await this.save(); return json({ ok: true });
        }
        if (request.method === "POST" && url.pathname === "/action") return await this.action(request);
        if (request.method === "POST" && url.pathname === "/away") {
          const actor = this.auth(bearer(request));
          if (!actor) return this.badToken();
          if (actor.role !== "display") { const changed = this.presence({ type: "away", id: actor.id }); await this.sync(changed); }
          return json({ ok: true });
        }
        if (request.method === "GET" && url.pathname === "/state") return await this.state(request, url);
        return failure("badRequest", 404, "No such route.");
      } catch (e) { return failure("badRequest", 400, e instanceof Error ? e.message : "Bad request."); }
    }
    private save() { return this.ctx.storage.put("room", this.rec); }
    private badToken() { return failure("badToken", 401, "Unknown player token."); }
    private options(input: unknown): O {
      const r = adapter.options(input);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    }
    private identityDeps(newId: () => string = this.deps.newId): IdentityDeps { return { now: this.deps.now, newId, newToken: () => crypto.randomUUID() }; }
    // Who holds this token (a guest of this room), or null.
    private who(token: string): { id: string; name: string } | null {
      const found = token ? identity.authenticate(this.rec.identity, token, this.identityDeps()) : null;
      return found ? { id: found.id, name: found.name } : null;
    }
    // The token the device must keep from now on when guest-identity has rotated it, else null. Keeps the new book.
    private refreshToken(token: string): string | null {
      if (!token || this.rec.displays[token] !== undefined) return null;
      const found = identity.authenticate(this.rec.identity, token, this.identityDeps());
      if (!found || found.rotatedToken === null) return null;
      this.rec.identity = found.book;
      this.save().catch(() => {}); // a failed write resets the object, which reloads the stored book
      return found.rotatedToken;
    }
    // A live connection holding a replaced token takes the new one and is told it.
    private adopt(ws: WebSocket, a: Attachment<O>): Attachment<O> {
      if (a.display) return a;
      const rotated = this.refreshToken(a.token);
      if (rotated === null) return a;
      const next = { ...a, token: rotated };
      ws.serializeAttachment(next);
      try { ws.send(JSON.stringify({ type: "token", token: rotated })); } catch {}
      return next;
    }
    private auth(token: string): Actor | null {
      if (this.rec.displays[token] !== undefined) return { id: token, role: "display" };
      const id = this.who(token)?.id;
      if (!id) return null;
      if (id in this.rec.spectators) return { id, role: "spectator" };
      if (adapter.members(this.rec.game).some(p => p.id === id)) return { id, role: "player" };
      return null;
    }
    protected view(actor: Actor | null, options = this.options({})): V {
      return adapter.view(this.rec.game, actor?.role === "display" ? null : actor, actor?.role === "display" ? this.options({}) : options, { version: this.rec.version, roomId: this.rec.roomId ?? "" });
    }
    private forget(id: string) { this.rec.identity = identity.release(this.rec.identity, id); }
    private async join(request: Request) {
      const body = await readJson(request);
      const name = typeof body?.name === "string" ? body.name : "";
      await this.sync();
      const member = adapter.members(this.rec.game).find(p => p.name === name);
      const spectator = Object.entries(this.rec.spectators).find(([, n]) => n === name);
      const claimed = identity.claim(this.rec.identity, name, this.identityDeps(() => member?.id ?? spectator?.[0] ?? this.deps.newId()));
      if (!claimed.ok) return failure(claimed.error.code, 422, claimed.error.message);
      const { id, token } = claimed.value;
      const r = adapter.join(this.rec.game, id, name, !!member, this.deps);
      if (!r.ok) return resultError(r);
      const role = r.value.role;
      if (role === "spectator") this.rec.spectators[id] = name;
      else delete this.rec.spectators[id];
      this.rec.identity = claimed.value.book;
      await this.commit(r.value.state);
      let video: unknown = null;
      if (this.services.videoGrant) {
        const response = await this.services.videoGrant(new Request("https://service/grant", { method: "POST", body: JSON.stringify({ roomId: this.rec.roomId ?? "", roomPrefix: settings.roomPrefix, playerId: id, name, now: this.deps.now(), canPublish: role === "player" }) }));
        video = await response.json();
      }
      return json({ token, playerId: id, spectator: role === "spectator", view: this.view({ id, role }), video });
    }
    private async displayJoin(request: Request) {
      await readJson(request); await this.sync();
      const now = this.deps.now(), displays = this.rec.displays;
      for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment() as Attachment<O> | null; if (a?.display && displays[a.token] !== undefined) displays[a.token] = now; }
      for (const [t, at] of Object.entries(displays)) if (now - at > DISPLAY_IDLE_MS) delete displays[t];
      const oldest = Object.entries(displays).sort((a, b) => a[1] - b[1]);
      while (oldest.length >= MAX_DISPLAYS) delete displays[oldest.shift()![0]];
      const token = crypto.randomUUID(); displays[token] = now; await this.save();
      return json({ token, view: this.view(null) });
    }
    private async action(request: Request) {
      const actor = this.auth(bearer(request));
      if (!actor || actor.role === "display") {
        await request.body?.pipeTo(new WritableStream<Uint8Array>());
        return actor ? failure("notAllowed", 422, "You cannot do that.") : this.badToken();
      }
      const body = await readJson(request);
      if (typeof body?.type !== "string") return failure("badRequest");
      this.presence({ type: "request-seen", id: actor.id }); await this.sync();
      const parsed = adapter.parseAction(body);
      if (!parsed.ok) return resultError(parsed);
      if (parsed.value.requiresVersion && body.expectedVersion !== this.rec.version) return json({ error: "staleVersion", message: "The table has changed. Look again.", view: this.view(actor) }, 409);
      const r = adapter.apply(this.rec.game, actor, parsed.value.action, this.deps);
      if (!r.ok) return resultError(r);
      if (parsed.value.leaves && actor.role === "spectator") { delete this.rec.spectators[actor.id]; this.forget(actor.id); }
      await this.commit(r.value);
      if (parsed.value.leaves && !adapter.members(r.value).some(p => p.id === actor.id)) { this.forget(actor.id); await this.save(); }
      return json(this.view(actor, this.options(body)));
    }
    private async state(request: Request, url: URL) {
      const token = bearer(request), actor = this.auth(token);
      if (!actor) return this.badToken();
      const changed = actor.role === "display" ? false : this.presence({ type: "request-seen", id: actor.id });
      if (actor.role === "display") this.rec.displays[token] = this.deps.now();
      await this.sync(changed);
      if (Number(url.searchParams.get("since") ?? "0") === this.rec.version) { await this.waitForChange(); await this.sync(); }
      if (!this.auth(token)) return this.badToken();
      return json(this.view(actor, this.options(Object.fromEntries(url.searchParams))));
    }
    private accept(request: Request) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return failure("badRequest", 426, "Expected a WebSocket.");
      if (this.ctx.getWebSockets().length >= 40) return failure("badRequest", 503, "Too many connections.");
      const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1], [String(this.deps.now())]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
      if (typeof message !== "string") return;
      let m: any; try { m = JSON.parse(message); } catch { return; }
      if (!m || typeof m !== "object") return;
      let a = ws.deserializeAttachment() as Attachment<O> | null;
      if (m.type === "hello" && typeof m.token === "string") {
        const actor = this.auth(m.token);
        if (!actor) { this.dropSocket(ws); return; }
        a = { token: m.token, display: actor.role === "display", options: this.options(m), at: this.deps.now() };
        ws.serializeAttachment(a);
        if (a.display) { this.rec.displays[a.token] = this.deps.now(); await this.save(); this.push(ws); return; }
      }
      if (!a) return;
      a = this.adopt(ws, a);
      const actor = this.auth(a.token);
      if (!actor) { this.dropSocket(ws); return; }
      if (actor.role === "display") { this.push(ws); return; }
      await this.sync();
      const r = adapter.connection(this.rec.game, actor, m, a.options, this.deps);
      if (!r.ok) return;
      ws.serializeAttachment({ ...a, options: r.value.options });
      this.rec.game = r.value.state;
      if (r.value.changed) await this.commit(r.value.state); else await this.save();
      this.push(ws);
    }
    async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code === 1005 ? 1000 : code, "closing"); } catch {} await this.closed(ws, code === 1000 || code === 1001); }
    async webSocketError(ws: WebSocket) { await this.closed(ws, false); }
    private async closed(ws: WebSocket, deliberate: boolean) {
      const a = ws.deserializeAttachment() as Attachment<O> | null;
      const actor = a && this.auth(a.token);
      if (!actor || actor.role === "display" || this.liveIds(ws).has(actor.id)) return;
      await this.sync();
      const changed = this.presence({ type: "last-connection-close", id: actor.id, deliberate });
      await this.sync(changed);
    }
    private liveIds(skip?: WebSocket) {
      const ids = new Set<string>();
      for (const ws of this.ctx.getWebSockets()) {
        if (ws === skip || ws.readyState !== 1) continue;
        const a = ws.deserializeAttachment() as Attachment<O> | null;
        if (!a || a.display) continue;
        const actor = this.auth(a.token); if (!actor) continue;
        const heard = Math.max(a.at, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0);
        if (this.deps.now() - heard > LIVE_MS) { try { ws.close(4002, "silent"); } catch {} continue; }
        ids.add(actor.id);
      }
      return ids;
    }
    private dropSocket(ws: WebSocket) { ws.send(JSON.stringify({ type: "error", error: "badToken" })); ws.close(4001, "badToken"); }
    private push(ws: WebSocket) {
      try {
        let a = ws.deserializeAttachment() as Attachment<O> | null;
        if (!a) { if (this.deps.now() - Number(this.ctx.getTags(ws)[0] ?? 0) > 60_000) ws.close(4000, "no hello"); return; }
        a = this.adopt(ws, a);
        const actor = this.auth(a.token);
        if (!actor) {
          const id = this.who(a.token)?.id;
          if (id) { ws.send(JSON.stringify({ type: "view", view: this.view({ id, role: "player" }, a.options) })); ws.close(1000, "left"); }
          else this.dropSocket(ws);
          return;
        }
        ws.send(JSON.stringify({ type: "view", view: this.view(actor, a.options) }));
      } catch {}
    }
    private presence(event: Presence) { const r = adapter.presence(this.rec.game, event, this.deps); this.rec.game = r.state; return r.changed; }
    private async sync(force = false) {
      const changed = this.presence({ type: "live-members", ids: [...this.liveIds()] });
      const r = adapter.advance(this.rec.game, this.deps); this.rec.game = r.state;
      if (force || changed || r.changed) await this.commit(r.state);
      else { await this.save(); await this.schedule(); }
    }
    private info() { return { id: this.rec.roomId ?? "", ...adapter.summary(this.rec.game) }; }
    private async commit(state: S) {
      this.rec.game = state; this.rec.version++;
      if (adapter.clearSpectators(state)) this.rec.spectators = {};
      await this.save();
      for (const w of this.waiters) { clearTimeout(w.timer); w.resolve(); } this.waiters.clear();
      for (const ws of this.ctx.getWebSockets()) this.push(ws);
      const info = this.info(), listed = JSON.stringify([info.names, info.status]);
      if (info.id && listed !== this.rec.listed) {
        try { await this.env.DIRECTORY.getByName("home").fetch("https://directory/", { method: "POST", body: JSON.stringify(info), headers: { "x-code-version": this.env.CODE_VERSION ?? "" } }); this.rec.listed = listed; await this.save(); } catch (e) { console.error("directory update failed", e); }
      }
      await this.schedule();
    }
    private async schedule() { const at = adapter.nextWake(this.rec.game); if (at === null) await this.ctx.storage.deleteAlarm(); else await this.ctx.storage.setAlarm(Math.max(at, this.deps.now() + 50)); }
    async alarm() { await this.sync(); }
    private waitForChange(): Promise<void> { return new Promise(resolve => { const w: Waiter = { resolve, timer: setTimeout(() => { this.waiters.delete(w); resolve(); }, Number(this.env.POLL_MS) || POLL_MS) }; this.waiters.add(w); }); }
  };
}
