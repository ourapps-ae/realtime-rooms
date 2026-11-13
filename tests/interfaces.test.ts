import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));
const declared = (name: string) => {
  const block = read("implementation/server/adapter.ts").split(`export interface ${name}`)[1].split("\n}")[0];
  return [...block.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]).sort();
};
// The interface document of another component's type, wherever the required copy sits under interfaces/.
const documentOf = (type: string) => {
  const found = (readdirSync(new URL("../interfaces/", import.meta.url), { recursive: true }) as string[])
    .filter((path) => path.endsWith(".json")).map((path) => json("interfaces/" + path))
    .filter((doc) => doc.openrpc && doc.info?.title === type);
  assert.equal(found.length, 1, `one OpenRPC document for ${type}`);
  return found[0];
};
// OpenRPC method names, without a "Owner." qualifier.
const methodNames = (doc: { methods: { name: string }[] }) => new Set(doc.methods.map((m) => m.name.split(".").pop()));

test("every GameAdapter method a room calls is a method of the required ae/game-adapter document", () => {
  const required = documentOf("ae/game-adapter");
  const names = methodNames(required);
  for (const name of declared("GameAdapter")) assert.ok(names.has(name), name);
});

test("every IdentityService method a room calls is a method of the required ae/guest-identity document", () => {
  const required = documentOf("ae/guest-identity");
  const names = methodNames(required);
  for (const name of declared("IdentityService")) assert.ok(names.has(name), name);
  assert.match(read("implementation/server/adapter.ts"), /export type Services = \{ identity: IdentityService;/);
  assert.match(read("implementation/server/index.ts"), /from "\.\/adapter"/);
  assert.doesNotMatch(read("implementation/server/index.ts"), /guest-identity\/|components\/guest-identity/);
});

test("room-session.json (OpenRPC) names exactly what the implementation exports", () => {
  const doc = json("interfaces/room-session.json");
  assert.equal(doc.openrpc, "1.3.2");
  assert.equal(doc.info.title, "ae/room-session");
  const sources: Record<string, string> = {
    typescript: read("implementation/server/index.ts") + read("implementation/server/worker.ts") + read("implementation/web/live.ts"),
    // a method tagged with one platform is exported by that platform's entry module only
    server: read("implementation/server/index.ts") + read("implementation/server/worker.ts"),
    web: read("implementation/web/live.ts"),
    swift: read("implementation/apple/Sources/LiveConnection.swift"),
    kotlin: read("implementation/android/src/main/java/ae/rooms/RoomTransport.kt"),
  };
  for (const method of doc.methods) {
    const [owner, member] = method.name.includes(".") ? method.name.split(".") : [null, method.name];
    for (const { name: language } of method.tags) {
      const source = sources[language];
      const pattern = owner === null ? `export (function|class) ${member}\\b`
        : member === "init" ? `class ${owner}\\b`
        : ["typescript", "server", "web"].includes(language) ? `^  ${member}\\(` : `fun(c)? ${member}\\(`;
      assert.match(source, new RegExp(pattern, "m"), `${language} ${method.name}`);
    }
  }
  assert.deepEqual([...doc.components.schemas.GameAdapter.required].sort(), declared("GameAdapter"));
  assert.deepEqual([...doc.components.schemas.IdentityService.required].sort(), declared("IdentityService"));
});

test("room-session-http.json (OpenAPI) routes are the routes the room and worker serve", () => {
  const doc = json("interfaces/room-session-http.json");
  assert.equal(doc.openapi, "3.1.1");
  assert.equal(doc.info.title, "ae/room-session");
  const room = read("implementation/server/index.ts");
  const worker = read("implementation/server/worker.ts");
  const served = new Set<string>();
  for (const [, method, path] of room.matchAll(/request\.method === "(GET|POST)" && url\.pathname === "([^"]+)"/g)) served.add(`${method.toLowerCase()} /r/{room}${path}`);
  const documented = new Set<string>();
  for (const [path, item] of Object.entries<Record<string, unknown>>(doc.paths)) {
    for (const method of ["get", "post"]) if (item[method] && path.startsWith("/r/{room}/")) documented.add(`${method} ${path}`);
    if (!path.startsWith("/r/")) assert.ok(worker.includes(`"${path}"`), path);
  }
  assert.deepEqual([...documented].sort(), [...served].sort());
});

test("room-session-live.json (AsyncAPI) messages are the ones the room sends and reads", () => {
  const doc = json("interfaces/room-session-live.json");
  assert.equal(doc.asyncapi, "3.1.0");
  assert.equal(doc.info.title, "ae/room-session");
  const room = read("implementation/server/index.ts");
  for (const type of ["view", "token", "error"]) assert.match(room, new RegExp(`type: "${type}"`), type);
  assert.match(room, /m\.type === "hello"/);
  assert.match(room, /new WebSocketRequestResponsePair\("ping", "pong"\)/);
  for (const name of ["hello", "view", "token", "error", "ping", "pong"]) assert.ok(doc.channels.room.messages[name], name);
  for (const code of [4000, 4001, 4002]) assert.match(room, new RegExp(`close\\(${code}`), String(code));
});

test("the manifest requires guest-identity as a port", { skip: !existsSync(new URL("../component.json", import.meta.url)) && "component.json is not in this copy" }, () => {
  const manifest = json("component.json");
  const port = manifest.requires.find((item: { id: string }) => item.id === "guest-identity");
  assert.deepEqual({ ...port, path: undefined }, { id: "guest-identity", type: "ae/guest-identity", version: "1.0.0", path: undefined });
  assert.equal(json(port.path).info.title, "ae/guest-identity");
});

test("the directory requests a room and the worker make are paths of room-directory's OpenAPI document", () => {
  const doc = json("interfaces/required-room-directory-http.json");
  assert.equal(doc.openapi, "3.1.1");
  assert.equal(doc.info.title, "ae/room-directory");
  assert.ok(doc.paths["/"].post && doc.paths["/"].get && doc.paths["/ws"].get);
  assert.match(read("implementation/server/index.ts"), /DIRECTORY\.getByName\("home"\)\.fetch\("https:\/\/directory\/", \{ method: "POST"/);
  assert.match(read("implementation/server/worker.ts"), /new Request\("https:\/\/directory\/ws"/);
});
