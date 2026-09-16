import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publicIdFromUrl, interpretConnectionResponse } from "./linkedin";

describe("publicIdFromUrl", () => {
  it("extrait l'identifiant d'une URL standard", () => {
    expect(publicIdFromUrl("https://www.linkedin.com/in/solene-jaboulet-7799b9/")).toBe("solene-jaboulet-7799b9");
  });
  it("gère les sous-domaines régionaux et l'absence de slash final", () => {
    expect(publicIdFromUrl("https://fr.linkedin.com/in/jeanne-mejean")).toBe("jeanne-mejean");
  });
  it("ignore la query string et le fragment", () => {
    expect(publicIdFromUrl("https://linkedin.com/in/john-doe?utm=x#about")).toBe("john-doe");
  });
  it("décode les caractères encodés", () => {
    expect(publicIdFromUrl("https://www.linkedin.com/in/jos%C3%A9-garcia")).toBe("josé-garcia");
  });
  it("renvoie null si pas une URL de profil ou vide", () => {
    expect(publicIdFromUrl("https://linkedin.com/company/acme")).toBeNull();
    expect(publicIdFromUrl(null)).toBeNull();
    expect(publicIdFromUrl("")).toBeNull();
  });
});

describe("interpretConnectionResponse", () => {
  it("renvoie true quand network_distance vaut FIRST_DEGREE", () => {
    expect(interpretConnectionResponse({ network_distance: "FIRST_DEGREE" })).toBe(true);
  });
  it("renvoie true quand is_relationship vaut true", () => {
    expect(interpretConnectionResponse({ is_relationship: true })).toBe(true);
  });
  it("renvoie false pour un 2e/3e degré explicite", () => {
    expect(interpretConnectionResponse({ network_distance: "SECOND_DEGREE" })).toBe(false);
    expect(interpretConnectionResponse({ network_distance: "THIRD_DEGREE", is_relationship: false })).toBe(false);
  });
  it("renvoie false sur une forme de réponse inconnue (fail closed)", () => {
    expect(interpretConnectionResponse({})).toBe(false);
    expect(interpretConnectionResponse(null)).toBe(false);
    expect(interpretConnectionResponse(undefined)).toBe(false);
    expect(interpretConnectionResponse({ some_other_field: "x" })).toBe(false);
  });
});

// Revue post-commit 261835e, défaut Critique 3 : quand LinkedIn restreint un compte, le
// PREMIER appel à tomber est `GET /api/v1/users/:id` (résolution du provider_id), en
// 401/403 — pas les appels `/chats` ou `/invite`, qui ne sont jamais atteints. L'ancien
// code `resolveProviderId` avalait le code HTTP (`if (!res.ok) return null`), donc
// `sendLinkedInStep` composait le même `error: "profile_not_resolved"` qu'un profil
// simplement introuvable (200 OK, payload vide) — indiscernable pour
// `isLinkedInRestrictionSignal`, qui classait ce texte comme non-restriction. La
// restriction était donc manquée sur le chemin par lequel elle arrive le plus souvent.
//
// `vi.resetModules()` + import dynamique APRÈS avoir stubbé `UNIPILE_API_KEY`/`UNIPILE_DSN` :
// ces deux valeurs sont lues une seule fois, au chargement du module (`linkedinConfigured()`
// doit renvoyer `true` pour que `sendLinkedInStep`/`resolveProviderId` dépassent leur garde
// de configuration et appellent réellement `fetch`, mocké ci-dessous).
describe("resolveProviderId — propage le code HTTP en cas d'échec (ne l'avale plus)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UNIPILE_API_KEY", "test-key");
    vi.stubEnv("UNIPILE_DSN", "https://api.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("401 (authentification) → providerId null, httpStatus 401 propagé", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { resolveProviderId } = await import("./linkedin");
    expect(await resolveProviderId("acc1", "public-id")).toEqual({ providerId: null, httpStatus: 401 });
  });

  it("403 (interdit) → httpStatus 403 propagé", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { resolveProviderId } = await import("./linkedin");
    expect(await resolveProviderId("acc1", "public-id")).toEqual({ providerId: null, httpStatus: 403 });
  });

  it("200 OK mais payload sans provider_id/id → profil introuvable, PAS une erreur HTTP (httpStatus null)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { resolveProviderId } = await import("./linkedin");
    expect(await resolveProviderId("acc1", "public-id")).toEqual({ providerId: null, httpStatus: null });
  });

  it("200 OK avec provider_id → résolu, httpStatus null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ provider_id: "p1" }) }));
    const { resolveProviderId } = await import("./linkedin");
    expect(await resolveProviderId("acc1", "public-id")).toEqual({ providerId: "p1", httpStatus: null });
  });
});

