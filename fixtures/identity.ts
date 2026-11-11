import type { IdentityBook, IdentityRecord, IdentityService } from "../implementation/server/adapter";

// Test stand-in for the guest-identity component: the same claim, authenticate and release behaviour, with a rotation period in seconds.
// An application passes guest-identity's createIdentityApi(settings) as services.identity instead.
export function createFixtureIdentity(tokenRotationSeconds = 0): IdentityService {
  const grace = tokenRotationSeconds * 1000;
  return {
    claim(book, name, deps, presented = null) {
      if (typeof name !== "string" || name.length < 1 || name.length > 20 || name.trim() !== name) return { ok: false, error: { code: "badName", message: "A name is 1 to 20 plain characters with no space at either end." } };
      const existing = Object.values(book.records).find((r) => r.name === name);
      const now = deps.now();
      if (existing && !(presented && (existing.token === presented || (existing.previousToken === presented && grace > 0 && now - existing.issuedAt < grace)))) return { ok: false, error: { code: "nameTaken", message: "That name is in use here. Choose another name." } };
      const id = existing?.id ?? deps.newId(), token = deps.newToken();
      const record: IdentityRecord = { id, name, token, previousToken: null, issuedAt: now, lastSeenAt: now };
      return { ok: true, value: { book: { records: { ...book.records, [id]: record } }, id, token, rejoined: existing !== undefined } };
    },
    authenticate(book, token, deps) {
      const now = deps.now();
      const record = Object.values(book.records).find((r) => r.token === token || (r.previousToken === token && grace > 0 && now - r.issuedAt < grace));
      if (!record) return null;
      let next = { ...record, lastSeenAt: now }, rotatedToken: string | null = null;
      if (record.previousToken === token) rotatedToken = record.token;
      else if (grace > 0 && now - record.issuedAt >= grace) { rotatedToken = deps.newToken(); next = { ...next, token: rotatedToken, previousToken: token, issuedAt: now }; }
      return { book: { records: { ...book.records, [record.id]: next } }, id: record.id, name: record.name, rotatedToken };
    },
    release(book, id) {
      const { [id]: _gone, ...records }: IdentityBook["records"] = book.records;
      return { records };
    },
  };
}
