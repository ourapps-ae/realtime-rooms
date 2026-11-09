import { afterEach, expect, it, vi } from "vitest";
import { Live } from "../implementation/web/live";
class Socket {
  static OPEN = 1;
  static sockets: Socket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen = () => {};
  onmessage = (_: { data: string }) => {};
  onclose = () => {};
  constructor(readonly url: string) { Socket.sockets.push(this); }
  send(text: string) { this.sent.push(text); }
  close(_code?: number) { this.readyState = 3; this.onclose(); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Socket.sockets = []; });
function setup() { vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket); vi.stubGlobal("window", globalThis); }
it("injects address, authenticates, pings, and decodes only application messages", () => {
  setup(); const messages = vi.fn(), down = vi.fn();
  const live = new Live("https://counter.example", "/r/one/ws", () => "hello", messages, down);
  live.open(); live.open(); expect(Socket.sockets).toHaveLength(1);
  const ws = Socket.sockets[0]; expect(ws.url).toBe("wss://counter.example/r/one/ws");
  ws.onopen(); expect(ws.sent).toEqual(["hello"]); expect(down).toHaveBeenCalledWith(false);
  vi.advanceTimersByTime(25_000); expect(ws.sent).toContain("ping");
  ws.onmessage({ data: "pong" }); ws.onmessage({ data: "invalid" });
  ws.onmessage({ data: '{"type":"view","value":2}' }); expect(messages).toHaveBeenCalledExactlyOnceWith({ type: "view", value: 2 });
  live.send("increment"); expect(ws.sent).toContain("increment"); live.close();
});
it("reconnects with fresh hello and ignores messages from the old connection", () => {
  setup(); const messages = vi.fn(), down = vi.fn(); let token = "first";
  const live = new Live("http://localhost:8787", "/rooms/ws", () => token, messages, down);
  live.open(); const first = Socket.sockets[0]; first.onopen(); first.close();
  expect(down).toHaveBeenLastCalledWith(true); token = "second";
  vi.advanceTimersByTime(1000); const next = Socket.sockets[1]; next.onopen();
  expect(next.sent).toEqual(["second"]);
  first.onmessage({ data: '{"type":"view"}' }); expect(messages).not.toHaveBeenCalled();
  live.close(); vi.advanceTimersByTime(60_000); expect(Socket.sockets).toHaveLength(2);
});
