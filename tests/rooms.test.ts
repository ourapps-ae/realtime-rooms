import { SELF, env, runInDurableObject } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { createRoomClass } from "../implementation/server/index";
import { adapter } from "../fixtures/worker";
const root = "https://counter.test", base = root + "/r/one";
const post = (path: string, body: unknown, token = "") => SELF.fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const join = async (name: string, token = ""): Promise<any> => (await post("/join", { name }, token)).json();
const state = async (token: string): Promise<any> => (await SELF.fetch(base + "/state", { headers: { authorization: `Bearer ${token}` } })).json();
const stub = (): DurableObjectStub => env.ROOM.getByName("one");
beforeEach(async () => { for (const object of [stub(), env.DIRECTORY.getByName("home")]) await runInDurableObject(object, async (_, ctx) => { await ctx.storage.deleteAll(); ctx.abort("reset"); }).catch(() => {}); });

it("isolates private values and rejects stale actions and display actions", async () => {
  const a = await join("A"), b = await join("B"), watcher = await join("watcher");
  expect((await state(a.token)).secret).toBe(`private-${a.playerId}`);
  expect((await state(b.token)).secret).toBe(`private-${b.playerId}`);
  expect(watcher.view.secret).toBeNull();
  const display: any = await (await post("/display", {})).json();
  expect(display.view.secret).toBeNull();
  expect((await post("/action", { type: "increment", expectedVersion: 0 }, a.token)).status).toBe(409);
  expect((await post("/action", { type: "increment", expectedVersion: watcher.view.version }, watcher.token)).status).toBe(422);
  expect((await post("/action", { type: "increment" }, display.token)).status).toBe(422);
  expect((await SELF.fetch(base + "/state")).status).toBe(401);
});

it("rotates tokens and retains state and directory across restart", async () => {
  const a = await join("A"), again = await join("A", a.token);
  expect(again.playerId).toBe(a.playerId);
  expect((await SELF.fetch(base + "/state", { headers: { authorization: `Bearer ${a.token}` } })).status).toBe(401);
  await post("/action", { type: "increment", expectedVersion: again.view.version }, again.token);
  await runInDurableObject(stub(), (_, ctx) => ctx.abort("restart")).catch(() => {});
  expect((await state(again.token)).value).toBe(1);
  const directory: any = await (await SELF.fetch(root + "/rooms")).json();
  expect(directory[0].names).toEqual(["A"]);
});

