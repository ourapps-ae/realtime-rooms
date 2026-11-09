import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));

test("required game-adapter file lists exactly the methods of GameAdapter", () => {
  const block = read("implementation/server/adapter.ts").split("export interface GameAdapter")[1].split("\n}")[0];
  const declared = [...block.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(json("interfaces/required/game-adapter.json").operations).sort(), declared);
});

test("room-session file lists what index.ts and worker.ts export", () => {
  const operations = Object.keys(json("interfaces/room-session.json").operations);
  for (const name of ["createRoomClass", "createWorker"]) assert.ok(operations.includes(name));
  assert.match(read("implementation/server/worker.ts"), /export function createWorker/);
  assert.match(read("implementation/server/index.ts"), /export function createRoomClass/);
});

test("required guest-identity file lists exactly the methods of IdentityService", () => {
  const block = read("implementation/server/adapter.ts").split("export interface IdentityService")[1].split("\n}")[0];
  const declared = [...block.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]).sort();
  const required = json("interfaces/required/guest-identity.json");
  assert.deepEqual(Object.keys(required.operations).sort(), declared);
  assert.match(read("implementation/server/adapter.ts"), /export type Services = \{ identity: IdentityService;/);
  assert.match(read("implementation/server/index.ts"), /from "\.\/adapter"/);
  assert.doesNotMatch(read("implementation/server/index.ts"), /guest-identity\/|components\/guest-identity/);
});

test("the manifest requires guest-identity as a port", { skip: !existsSync(new URL("../component.json", import.meta.url)) && "component.json is not in this copy" }, () => {
  const manifest = json("component.json");
  const port = manifest.requires.find((item: { id: string }) => item.id === "guest-identity");
  assert.deepEqual(port, { id: "guest-identity", type: "ae/guest-identity", version: "1.0.0", path: "interfaces/required/guest-identity.json" });
});
