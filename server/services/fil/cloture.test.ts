// Clôture du vendredi et réconciliation du lundi. Toutes les sources sont injectées : aucun test
// ne touche une vraie base ni le réseau (la base est en plus mockée, par sécurité).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@shared/schema";

vi.mock("../../db", () => ({ db: {}, pool: {} }));

import {
  aTrancher, clotureDuVendredi, poserTacheDeCloture, trancher, demandeTrancher, reconciliation,
  clotureEnCache, reconciliationEnCache, viderCachesCloture, oublierClotureDe, titreCloture,
  type DepsCloture, type DepsTrancher, type DepsReconciliation,
} from "./cloture";

// Jeudi 12, vendredi 13, lundi 16, mardi 17 novembre 2026, 8 h à Paris.
const JEUDI = new Date("2026-11-12T07:00:00Z");
const VENDREDI = new Date("2026-11-13T07:00:00Z");
const LUNDI = new Date("2026-11-16T07:00:00Z");
const MARDI = new Date("2026-11-17T07:00:00Z");

const tache = (id: number, creeeLe: string, extra: Partial<Task> = {}): Task => ({
  id, userId: "u1", projectId: 10, title: `Tâche ${id}`, type: "planning", category: "planning", priority: 3,
  completed: false, archivedAt: null, scheduledDate: "2026-11-10", goalId: null, milestoneId: null, ritualId: null,
  schedulingMode: "flexible", source: "manual", createdAt: new Date(creeeLe), ...extra,
} as unknown as Task);

describe("aTrancher", () => {
  it("vendredi : une tâche ouverte depuis 8 jours est listée, une à 7 ne l'est pas", () => {
    const r = aTrancher([
      tache(1, "2026-11-05T10:00:00Z"), // jeudi 5 : 8 jours
      tache(2, "2026-11-06T10:00:00Z"), // vendredi 6 : 7 jours
    ], VENDREDI);
    expect(r).toEqual([{ tacheId: 1, titre: "Tâche 1", ouverteDepuis: 8 }]);
  });

  it("le jour compte à Paris : créée le 5 à 23 h 30 (Paris), c'est le 5", () => {
    // 22 h 30 UTC le 5 = 23 h 30 à Paris le 5 → 8 jours ; 23 h 30 UTC le 5 = le 6 à Paris → 7 jours.
    expect(aTrancher([tache(1, "2026-11-05T22:30:00Z")], VENDREDI).map((t) => t.tacheId)).toEqual([1]);
    expect(aTrancher([tache(1, "2026-11-05T23:30:00Z")], VENDREDI)).toEqual([]);
  });

  it("jeudi (ou tout autre jour) : []", () => {
    expect(aTrancher([tache(1, "2026-10-01T10:00:00Z")], JEUDI)).toEqual([]);
    expect(aTrancher([tache(1, "2026-10-01T10:00:00Z")], LUNDI)).toEqual([]);
  });

  it("jamais : faites, archivées, rituels, marqueurs de jalon, heure fixe, la tâche de clôture elle-même", () => {
    const vieux = "2026-10-01T10:00:00Z";
    const r = aTrancher([
      tache(1, vieux, { completed: true }),
      tache(2, vieux, { archivedAt: new Date() } as any),
      tache(3, vieux, { ritualId: 4 } as any),
      tache(4, vieux, { type: "milestone" }),
      tache(5, vieux, { schedulingMode: "fixed" }),
      tache(6, vieux, { source: "fil_cloture" }),
      tache(7, vieux, { createdAt: null } as any),
      tache(8, vieux),
    ], VENDREDI);
    expect(r.map((t) => t.tacheId)).toEqual([8]);
  });

  it("prévue après aujourd'hui : pas à trancher (déjà placée) ; prévue aujourd'hui, avant ou sans date : oui", () => {
    const vieux = "2026-11-03T10:00:00Z"; // 10 jours
    const r = aTrancher([
      tache(1, vieux, { scheduledDate: "2026-11-18" }), // la semaine prochaine
      tache(2, vieux, { scheduledDate: "2026-11-14" }), // demain
      tache(3, vieux, { scheduledDate: "2026-11-13" }), // aujourd'hui
      tache(4, vieux, { scheduledDate: "2026-10-28" }), // en retard
      tache(5, vieux, { scheduledDate: null }),
    ], VENDREDI);
    expect(r.map((t) => t.tacheId)).toEqual([3, 4, 5]);
  });

  it("déjà tranchée cette semaine : sortie de la liste ; tranchée une semaine passée : elle revient", () => {
    const vieux = "2026-10-20T10:00:00Z";
    const r = aTrancher([
      tache(1, vieux, { actionData: { cloture: { tranchee: "2026-11-09" } } } as any),
      tache(2, vieux, { actionData: { cloture: { tranchee: "2026-11-02" } } } as any),
    ], VENDREDI);
    expect(r.map((t) => t.tacheId)).toEqual([2]);
  });

  it("les plus anciennes d'abord", () => {
    const r = aTrancher([tache(1, "2026-11-01T10:00:00Z"), tache(2, "2026-10-01T10:00:00Z"), tache(3, "2026-11-01T10:00:00Z")], VENDREDI);
    expect(r.map((t) => t.tacheId)).toEqual([2, 1, 3]);
  });
});