it("persists clock-only advancement without incrementing the visible version and schedules alarms", async () => {
  const a = await join("A"), first = await state(a.token);
  await new Promise(resolve => setTimeout(resolve, 15));
  const next = await state(a.token);
  expect(next.version).toBe(first.version); expect(next.clock).toBeGreaterThan(first.clock);
  await post("/action", { type: "alarm", expectedVersion: next.version }, a.token);
  await runInDurableObject(stub(), async (instance, ctx) => {
    expect(await ctx.storage.getAlarm()).not.toBeNull();
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  await runInDurableObject(stub(), async (instance: unknown) => { await (instance as { alarm(): Promise<void> }).alarm(); });
  const after = await state(a.token); expect(after.value).toBe(1); expect(after.version).toBe(next.version + 2);
  await runInDurableObject(stub(), async (_, ctx) => expect(await ctx.storage.getAlarm()).toBeNull());
});

async function connect(token: string) {
  const r = await SELF.fetch(base + "/ws", { headers: { upgrade: "websocket" } });
  const ws = r.webSocket!; ws.accept();
  const first = new Promise<void>(resolve => ws.addEventListener("message", () => resolve(), { once: true }));
  ws.send(JSON.stringify({ type: "hello", token })); await first;
  return ws;
}
it("keeps multiple connections present and distinguishes deliberate and lost close", async () => {
  const a = await join("A"), one = await connect(a.token), two = await connect(a.token);
  one.close(1000); await new Promise(resolve => setTimeout(resolve, 20));
  expect((await state(a.token)).closes).toEqual([]);
  two.close(1000); await new Promise(resolve => setTimeout(resolve, 20));
  expect((await state(a.token)).closes).toEqual([true]);
  const third = await connect(a.token); third.close(4002); await new Promise(resolve => setTimeout(resolve, 20));
  expect((await state(a.token)).closes).toEqual([true, false]);
});

const authed = (token: string, path = "/state") => SELF.fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
// Makes the guest's current token look old, so the next request rotates it (the fixture rotates after an hour).
type Inside = { rec: { identity: { records: Record<string, { issuedAt: number }> } } };
const age = (id: string) => runInDurableObject(stub(), async (instance: unknown) => { (instance as Inside).rec.identity.records[id].issuedAt -= 2 * 3600_000; });

it("needs the guest-identity component", () => {
  expect(() => createRoomClass(adapter, {} as never, { applicationId: "x", allowedOrigins: [], roomPrefix: "x-" })).toThrow(/services\.identity/);
  expect(() => createRoomClass(adapter, { identity: {} } as never, { applicationId: "x", allowedOrigins: [], roomPrefix: "x-" })).toThrow(/services\.identity/);
});

it("gives a seat back only to the token it was given: a join by the name alone is refused", async () => {
  const a = await join("A");
  for (const token of ["", "not-a-token"]) {
    const taken = await post("/join", { name: "A" }, token);
    expect(taken.status).toBe(409);
    expect((await taken.json() as any).error).toBe("nameTaken");
  }
  expect((await state(a.token)).secret).toBe(`private-${a.playerId}`);
  const back = await join("A", a.token);
  expect(back.playerId).toBe(a.playerId);
  expect((await SELF.fetch(base + "/state", { headers: { authorization: `Bearer ${a.token}` } })).status).toBe(401);
});

it("frees the name when the game lets the seat go without the player leaving", async () => {
  const a = await join("A");
  // The game drops the seat by itself (as a waiting room drops a closed device): the next change releases the name.
  await runInDurableObject(stub(), async (instance: unknown) => { (instance as { rec: { game: { members: unknown[] } } }).rec.game.members = []; });
  const b = await join("B");
  expect((await authed(a.token)).status).toBe(401);
  const again = await join("A");
  expect(again.playerId).not.toBe(a.playerId);
  expect(b.playerId).toBeTruthy();
});

it("refuses a name guest-identity rejects, and frees the name when a player leaves", async () => {
  const bad = await post("/join", { name: "" });
  expect(bad.status).toBe(422); expect((await bad.json() as any).error).toBe("badName");
  expect((await post("/join", { name: " padded" })).status).toBe(422);
  const a = await join("A");
  expect((await post("/action", { type: "leave" }, a.token)).status).toBe(200);
  expect((await authed(a.token)).status).toBe(401);
  const back = await join("A");
  expect(back.playerId).not.toBe(a.playerId);
});

it("hands a rotated token to the device in a response header and keeps the replaced one working for one period", async () => {
  const a = await join("A");
  expect((await authed(a.token)).headers.get("x-rotated-token")).toBeNull();
  await age(a.playerId);
  const rotated = await authed(a.token);
  const next = rotated.headers.get("x-rotated-token");
  expect(rotated.status).toBe(200); expect(next).toBeTruthy(); expect(next).not.toBe(a.token);
  const again = await authed(a.token);
  expect(again.status).toBe(200); expect(again.headers.get("x-rotated-token")).toBe(next);
  const current = await authed(next!);
  expect(current.status).toBe(200); expect(current.headers.get("x-rotated-token")).toBeNull();
  expect((await current.json() as any).secret).toBe(`private-${a.playerId}`);
  await age(a.playerId);
  const second = (await authed(next!)).headers.get("x-rotated-token");
  expect(second).toBeTruthy();
  expect((await authed(a.token)).status).toBe(401);
  expect((await authed(second!)).status).toBe(200);
});

it("tells a live connection its new token and keeps it connected", async () => {
  const a = await join("A"), ws = await connect(a.token);
  const messages: any[] = []; ws.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))); });
  await age(a.playerId);
  ws.send(JSON.stringify({ type: "hello", token: a.token }));
  await new Promise(resolve => setTimeout(resolve, 50));
  const token = messages.find(m => m.type === "token")?.token;
  expect(token).toBeTruthy();
  expect(messages.some(m => m.type === "view")).toBe(true);
  expect(messages.some(m => m.type === "error")).toBe(false);
  expect((await authed(token)).status).toBe(200);
  ws.close(1000); await new Promise(resolve => setTimeout(resolve, 30));
});
