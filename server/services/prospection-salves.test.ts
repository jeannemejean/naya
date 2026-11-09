import { describe, it, expect, vi } from "vitest";
import {
  bilanDeSalve,
  choisirProspects,
  lancerSalve,
  lireIdsDeSalve,
  planifierSalve,
  type ProspectDeSalve,
} from "./prospection-salves";

const valide = new Date("2026-10-01T10:00:00Z");
const ouvres = new Set(["mon", "tue", "wed", "thu", "fri"]);
// Mardi 10 novembre 2026, 9 h 00 UTC.
const MARDI = new Date("2026-11-10T09:00:00Z");
const fenetre = { debutMin: 9 * 60, finMin: 18 * 60, joursOuvres: ouvres };

const jourDe = (d: Date) => d.toISOString().slice(0, 10);

describe("planifierSalve", () => {
  it("étale les prospects sur plusieurs jours, au rythme demandé", () => {
    const dates = planifierSalve({ nombre: 6, parJour: 2, maintenant: MARDI, nowMin: 9 * 60, jour: "tue", ...fenetre });
    expect(dates).toHaveLength(6);
    expect(dates.map(jourDe)).toEqual(["2026-11-10", "2026-11-10", "2026-11-11", "2026-11-11", "2026-11-12", "2026-11-12"]);
  });

  it("répartit les envois d'une journée au lieu de les grouper", () => {
    const dates = planifierSalve({ nombre: 3, parJour: 3, maintenant: MARDI, nowMin: 9 * 60, jour: "tue", ...fenetre });
    expect(dates.map((d) => d.toISOString().slice(11, 16))).toEqual(["09:00", "12:00", "15:00"]);
  });

  it("saute le week-end", () => {
    const vendredi = new Date("2026-11-13T09:00:00Z");
    const dates = planifierSalve({ nombre: 4, parJour: 2, maintenant: vendredi, nowMin: 9 * 60, jour: "fri", ...fenetre });
    expect(dates.map(jourDe)).toEqual(["2026-11-13", "2026-11-13", "2026-11-16", "2026-11-16"]);
  });

  it("le soir, ou à moins d'une heure de la fin : la salve commence le jour ouvré suivant", () => {
    const soir = new Date("2026-11-10T17:30:00Z");
    const dates = planifierSalve({ nombre: 1, parJour: 5, maintenant: soir, nowMin: 17 * 60 + 30, jour: "tue", ...fenetre });
    expect(dates[0].toISOString()).toBe("2026-11-11T09:00:00.000Z");
  });

  it("n'envoie jamais avant maintenant", () => {
    const midi = new Date("2026-11-10T12:00:00Z");
    const dates = planifierSalve({ nombre: 2, parJour: 2, maintenant: midi, nowMin: 12 * 60, jour: "tue", ...fenetre });
    expect(dates[0].getTime()).toBe(midi.getTime());
  });

  it("aucun jour ouvré ou fenêtre vide : aucun plan plutôt qu'une boucle sans fin", () => {
    expect(planifierSalve({ nombre: 2, parJour: 1, maintenant: MARDI, nowMin: 540, jour: "tue", ...fenetre, joursOuvres: new Set() })).toEqual([]);
    expect(planifierSalve({ nombre: 2, parJour: 1, maintenant: MARDI, nowMin: 540, jour: "tue", ...fenetre, finMin: 9 * 60 })).toEqual([]);
  });
});

const prospect = (id: number, over: Partial<ProspectDeSalve> = {}): ProspectDeSalve => ({
  id, stage: "messages_ready", validatedAt: valide, priority: null, tags: null, createdAt: new Date(2026, 9, id), ...over,
});

describe("choisirProspects", () => {
  const sansEtat = async () => undefined;

  it("ne garde que les prospects validés jamais entrés en séquence", async () => {
    const etats: Record<number, { status: string }> = { 4: { status: "paused" }, 5: { status: "failed" } };
    const r = await choisirProspects({
      leads: [
        prospect(1),
        prospect(2, { validatedAt: null }),
        prospect(3, { stage: "connection_sent" }),
        prospect(4),
        prospect(5),
      ],
      nombre: 10,
      getState: async (id) => etats[id],
    });
    expect(r.map((l) => l.id)).toEqual([1]);
  });

  it("jamais le collègue de quelqu'un qui a répondu", async () => {
    const r = await choisirProspects({ leads: [prospect(1), prospect(2)], nombre: 10, getState: sansEtat, exclure: (l) => l.id === 1 });
    expect(r.map((l) => l.id)).toEqual([2]);
  });

  it("jamais un prospect de test", async () => {
    const r = await choisirProspects({ leads: [prospect(1, { tags: ["lead-test"] })], nombre: 10, getState: sansEtat, exclure: (l) => !!l.tags?.length });
    expect(r).toEqual([]);
  });

  it("avec une sélection explicite, ne prend que ces ids, toujours validés et jamais en séquence", async () => {
    const r = await choisirProspects({
      leads: [prospect(1), prospect(2), prospect(3, { validatedAt: null }), prospect(4)],
      nombre: 10,
      ids: [2, 3, 4, 99],
      getState: async (id) => (id === 4 ? { status: "paused" } : undefined),
    });
    expect(r.map((l) => l.id)).toEqual([2]);
  });

  it("les prospects chauds d'abord, puis les plus anciens, sans dépasser le nombre demandé", async () => {
    const r = await choisirProspects({
      leads: [prospect(3), prospect(1), prospect(2, { priority: "hot" })],
      nombre: 2,
      getState: sansEtat,
    });
    expect(r.map((l) => l.id)).toEqual([2, 1]);
  });
});

