import { json } from "./index";
import type { RoomEnv, Settings } from "./adapter";

export function createWorker(settings: Settings, roomIds: readonly string[], service?: (request: Request, env: RoomEnv) => Promise<Response | null>) {
  let cache: { at: number; body: string } | null = null;
  const allowed = (origin: string, env: RoomEnv) => settings.allowedOrigins.includes(origin) || (env.WEB_ORIGINS ?? "").split(",").map(s => s.trim()).includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    async fetch(request: Request, env: RoomEnv): Promise<Response> {
      const origin = request.headers.get("origin");
      const cors: Record<string, string> = { vary: "Origin" };
      if (origin && allowed(origin, env)) Object.assign(cors, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400", "access-control-expose-headers": "x-rotated-token" });
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && origin && !allowed(origin, env)) return new Response("Forbidden", { status: 403 });
      const url = new URL(request.url);
      let response: Response | null = null;
      if (url.pathname === "/" || url.pathname === "/health") response = json({ ok: true, app: settings.applicationId });
      else if (service) response = await service(request, env);
      if (!response && url.pathname === "/rooms/ws") {
        const headers = new Headers(request.headers); headers.set("x-code-version", env.CODE_VERSION ?? "");
        response = await env.DIRECTORY.getByName("home").fetch(new Request("https://directory/ws", { headers }));
      }
      if (!response && url.pathname === "/rooms" && request.method === "GET") {
        if (!cache || Date.now() - cache.at > 3000) cache = { at: Date.now(), body: await env.DIRECTORY.getByName("home").fetch("https://directory/", { headers: { "x-code-version": env.CODE_VERSION ?? "" } }).then(r => r.text()) };
        response = new Response(cache.body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }
      const match = url.pathname.match(/^\/r\/([a-z-]+)(\/.*)$/);
      if (!response && match && roomIds.includes(match[1])) {
        if (request.method !== "GET") cache = null;
        url.pathname = match[2];
        const headers = new Headers(request.headers); headers.set("x-room-id", match[1]); headers.set("x-code-version", env.CODE_VERSION ?? "");
        response = await env.ROOM.getByName(match[1]).fetch(new Request(url, { method: request.method, headers, body: request.body }));
      }
      response ??= json({ error: "badRequest", message: "No such route." }, 404);
      if (response.status === 101) return response;
      const headers = new Headers(response.headers); for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    },
  };
}