function depsCloture(over: Partial<DepsCloture> = {}): DepsCloture & { [k: string]: any } {
  return {
    tachesOuvertes: vi.fn(async () => [tache(1, "2026-11-01T10:00:00Z"), tache(2, "2026-10-20T10:00:00Z"), tache(3, "2026-11-12T10:00:00Z")]),
    clotureDejaPosee: vi.fn(async () => false),
    creerTache: vi.fn(async (_u: string, d: any) => ({ ok: true as const, tache: { id: 99, ...d } as Task })),
    ...over,
  } as any;
}

describe("clotureDuVendredi", () => {
  it("vendredi : lit les tâches créées avant le début du jour (Paris) d'il y a 7 jours", async () => {
    const d = depsCloture();
    expect((await clotureDuVendredi("u1", VENDREDI, d)).map((t) => t.tacheId)).toEqual([2, 1]);
    // Début du 6 novembre à Paris = 5 novembre 23 h UTC.
    expect(d.tachesOuvertes).toHaveBeenCalledWith("u1", new Date("2026-11-05T23:00:00Z"), "2026-11-13");
  });
  it("un autre jour : [], sans rien lire", async () => {
    const d = depsCloture();
    expect(await clotureDuVendredi("u1", JEUDI, d)).toEqual([]);
    expect(d.tachesOuvertes).not.toHaveBeenCalled();
  });
});

describe("poserTacheDeCloture", () => {
  it("vendredi : une tâche de 15 min « Trancher les {n} tâches ouvertes », aujourd'hui, sans objectif, une fois par semaine", async () => {
    const d = depsCloture();
    const r = await poserTacheDeCloture("u1", VENDREDI, d);
    expect(r).toEqual({ creee: true, n: 2 });
    expect(d.clotureDejaPosee).toHaveBeenCalledWith("u1", "2026-11-09");
    expect(d.creerTache).toHaveBeenCalledTimes(1);
    const [userId, donnees] = d.creerTache.mock.calls[0];
    expect(userId).toBe("u1");
    expect(donnees).toMatchObject({
      title: "Trancher les 2 tâches ouvertes", estimatedDuration: 15, scheduledDate: "2026-11-13",
      source: "fil_cloture", goalId: null, milestoneId: null, projectId: null, completed: false,
      actionData: { cloture: { semaine: "2026-11-09" }, lien: "/" },
    });
  });

  it("déjà posée cette semaine (même après un redémarrage) : rien de plus", async () => {
    const d = depsCloture({ clotureDejaPosee: vi.fn(async () => true) });
    expect(await poserTacheDeCloture("u1", VENDREDI, d)).toEqual({ creee: false, n: 2 });
    expect(d.creerTache).not.toHaveBeenCalled();
  });

  it("rien à trancher : aucune tâche", async () => {
    const d = depsCloture({ tachesOuvertes: vi.fn(async () => []) });
    expect(await poserTacheDeCloture("u1", VENDREDI, d)).toEqual({ creee: false, n: 0 });
    expect(d.creerTache).not.toHaveBeenCalled();
  });

  it("un autre jour que le vendredi : rien lu, rien créé", async () => {
    const d = depsCloture();
    expect(await poserTacheDeCloture("u1", JEUDI, d)).toEqual({ creee: false, n: 0 });
    expect(d.tachesOuvertes).not.toHaveBeenCalled();
    expect(d.creerTache).not.toHaveBeenCalled();
  });

  it("création refusée (vendredi non travaillé) : rien de créé, pas d'erreur", async () => {
    const d = depsCloture({ creerTache: vi.fn(async () => ({ ok: false as const, status: 400, message: "Friday is not one of your work days." })) });
    expect(await poserTacheDeCloture("u1", VENDREDI, d)).toEqual({ creee: false, n: 2 });
  });

  it("titre : singulier pour une seule tâche", () => {
    expect(titreCloture(1)).toBe("Trancher la tâche ouverte");
    expect(titreCloture(4)).toBe("Trancher les 4 tâches ouvertes");
  });
});

