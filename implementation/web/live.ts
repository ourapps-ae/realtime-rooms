// A live connection to the server that reconnects by itself, for a room or the home list. A
// ping every 25 s keeps it open (the server answers without waking up); 70 s without hearing
// anything counts as lost. `onDown` says whether the server cannot be reached: a connection
// attempt that failed, until one opens again.

export type LiveMessage = { type: string; [k: string]: unknown };

export class Live {
  private ws: WebSocket | null = null;
  private wanted = false;
  private retry = 1000;
  private timer = 0;

  constructor(private baseUrl: string, private path: string, private hello: () => string | null, private onMessage: (m: LiveMessage) => void, private onDown: (down: boolean) => void = () => {}) {}

  open() {
    if (this.wanted) return;
    this.wanted = true;
    this.connect();
  }

  // A normal close: the server takes it as this device going away.
  close() {
    this.wanted = false;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  send(message: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(message);
  }

  private connect() {
    if (!this.wanted) return;
    const ws = new WebSocket(this.baseUrl.replace(/^http/, "ws") + this.path);
    this.ws = ws;
    let heardAt = Date.now();
    const pinger = window.setInterval(() => {
      if (Date.now() - heardAt > 70_000) ws.close();
      else if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 25_000);
    ws.onopen = () => {
      if (!this.wanted || this.ws !== ws) return;
      this.retry = 1000;
      heardAt = Date.now();
      this.onDown(false);
      const hello = this.hello();
      if (hello) ws.send(hello);
    };
    ws.onmessage = (e) => {
      if (!this.wanted || this.ws !== ws) return;
      heardAt = Date.now();
      if (e.data === "pong") return;
      try {
        this.onMessage(JSON.parse(e.data as string));
      } catch {
        // Not ours to read.
      }
    };
    ws.onclose = () => {
      clearInterval(pinger);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wanted) return;
      this.onDown(true);
      this.timer = window.setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    };
  }
}
