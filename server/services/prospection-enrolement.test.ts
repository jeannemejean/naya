import { describe, it, expect, vi } from "vitest";
import { deplacerProspects, enrolerEnMasse, suspendreCollegues, RAISON_ENTREPRISE_A_REPONDU, RAISON_PROSPECT_DEPLACE, type ProspectEnrolable } from "./prospection-enrolement";

const valide = new Date("2026-10-01T10:00:00Z");

function lead(id: number, over: Partial<ProspectEnrolable> = {}): ProspectEnrolable {
  return { id, stage: "messages_ready", validatedAt: valide, ...over };
}

describe("enrolerEnMasse — la barrière vaut aussi pour l'enrôlement groupé", () => {
  it("n'enrôle que les prospects validés à l'étape messages_ready", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const r = await enrolerEnMasse({
      leads: [
        lead(1),
        lead(2, { validatedAt: null }),
        lead(3, { stage: "identified" }),
        lead(4, { stage: "connection_sent" }),
      ],
      getState: async () => undefined,
      enroll,
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith(1);
    expect(r).toEqual({ enrolled: 1, skipped: 3, skippedNotValidated: 3, total: 4 });
  });

  it("reprend un prospect déjà contacté dont la séquence est en pause", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const r = await enrolerEnMasse({
      leads: [lead(1, { stage: "connection_sent" })],
      getState: async () => ({ status: "paused" }),
      enroll,
    });
    expect(enroll).toHaveBeenCalledWith(1);
    expect(r).toEqual({ enrolled: 1, skipped: 0, skippedNotValidated: 0, total: 1 });
  });

  it("« Lancer pour tous » laisse en pause ce qui y est : une pause a sa raison", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const r = await enrolerEnMasse({
      leads: [lead(1), lead(2, { stage: "connection_sent" })],
      getState: async () => ({ status: "paused" }),
      enroll,
      respecterLesPauses: true,
    });
    expect(enroll).not.toHaveBeenCalled();
    expect(r).toEqual({ enrolled: 0, skipped: 2, skippedNotValidated: 0, total: 2 });
  });

  it("« Lancer pour tous » saute le collègue de quelqu'un qui a répondu", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const r = await enrolerEnMasse({
      leads: [lead(1), lead(2)],
      getState: async () => undefined,
      enroll,
      exclure: (l) => l.id === 1,
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith(2);
    expect(r).toMatchObject({ enrolled: 1, skipped: 1, skippedNotValidated: 0 });
  });

  it("ne ré-enrôle jamais un état actif, terminé ou ayant répondu", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const states: Record<number, { status: string }> = {
      1: { status: "active" },
      2: { status: "stopped_replied" },
      3: { status: "completed" },
      4: { status: "paused" },
    };
    const r = await enrolerEnMasse({
      leads: [lead(1), lead(2), lead(3), lead(4)],
      getState: async (id) => states[id],
      enroll,
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith(4);
    expect(r.enrolled).toBe(1);
    expect(r.skipped).toBe(3);
    expect(r.skippedNotValidated).toBe(0);
  });

  it("ne ré-enrôle jamais un désinscrit ni un prospect qui attend un envoi LinkedIn", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const states: Record<number, { status: string }> = { 1: { status: "unsubscribed" }, 2: { status: "awaiting_linkedin" } };
    const r = await enrolerEnMasse({ leads: [lead(1), lead(2)], getState: async (id) => states[id], enroll });
    expect(enroll).not.toHaveBeenCalled();
    expect(r.skipped).toBe(2);
  });

  it("ne ré-enrôle jamais un prospect écarté pour son public (excluded_audience)", async () => {
    const enroll = vi.fn(async (_id: number) => ({ ok: true }));
    const r = await enrolerEnMasse({
      leads: [lead(1)],
      getState: async () => ({ status: "excluded_audience" }),
      enroll,
    });
    expect(enroll).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it("compte comme ignoré un enrôlement refusé par le stockage", async () => {
    const r = await enrolerEnMasse({
      leads: [lead(1)],
      getState: async () => undefined,
      enroll: async () => undefined,
    });
    expect(r).toEqual({ enrolled: 0, skipped: 1, skippedNotValidated: 0, total: 1 });
  });

  it("une date de validation invalide ne vaut pas validation", async () => {
    const enroll = vi.fn(async (_id: number) => ({}));
    const r = await enrolerEnMasse({
      leads: [lead(1, { validatedAt: new Date("x") })],
      getState: async () => undefined,
      enroll,
    });
    expect(enroll).not.toHaveBeenCalled();
    expect(r.skippedNotValidated).toBe(1);
  });
});

describe("deplacerProspects — la séquence ne continue pas dans l'ancienne campagne", () => {
  const u = "u1";
  function deps(states: Record<number, any>) {
    return {
      getState: vi.fn(async (id: number) => states[id]),
      deplacer: vi.fn(async (ids: number[]) => ids.length),
      suspendre: vi.fn(async (_id: number) => undefined),
    };
  }

  it("met en pause une séquence en cours dans une autre campagne, avant de déplacer", async () => {
    const d = deps({ 1: { userId: u, campaignId: 5, status: "active" }, 2: { userId: u, campaignId: 5, status: "awaiting_linkedin" } });
    const ordre: string[] = [];
    d.suspendre.mockImplementation(async () => { ordre.push("suspendre"); });
    d.deplacer.mockImplementation(async (ids: number[]) => { ordre.push("deplacer"); return ids.length; });
    const r = await deplacerProspects({ ...d, ids: [1, 2], userId: u, campaignId: 9 });
    expect(d.suspendre).toHaveBeenCalledTimes(2);
    expect(d.suspendre).toHaveBeenCalledWith(1);
    expect(d.suspendre).toHaveBeenCalledWith(2);
    expect(ordre).toEqual(["suspendre", "suspendre", "deplacer"]);
    expect(r).toEqual({ moved: 2, suspendus: 2 });
  });

  it("laisse tranquille une séquence déjà dans la campagne cible, terminée ou absente", async () => {
    const d = deps({
      1: { userId: u, campaignId: 9, status: "active" },
      2: { userId: u, campaignId: 5, status: "completed" },
      3: { userId: u, campaignId: 5, status: "stopped_replied" },
      4: undefined,
    });
    const r = await deplacerProspects({ ...d, ids: [1, 2, 3, 4], userId: u, campaignId: 9 });
    expect(d.suspendre).not.toHaveBeenCalled();
    expect(r).toEqual({ moved: 4, suspendus: 0 });
  });

  it("ne touche jamais la séquence d'une autre utilisatrice", async () => {
    const d = deps({ 1: { userId: "autre", campaignId: 5, status: "active" } });
    await deplacerProspects({ ...d, ids: [1], userId: u, campaignId: 9 });
    expect(d.suspendre).not.toHaveBeenCalled();
  });

  it("dit pourquoi la séquence s'est arrêtée", () => {
    expect(RAISON_PROSPECT_DEPLACE).toMatch(/campagne/);
  });
});

describe("suspendreCollegues — une réponse arrête les autres contacts de l'entreprise", () => {
  it("met en pause chaque collègue, raison visible", async () => {
    const suspendre = vi.fn(async () => undefined);
    const n = await suspendreCollegues({ collegues: async () => [2, 3], suspendre });
    expect(n).toBe(2);
    expect(suspendre).toHaveBeenCalledWith(2, RAISON_ENTREPRISE_A_REPONDU);
    expect(suspendre).toHaveBeenCalledWith(3, RAISON_ENTREPRISE_A_REPONDU);
  });

  it("un échec sur un collègue n'empêche pas de suspendre les autres", async () => {
    const suspendre = vi.fn(async (id: number) => { if (id === 2) throw new Error("db"); });
    const n = await suspendreCollegues({ collegues: async () => [2, 3], suspendre });
    expect(suspendre).toHaveBeenCalledTimes(2);
    expect(n).toBe(1);
  });
});