describe("lancerSalve", () => {
  const dates = [new Date("2026-11-10T09:00:00Z"), new Date("2026-11-11T09:00:00Z")];

  it("crée la salve et programme chaque prospect à sa date", async () => {
    const enroll = vi.fn(async (_id: number, _o: unknown) => ({ ok: true }));
    const creer = vi.fn(async () => ({ id: 40 }));
    const r = await lancerSalve({ prospects: [prospect(1), prospect(2)], plan: dates, creer, enroll, supprimer: vi.fn() });
    expect(enroll).toHaveBeenCalledWith(1, { salveId: 40, nextRunAt: dates[0] });
    expect(enroll).toHaveBeenCalledWith(2, { salveId: 40, nextRunAt: dates[1] });
    expect(r).toEqual({ salveId: 40, programmes: 2, ignores: 0, premierEnvoi: dates[0], dernierEnvoi: dates[1] });
  });

  it("un prospect refusé (désinscrit) réduit la salve, personne ne le remplace", async () => {
    const enroll = vi.fn(async (id: number, _o: unknown) => (id === 1 ? null : { ok: true }));
    const r = await lancerSalve({ prospects: [prospect(1), prospect(2)], plan: dates, creer: async () => ({ id: 40 }), enroll, supprimer: vi.fn() });
    expect(enroll).toHaveBeenCalledWith(2, { salveId: 40, nextRunAt: dates[0] });
    expect(r).toMatchObject({ programmes: 1, ignores: 1 });
  });

  it("personne à programmer : aucune salve créée", async () => {
    const creer = vi.fn(async () => ({ id: 40 }));
    const r = await lancerSalve({ prospects: [], plan: [], creer, enroll: vi.fn(), supprimer: vi.fn() });
    expect(creer).not.toHaveBeenCalled();
    expect(r).toEqual({ salveId: null, programmes: 0, ignores: 0, premierEnvoi: null, dernierEnvoi: null });
  });

  it("tous refusés : la salve vide ne reste pas dans l'historique", async () => {
    const supprimer = vi.fn(async () => undefined);
    const r = await lancerSalve({ prospects: [prospect(1)], plan: dates, creer: async () => ({ id: 40 }), enroll: async () => null, supprimer });
    expect(supprimer).toHaveBeenCalledWith(40);
    expect(r.salveId).toBeNull();
  });
});

describe("bilanDeSalve", () => {
  const demain = new Date("2026-11-11T09:00:00Z");
  const parti = new Date("2026-11-10T09:00:00Z");

  it("compte ce qui est parti, les réponses, l'attente et les blocages", () => {
    const b = bilanDeSalve([
      { status: "active", lastStepSentAt: parti, repliedAt: null, nextRunAt: demain },
      { status: "stopped_replied", lastStepSentAt: parti, repliedAt: parti, nextRunAt: null },
      { status: "active", lastStepSentAt: null, repliedAt: null, nextRunAt: demain },
      { status: "paused", lastStepSentAt: null, repliedAt: null, nextRunAt: null },
    ]);
    expect(b).toEqual({ prevus: 4, partis: 2, reponses: 1, enAttente: 1, bloques: 1, prochainEnvoi: demain });
  });

  it("sans prospect : tout à zéro", () => {
    expect(bilanDeSalve([])).toEqual({ prevus: 0, partis: 0, reponses: 0, enAttente: 0, bloques: 0, prochainEnvoi: null });
  });
});

describe("lireIdsDeSalve", () => {
  it("absent : pas de sélection ; valide : dédoublonnée ; illisible ou > 100 : refusée", () => {
    expect(lireIdsDeSalve(undefined)).toBeUndefined();
    expect(lireIdsDeSalve([3, "4", 3])).toEqual([3, 4]);
    expect(lireIdsDeSalve([])).toBeNull();
    expect(lireIdsDeSalve([1.5])).toBeNull();
    expect(lireIdsDeSalve("1,2")).toBeNull();
    expect(lireIdsDeSalve(Array.from({ length: 101 }, (_, i) => i + 1))).toBeNull();
  });
});
