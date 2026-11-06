import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.UNIPILE_DSN = "https://api.example.test:1";
  process.env.UNIPILE_API_KEY = "k";
});

import { sendEmailUnipile, sendLinkedInChatMessage, ensureWebhooks, subjectReponse } from "./unipile-mail";

const ok = (body: any, status = 201) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

describe("subjectReponse", () => {
  it("préfixe sauf si déjà Re:", () => {
    expect(subjectReponse("Re: Bonjour")).toBe("Re: Bonjour");
    expect(subjectReponse("RE: Bonjour")).toBe("RE: Bonjour");
    expect(subjectReponse("Re : Bonjour")).toBe("Re : Bonjour");
    expect(subjectReponse("Bonjour")).toBe("Re: Bonjour");
  });
});

describe("sendEmailUnipile", () => {
  let f: any;
  beforeEach(() => { f = vi.fn(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("envoie le corps sans reply_to ni tracking", async () => {
    f.mockResolvedValue(ok({ provider_id: "p1", tracking_id: "t1" }));
    const r = await sendEmailUnipile({ accountId: "a", to: "x@y.fr", toName: "X", subject: "S", body: "B" });
    expect(r).toEqual({ ok: true, providerId: "p1", threadId: undefined });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.example.test:1/api/v1/emails");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ account_id: "a", to: [{ identifier: "x@y.fr", display_name: "X" }], subject: "S", body: "B" });
  });

  it("ajoute reply_to, tracking et en-têtes", async () => {
    f.mockResolvedValue(ok({ provider_id: "p2" }));
    await sendEmailUnipile({ accountId: "a", to: "x@y.fr", toName: "X", subject: "Re: S", body: "B", replyToProviderId: "prev", trackingLabel: "lead-1", headers: { "X-Naya": "1" } });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.reply_to).toBe("prev");
    expect(body.tracking_options).toEqual({ opens: true, links: false, label: "lead-1" });
    expect(body.custom_headers).toEqual([{ name: "X-Naya", value: "1" }]);
  });

  it("HTTP 500 -> ok:false sans exception", async () => {
    f.mockResolvedValue(ok({}, 500));
    const r = await sendEmailUnipile({ accountId: "a", to: "x@y.fr", toName: "X", subject: "S", body: "B" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("500");
  });

  it("erreur réseau -> ok:false", async () => {
    f.mockRejectedValue(new Error("boom"));
    const r = await sendEmailUnipile({ accountId: "a", to: "x@y.fr", toName: "X", subject: "S", body: "B" });
    expect(r.ok).toBe(false);
  });
});

describe("sendLinkedInChatMessage", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("POST /chats/{id}/messages", async () => {
    const f = vi.fn().mockResolvedValue(ok({ message_id: "m1" }));
    vi.stubGlobal("fetch", f);
    const r = await sendLinkedInChatMessage({ accountId: "a", chatId: "c/1", text: "yo" });
    expect(r).toEqual({ ok: true, messageId: "m1" });
    expect(f.mock.calls[0][0]).toBe("https://api.example.test:1/api/v1/chats/c%2F1/messages");
    expect((f.mock.calls[0][1].body as FormData).get("text")).toBe("yo");
  });
  it("500 -> ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({}, 500)));
    expect((await sendLinkedInChatMessage({ accountId: "a", chatId: "c", text: "t" })).ok).toBe(false);
  });
});

describe("ensureWebhooks", () => {
  afterEach(() => vi.unstubAllGlobals());
  const url = "https://naya.test/api/unipile/webhook";

  it("crée les 5 webhooks manquants", async () => {
    const f = vi.fn().mockImplementation(async (_u: string, init: any) =>
      init?.method === "POST" ? ok({ webhook_id: "w" }) : ok({ items: [], cursor: null }, 200));
    vi.stubGlobal("fetch", f);
    await ensureWebhooks("https://naya.test", "sec");
    const posts = f.mock.calls.filter((c: any) => c[1]?.method === "POST").map((c: any) => JSON.parse(c[1].body));
    expect(posts.map((p: any) => p.source).sort()).toEqual(["account_status", "email", "email_tracking", "messaging", "users"]);
    expect(posts[0].request_url).toBe(url);
    expect(posts[0].headers).toEqual([{ key: "Content-Type", value: "application/json" }, { key: "Unipile-Auth", value: "sec" }]);
  });

  it("ne recrée pas un webhook existant", async () => {
    const f = vi.fn().mockImplementation(async (_u: string, init: any) =>
      init?.method === "POST" ? ok({ webhook_id: "w" }) : ok({ items: [{ id: "1", request_url: url, events: ["message_received"], name: "naya-messaging" }], cursor: null }, 200));
    vi.stubGlobal("fetch", f);
    await ensureWebhooks("https://naya.test", "sec");
    const posts = f.mock.calls.filter((c: any) => c[1]?.method === "POST").map((c: any) => JSON.parse(c[1].body));
    expect(posts.map((p: any) => p.source)).not.toContain("messaging");
    expect(posts).toHaveLength(4);
  });

  it("M5 : APP_URL sans https:// → rien n'est listé ni créé, un seul avertissement", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ensureWebhooks("http://naya.test", "sec");
      expect(f).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0].join(" ")).not.toContain("sec");
    } finally { warn.mockRestore(); }
  });

  const tous = (headersDe: (source: string) => any) => [
    ["messaging", "message_received"], ["email", "mail_received"], ["email_tracking", "mail_opened"],
    ["users", "new_relation"], ["account_status", "error"],
  ].map(([source, event], i) => ({ id: `w${i}`, request_url: url, name: `naya-${source}`, events: [event], ...headersDe(source) }));

  it("I2 : secret exposé et différent → supprimé puis recréé avec le secret courant", async () => {
    const items = tous((source) => ({ headers: [{ key: "Unipile-Auth", value: source === "email" ? "ancien" : "sec" }] }));
    const f = vi.fn().mockImplementation(async (_u: string, init: any) =>
      init?.method === "POST" || init?.method === "DELETE" ? ok({}) : ok({ items, cursor: null }, 200));
    vi.stubGlobal("fetch", f);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ensureWebhooks("https://naya.test", "sec");
      const dels = f.mock.calls.filter((c: any) => c[1]?.method === "DELETE");
      expect(dels).toHaveLength(1);
      expect(dels[0][0]).toBe("https://api.example.test:1/api/v1/webhooks/w1");
      const posts = f.mock.calls.filter((c: any) => c[1]?.method === "POST").map((c: any) => JSON.parse(c[1].body));
      expect(posts.map((p: any) => p.source)).toEqual(["email"]);
      expect(posts[0].headers).toContainEqual({ key: "Unipile-Auth", value: "sec" });
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/ancien|\bsec\b/);
    } finally { warn.mockRestore(); }
  });

  it("I2 : secret identique → rien n'est touché", async () => {
    const items = tous(() => ({ headers: [{ key: "Unipile-Auth", value: "sec" }] }));
    const f = vi.fn().mockImplementation(async () => ok({ items, cursor: null }, 200));
    vi.stubGlobal("fetch", f);
    await ensureWebhooks("https://naya.test", "sec");
    expect(f.mock.calls.filter((c: any) => c[1]?.method)).toHaveLength(0);
  });

  it("I2 : en-têtes non exposés par la liste → gardés, un seul avertissement (dashboard)", async () => {
    const items = tous(() => ({}));
    const f = vi.fn().mockImplementation(async () => ok({ items, cursor: null }, 200));
    vi.stubGlobal("fetch", f);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ensureWebhooks("https://naya.test", "sec");
      expect(f.mock.calls.filter((c: any) => c[1]?.method)).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("tableau de bord Unipile");
    } finally { warn.mockRestore(); }
  });

  it("ne lève jamais", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("x")));
    await expect(ensureWebhooks("https://naya.test", "s")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({}, 500)));
    await expect(ensureWebhooks("https://naya.test", "s")).resolves.toBeUndefined();
  });
});