describe("sendLinkedInStep — resolve_401/resolve_403 quand la résolution du profil échoue par erreur HTTP (jamais profile_not_resolved dans ce cas)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UNIPILE_API_KEY", "test-key");
    vi.stubEnv("UNIPILE_DSN", "https://api.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("résolution du profil en 401 → error 'resolve_401'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { sendLinkedInStep } = await import("./linkedin");
    const got = await sendLinkedInStep({ accountId: "acc1", linkedinUrl: "https://linkedin.com/in/x", text: "hello" });
    expect(got).toEqual({ ok: false, action: "none", error: "resolve_401" });
  });

  it("résolution du profil en 403 → error 'resolve_403'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { sendLinkedInStep } = await import("./linkedin");
    const got = await sendLinkedInStep({ accountId: "acc1", linkedinUrl: "https://linkedin.com/in/x", text: "hello" });
    expect(got).toEqual({ ok: false, action: "none", error: "resolve_403" });
  });

  it("résolution 200 OK mais profil vide → error 'profile_not_resolved' inchangé (PAS une restriction)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { sendLinkedInStep } = await import("./linkedin");
    const got = await sendLinkedInStep({ accountId: "acc1", linkedinUrl: "https://linkedin.com/in/x", text: "hello" });
    expect(got).toEqual({ ok: false, action: "none", error: "profile_not_resolved" });
  });
});

describe("isConnected — reste fail-closed après le changement de forme de resolveProviderId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UNIPILE_API_KEY", "test-key");
    vi.stubEnv("UNIPILE_DSN", "https://api.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("résolution du profil en 401 → false, jamais d'exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { isConnected } = await import("./linkedin");
    expect(await isConnected("acc1", "https://linkedin.com/in/x")).toBe(false);
  });
});

// Revue post-commit f17af17, défaut Important : `isConnected` avalait les 401/403 du
// poller (`linkedin-sync.ts`) — `if (!res.ok) return false;` traitait une restriction
// LinkedIn comme « pas encore en relation », sans jamais la signaler. Même défaut, même
// endroit du raisonnement que `resolveProviderId` (Critique 3 de la ronde précédente) :
// absence de mesure traitée comme mesure. `checkConnection` propage le statut ; `isConnected`
// (conservé pour ses propres appelants) reste un simple booléen fail-closed dérivé.
describe("checkConnection — propage le statut HTTP (jamais avalé), même contrat fail-closed que isConnected pour `connected`", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UNIPILE_API_KEY", "test-key");
    vi.stubEnv("UNIPILE_DSN", "https://api.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("résolution du profil en 401 → ok:false, error:'resolve_401', connected:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { checkConnection } = await import("./linkedin");
    expect(await checkConnection("acc1", "https://linkedin.com/in/x")).toEqual({
      ok: false, connected: false, error: "resolve_401",
    });
  });

  it("résolution du profil en 403 → ok:false, error:'resolve_403'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { checkConnection } = await import("./linkedin");
    expect(await checkConnection("acc1", "https://linkedin.com/in/x")).toEqual({
      ok: false, connected: false, error: "resolve_403",
    });
  });

  it("profil résolu, mais le GET de statut final échoue en 403 → ok:false, error:'check_403'", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ provider_id: "p1" }) }) // resolveProviderId
      .mockResolvedValueOnce({ ok: false, status: 403 }); // GET final de statut
    vi.stubGlobal("fetch", fetchMock);
    const { checkConnection } = await import("./linkedin");
    expect(await checkConnection("acc1", "https://linkedin.com/in/x")).toEqual({
      ok: false, connected: false, error: "check_403",
    });
  });

  it("profil résolu, en relation (FIRST_DEGREE) → ok:true, connected:true, error:null", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ provider_id: "p1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ network_distance: "FIRST_DEGREE" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { checkConnection } = await import("./linkedin");
    expect(await checkConnection("acc1", "https://linkedin.com/in/x")).toEqual({
      ok: true, connected: true, error: null,
    });
  });

  it("profil résolu, pas encore en relation → ok:true, connected:false, error:null (PAS une restriction)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ provider_id: "p1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ network_distance: "SECOND_DEGREE" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { checkConnection } = await import("./linkedin");
    expect(await checkConnection("acc1", "https://linkedin.com/in/x")).toEqual({
      ok: true, connected: false, error: null,
    });
  });

  it("200 OK mais profil vide (pas d'erreur HTTP) → ok:true, connected:false, error:null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { checkConnection } = await import("./linkedin");
    expect(await checkConnection("acc1", "https://linkedin.com/in/x")).toEqual({
      ok: true, connected: false, error: null,
    });
  });

  it("exception réseau → ok:false, connected:false, jamais levée (fail closed)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { checkConnection } = await import("./linkedin");
    const got = await checkConnection("acc1", "https://linkedin.com/in/x");
    expect(got.ok).toBe(false);
    expect(got.connected).toBe(false);
  });

  it("isConnected reste équivalent à checkConnection(...).connected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ provider_id: "p1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ network_distance: "FIRST_DEGREE" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { isConnected } = await import("./linkedin");
    expect(await isConnected("acc1", "https://linkedin.com/in/x")).toBe(true);
  });
});
