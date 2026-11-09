import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
const inspector = createServer();
await new Promise(resolve => inspector.listen(0, "127.0.0.1", resolve));
const inspectorPort = inspector.address().port;
await new Promise(resolve => listener.close(resolve));
await new Promise(resolve => inspector.close(resolve));
const worker = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort)], { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] });
const exited = new Promise(resolve => worker.once("exit", resolve));
let output = "";
worker.stdout.on("data", data => { output += data; });
worker.stderr.on("data", data => { output += data; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (worker.exitCode !== null) throw new Error(output);
    try { ready = (await fetch(`${base}/health`)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, output);
  const display = await (await fetch(`${base}/r/one/display`, { method: "POST", body: "{}" })).json();
  for (const [token, status] of [[display.token, 422], ["invalid-token", 401]]) {
    let chunks = 0;
    const body = new ReadableStream({
      async pull(controller) {
        await delay(5);
        if (chunks++ === 16) controller.close();
        else controller.enqueue(new TextEncoder().encode(" ".repeat(16_384)));
      },
    });
    const response = await fetch(`${base}/r/one/action`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body, duplex: "half" });
    assert.equal(response.status, status);
    await response.text();
  }
  await delay(300);
  assert.doesNotMatch(output, /Can't read from request stream after response has been sent/);
  console.log("Rejected streamed action bodies preserve status without request-stream errors.");
} finally {
  worker.kill("SIGTERM");
  await exited;
}