describe("trancher", () => {
  function depsTrancher(over: Partial<DepsTrancher> = {}): DepsTrancher & { [k: string]: any } {
    return {
      lireTache: vi.fn(async (userId: string, id: number) => (userId === "u1" && id === 5 ? tache(5, "2026-10-01T10:00:00Z") : undefined)),
      modifierTache: vi.fn(async (_u: string, id: number, patch: any) => ({ ok: true as const, tache: { ...tache(id, "2026-10-01T10:00:00Z"), ...patch }, avant: tache(id, "2026-10-01T10:00:00Z") })),
      archiverTache: vi.fn(async (_u: string, id: number) => ({ ok: true as const, tache: { ...tache(id, "2026-10-01T10:00:00Z"), archivedAt: VENDREDI } as Task })),
      marquerTranchee: vi.fn(async () => {}),
      ...over,
    } as any;
  }

  it("faire : la tâche passe à aujourd'hui (Paris), par modifierTache", async () => {
    const d = depsTrancher();
    const r = await trancher("u1", { tacheId: 5, geste: "faire" }, VENDREDI, d);
    expect(r.ok).toBe(true);
    expect(d.modifierTache).toHaveBeenCalledWith("u1", 5, { scheduledDate: "2026-11-13", scheduledTime: null, scheduledEndTime: null });
    expect(d.archiverTache).not.toHaveBeenCalled();
    expect(d.marquerTranchee).toHaveBeenCalledWith("u1", 5, "2026-11-09");
  });

  it("faire puis recalcul : la tâche sort de la liste de ce vendredi ; encore ouverte le vendredi suivant, elle revient", async () => {
    // Une petite base en mémoire : la tâche telle que les gestes la laissent.
    let t = tache(5, "2026-10-01T10:00:00Z");
    const d = depsTrancher({
      lireTache: vi.fn(async () => t),
      modifierTache: vi.fn(async (_u: string, _id: number, patch: any) => { t = { ...t, ...patch }; return { ok: true as const, tache: t, avant: t }; }),
      marquerTranchee: vi.fn(async (_u: string, _id: number, semaine: string) => {
        t = { ...t, actionData: { ...(t.actionData as any), cloture: { tranchee: semaine } } } as Task;
      }),
    });
    const ouvertes = depsCloture({ tachesOuvertes: vi.fn(async () => [t]) });
    expect((await clotureDuVendredi("u1", VENDREDI, ouvertes)).map((x) => x.tacheId)).toEqual([5]);
    await trancher("u1", { tacheId: 5, geste: "faire" }, VENDREDI, d);
    expect(t.scheduledDate).toBe("2026-11-13");
    expect(await clotureDuVendredi("u1", VENDREDI, ouvertes)).toEqual([]);
    const vendrediSuivant = new Date("2026-11-20T07:00:00Z");
    expect((await clotureDuVendredi("u1", vendrediSuivant, ouvertes)).map((x) => x.tacheId)).toEqual([5]);
  });

  it("une marque ratée ne fait pas échouer le geste (consignée)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = depsTrancher({ marquerTranchee: vi.fn(async () => { throw new Error("base"); }) });
    expect((await trancher("u1", { tacheId: 5, geste: "faire" }, VENDREDI, d)).ok).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("déplacer : la date donnée ; une date passée ou absente est refusée", async () => {
    const d = depsTrancher();
    expect((await trancher("u1", { tacheId: 5, geste: "deplacer", date: "2026-11-20" }, VENDREDI, d)).ok).toBe(true);
    expect(d.modifierTache).toHaveBeenCalledWith("u1", 5, { scheduledDate: "2026-11-20", scheduledTime: null, scheduledEndTime: null });
    d.modifierTache.mockClear();
    expect(await trancher("u1", { tacheId: 5, geste: "deplacer", date: "2026-11-12" }, VENDREDI, d)).toEqual({ ok: false, status: 400, message: "date_passee" });
    expect(await trancher("u1", { tacheId: 5, geste: "deplacer" }, VENDREDI, d)).toEqual({ ok: false, status: 400, message: "date_requise" });
    expect(d.modifierTache).not.toHaveBeenCalled();
  });

  it("abandonner : la tâche est archivée (archivedAt), jamais supprimée ni modifiée autrement", async () => {
    const d = depsTrancher();
    const r = await trancher("u1", { tacheId: 5, geste: "abandonner" }, VENDREDI, d);
    expect(r).toMatchObject({ ok: true, tache: { id: 5, archivedAt: VENDREDI } });
    expect(d.archiverTache).toHaveBeenCalledWith("u1", 5);
    expect(d.marquerTranchee).toHaveBeenCalledWith("u1", 5, "2026-11-09");
    expect(d.modifierTache).not.toHaveBeenCalled();
    expect(Object.keys(d)).not.toContain("supprimerTache");
  });

  it("la tâche d'une autre (ou inconnue) : 404, rien d'écrit ; déjà faite ou archivée : 409", async () => {
    const d = depsTrancher();
    expect(await trancher("u2", { tacheId: 5, geste: "abandonner" }, VENDREDI, d)).toEqual({ ok: false, status: 404, message: "task_not_found" });
    expect(await trancher("u1", { tacheId: 6, geste: "faire" }, VENDREDI, d)).toEqual({ ok: false, status: 404, message: "task_not_found" });
    d.lireTache.mockResolvedValue(tache(5, "2026-10-01T10:00:00Z", { completed: true }));
    expect(await trancher("u1", { tacheId: 5, geste: "faire" }, VENDREDI, d)).toEqual({ ok: false, status: 409, message: "deja_tranchee" });
    d.lireTache.mockResolvedValue(tache(5, "2026-10-01T10:00:00Z", { archivedAt: new Date() } as any));
    expect(await trancher("u1", { tacheId: 5, geste: "abandonner" }, VENDREDI, d)).toEqual({ ok: false, status: 409, message: "deja_tranchee" });
    expect(d.modifierTache).not.toHaveBeenCalled();
    expect(d.archiverTache).not.toHaveBeenCalled();
    expect(d.marquerTranchee).not.toHaveBeenCalled();
  });

  it("un refus de modifierTache (jour non travaillé) remonte tel quel", async () => {
    const d = depsTrancher({ modifierTache: vi.fn(async () => ({ ok: false as const, status: 400, message: "Saturday is not one of your work days." })) });
    expect(await trancher("u1", { tacheId: 5, geste: "deplacer", date: "2026-11-14" }, VENDREDI, d))
      .toEqual({ ok: false, status: 400, message: "Saturday is not one of your work days." });
  });

  it("demandeTrancher (zod) : geste, identifiant et date valides seulement", () => {
    expect(demandeTrancher.safeParse({ tacheId: 5, geste: "faire" }).success).toBe(true);
    expect(demandeTrancher.safeParse({ tacheId: 5, geste: "deplacer", date: "2026-11-20" }).success).toBe(true);
    expect(demandeTrancher.safeParse({ tacheId: 5, geste: "supprimer" }).success).toBe(false);
    expect(demandeTrancher.safeParse({ tacheId: -1, geste: "faire" }).success).toBe(false);
    expect(demandeTrancher.safeParse({ tacheId: "5", geste: "faire" }).success).toBe(false);
    expect(demandeTrancher.safeParse({ tacheId: 5, geste: "deplacer", date: "20/11/2026" }).success).toBe(false);
    expect(demandeTrancher.safeParse({ tacheId: 5, geste: "deplacer", date: "2026-02-31" }).success).toBe(false);
  });
});

function depsReco(over: Partial<DepsReconciliation> = {}): DepsReconciliation & { [k: string]: any } {
  return {
    conversationsATraiter: vi.fn(async () => []),
    appelsOffres: vi.fn(async () => []),
    posts: vi.fn(async () => []),
    tachesDeProduction: vi.fn(async () => []),
    mailsSansTache: vi.fn(async () => []),
    ...over,
  } as any;
}

describe("reconciliation", () => {
  const conv = (id: number, extra: any = {}) => ({ id, nom: `Prospect ${id}`, canal: "linkedin", taskId: null, tache: null, dernierSens: "entrant", ...extra });

  it("lundi : une réponse de prospect sans tâche est listée, avec le lien vers Réponses", async () => {
    const d = depsReco({ conversationsATraiter: vi.fn(async () => [conv(7)]) });
    expect(await reconciliation("u1", LUNDI, d)).toEqual([{
      source: "reponses",
      libelle: "Réponse de Prospect 7 (LinkedIn) à traiter : aucune tâche pour s'en occuper",
      lien: "/outreach?onglet=reponses&conversation=7",
    }]);
  });

  it("mardi (et tout autre jour) : [], sans rien lire", async () => {
    const d = depsReco({ conversationsATraiter: vi.fn(async () => [conv(7)]) });
    expect(await reconciliation("u1", MARDI, d)).toEqual([]);
    expect(await reconciliation("u1", VENDREDI, d)).toEqual([]);
    expect(d.conversationsATraiter).not.toHaveBeenCalled();
  });

  it("réponses : tâche faite sans réponse envoyée listée ; tâche ouverte ou réponse partie : rien ; tâche supprimée ou archivée = sans tâche", async () => {
    const d = depsReco({ conversationsATraiter: vi.fn(async () => [
      conv(1, { taskId: 11, tache: { completed: true, archivedAt: null }, dernierSens: "entrant", canal: "email" }),
      conv(2, { taskId: 12, tache: { completed: true, archivedAt: null }, dernierSens: "sortant" }),
      conv(3, { taskId: 13, tache: { completed: false, archivedAt: null } }),
      conv(4, { taskId: 14, tache: null }),
      conv(5, { taskId: 15, tache: { completed: false, archivedAt: new Date() } }),
      conv(6, { nom: null }),
      conv(8, { dernierSens: "sortant" }),
    ]) });
    const r = await reconciliation("u1", LUNDI, d);
    expect(r.map((x) => x.libelle)).toEqual([
      "Réponse de Prospect 1 (e-mail) : tâche cochée, aucune réponse envoyée",
      "Réponse de Prospect 4 (LinkedIn) à traiter : aucune tâche pour s'en occuper",
      "Réponse de Prospect 5 (LinkedIn) à traiter : aucune tâche pour s'en occuper",
      "Réponse d'un prospect (LinkedIn) à traiter : aucune tâche pour s'en occuper",
      "Réponse de Prospect 8 (LinkedIn) : marquée à traiter alors que tu as répondu",
    ]);
  });

  it("appels d'offres : score fort encore « repéré » ou « premier jet prêt », date limite à venir, non écarté par la veille", async () => {
    const ao = (id: number, extra: any = {}) => ({
      id, objet: `Marché ${id}`, acheteur: "Ville de Lyon", scoreAdequation: "fort", statut: "repere",
      dateLimite: new Date("2026-12-01T22:59:00Z"), bloquants: null, source: "boamp", ...extra,
    });
    const d = depsReco({ appelsOffres: vi.fn(async () => [
      ao(1),
      ao(2, { statut: "premier_jet_pret", acheteur: null, dateLimite: null }),
      ao(3, { scoreAdequation: "moyen" }),
      ao(4, { statut: "en_redaction" }),
      ao(5, { dateLimite: new Date("2026-11-10T10:00:00Z") }),
      ao(6, { bloquants: "• À écarter, hors périmètre : marché de travaux" }),
    ]) });
    const r = await reconciliation("u1", LUNDI, d);
    expect(r).toEqual([
      { source: "appels_offres", libelle: "Appel d'offres « Marché 1 » (Ville de Lyon) : score fort, sans décision (date limite le mardi 1 décembre)", lien: "/appels-offres" },
      { source: "appels_offres", libelle: "Appel d'offres « Marché 2 » : score fort, sans décision", lien: "/appels-offres" },
    ]);
  });

  it("posts à valider sans tâche d'atelier ouverte (ni tâche du post) : listés avec le lien de l'atelier de leur semaine", async () => {
    const post = (id: number, scheduledFor: string, extra: any = {}) => ({
      id, title: `Post ${id}`, platform: "instagram", scheduledFor: new Date(scheduledFor), publishedAt: null,
      postStatus: "scheduled", contentStatus: "draft", autoPost: false, consigne: null, campaignId: 1, body: null, tendanceProjetId: null, ...extra,
    });
    const d = depsReco({
      posts: vi.fn(async () => [
        post(1, "2026-11-18T09:00:00Z"),                          // semaine du 16, aucun atelier ouvert
        post(2, "2026-11-25T09:00:00Z"),                          // semaine du 23, atelier ouvert
        post(3, "2026-11-19T09:00:00Z"),                          // tâche propre au post
        post(4, "2026-11-19T09:00:00Z", { contentStatus: "ready" }), // validé
      ]),
      tachesDeProduction: vi.fn(async () => [{ semaine: "2026-11-23", contentId: null }, { semaine: null, contentId: 3 }]),
    });
    const r = await reconciliation("u1", LUNDI, d);
    expect(r).toEqual([{
      source: "posts", libelle: "Post « Post 1 » (Instagram, mercredi 18 novembre) à valider : aucune tâche d'atelier", lien: "/atelier?semaine=2026-11-16",
    }]);
    const [, debut, fin] = d.posts.mock.calls[0];
    expect(debut).toEqual(new Date("2026-11-15T23:00:00Z")); // minuit à Paris
    expect(fin.getTime() - LUNDI.getTime()).toBe(14 * 24 * 3600_000);
    expect(d.tachesDeProduction).toHaveBeenCalledWith("u1", ["2026-11-16", "2026-11-23"], [1, 2, 3]);
  });

  it("mails en attente dont la tâche a disparu : listés (les tâches seulement cochées ne remontent pas de la source)", async () => {
    const d = depsReco({ mailsSansTache: vi.fn(async () => [{ threadId: "t1", expediteur: "marc@acme.fr", sujet: "Devis" }, { threadId: "t2", expediteur: null, sujet: null }]) });
    const r = await reconciliation("u1", LUNDI, d);
    expect(r).toEqual([
      { source: "mails", libelle: "Mail de marc@acme.fr (« Devis ») : sa tâche « Répondre » a été supprimée", lien: "/planning" },
      { source: "mails", libelle: "Mail d'un expéditeur inconnu : sa tâche « Répondre » a été supprimée", lien: "/planning" },
    ]);
    const [, depuis] = d.mailsSansTache.mock.calls[0];
    expect(LUNDI.getTime() - depuis.getTime()).toBe(14 * 24 * 3600_000);
  });

  it("une source en panne n'empêche pas les autres", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = depsReco({
      appelsOffres: vi.fn(async () => { throw new Error("base"); }),
      conversationsATraiter: vi.fn(async () => [conv(7)]),
    });
    expect((await reconciliation("u1", LUNDI, d)).map((x) => x.source)).toEqual(["reponses"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("caches du matin (20 min par utilisatrice et jour de Paris)", () => {
  beforeEach(() => viderCachesCloture());

  it("clôture : un seul calcul dans les 20 min ; oublié après un geste ; recalculé après 20 min", async () => {
    const calc = vi.fn(async () => [{ tacheId: 1, titre: "x", ouverteDepuis: 9 }]);
    await clotureEnCache("u1", VENDREDI, calc);
    await clotureEnCache("u1", new Date(VENDREDI.getTime() + 10 * 60_000), calc);
    expect(calc).toHaveBeenCalledTimes(1);
    oublierClotureDe("u1");
    await clotureEnCache("u1", new Date(VENDREDI.getTime() + 11 * 60_000), calc);
    expect(calc).toHaveBeenCalledTimes(2);
    await clotureEnCache("u1", new Date(VENDREDI.getTime() + 40 * 60_000), calc);
    expect(calc).toHaveBeenCalledTimes(3);
  });

  it("réconciliation : un échec n'est pas gardé", async () => {
    const calc = vi.fn()
      .mockRejectedValueOnce(new Error("base"))
      .mockResolvedValue([]);
    await expect(reconciliationEnCache("u1", LUNDI, calc)).rejects.toThrow("base");
    await Promise.resolve();
    await reconciliationEnCache("u1", LUNDI, calc);
    expect(calc).toHaveBeenCalledTimes(2);
  });
});
