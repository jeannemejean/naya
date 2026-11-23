// server/routes-vie-perso.ts — option Vie perso (spec 2026-11-23). Tout passe par req.userId ;
// une utilisatrice sans l'option (VIE_PERSO_USERS) reçoit 404 partout sauf sur /etat.
import type { Express } from "express";
import { z } from "zod/v4";
import { isAuthenticated } from "./auth";
import { lundiDe, REPAS, type ProfilViePerso, type Repas } from "@shared/vie-perso";
import {
  changerRepas, decouperActivite, planifierActivite, preparerPlan, validerPlan, type DepsViePerso,
} from "./services/vie-perso/service";

type EtatPreparation = { semaine: string; statut: "en_cours" | "fini" | "erreur"; erreur?: string };

export interface OptionsRoutesViePerso {
  deps: DepsViePerso;
  store: import("./services/vie-perso/deps").StoreViePerso;
  activePour(userId: string): boolean;
  iaBloquee(userId: string): Promise<boolean>;
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const JOUR = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const liste = z.array(z.string().trim().min(1).max(120)).max(40);

export const SCHEMA_PROFIL = z.object({
  soirDebut: HHMM, soirFin: HHMM, weekendDebut: HHMM, weekendFin: HHMM,
  heureDejeuner: HHMM, heureDiner: HHMM,
  batchJour: z.number().int().min(0).max(6), batchHeure: HHMM, batchDureeMax: z.number().int().min(15).max(300),
  coursesJour: z.number().int().min(0).max(6), coursesHeure: HHMM, coursesDuree: z.number().int().min(15).max(240),
  jeune: z.string().max(200),
  equipement: liste, magasins: liste, placard: z.array(z.string().trim().min(1).max(120)).max(100),
  dernieresRegles: JOUR.nullable(), dureeCycle: z.number().int().min(20).max(45).nullable(),
}).refine((p) => p.soirDebut < p.soirFin && p.weekendDebut < p.weekendFin, { message: "fenetre_invalide" });

const court = (n: number) => z.string().trim().max(n);
const SCHEMA_MEMBRE = z.object({
  prenom: court(60).min(1), estMoi: z.boolean().default(false),
  regime: court(500).default(""), exclusions: court(500).default(""), aime: court(500).default(""), aimePas: court(500).default(""),
  repasMaison: z.enum(["dejeuner", "diner", "les_deux"]).default("les_deux"),
});
const SCHEMA_RECETTE = z.object({
  titre: court(200).min(1),
  lien: z.string().trim().max(1000).url().nullable().default(null),
  notes: court(500).nullable().default(null),
  avis: z.enum(["aime", "bof", "non"]).default("aime"),
});
const SCHEMA_ACTIVITE_ENTREE = z.object({
  titre: court(160).min(1), description: court(2000).default(""), avecQui: court(200).default(""),
  quand: z.enum(["soir", "weekend", "indifferent"]).default("indifferent"),
  dateCible: JOUR.nullable().default(null),
});

const idValide = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : null);
const semaineValide = (s: string) => (JOUR.safeParse(s).success && lundiDe(s) === s ? s : null);

export async function optionsParDefaut(): Promise<OptionsRoutesViePerso> {
  const [{ depsViePerso, storeViePerso, viePersoActivePour }, { isAiBlocked }] = await Promise.all([
    import("./services/vie-perso/deps"), import("./services/usage"),
  ]);
  return { deps: depsViePerso, store: storeViePerso, activePour: (u) => viePersoActivePour(u), iaBloquee: isAiBlocked };
}

export function registerViePersoRoutes(app: Express, opts?: OptionsRoutesViePerso) {
  let charge: Promise<OptionsRoutesViePerso> | null = opts ? Promise.resolve(opts) : null;
  const o = () => (charge ??= optionsParDefaut());

  const sur = (h: (req: any, res: any, x: OptionsRoutesViePerso) => Promise<any>) => async (req: any, res: any) => {
    try {
      const x = await o();
      if (!x.activePour(req.userId)) return res.status(404).json({ message: "not_found" });
      await h(req, res, x);
    } catch (e: any) {
      console.error("[vie-perso]", e?.message ?? e);
      if (!res.headersSent) res.status(500).json({ message: String(e?.message ?? "").startsWith("structure_invalide") ? "generation_invalide" : "erreur" });
    }
  };
  const invalide = (res: any, e: z.ZodError) => res.status(400).json({ message: "invalide", details: e.issues.map((i) => i.path.join(".")) });

  app.get("/api/vie-perso/etat", isAuthenticated, async (req: any, res) => {
    try { res.json({ active: (await o()).activePour(req.userId) }); } catch { res.json({ active: false }); }
  });

  // ─── Réglages, foyer, inspirations ─────────────────────────────────────────────
  app.get("/api/vie-perso/profil", isAuthenticated, sur(async (req, res, x) => {
    const [profil, membres, recettes] = await Promise.all([x.deps.profil(req.userId), x.deps.membres(req.userId), x.deps.recettes(req.userId)]);
    res.json({ profil, membres, recettes });
  }));
  app.put("/api/vie-perso/profil", isAuthenticated, sur(async (req, res, x) => {
    const p = SCHEMA_PROFIL.safeParse(req.body);
    if (!p.success) return invalide(res, p.error);
    await x.store.ecrireProfil(req.userId, p.data as ProfilViePerso);
    res.json(p.data);
  }));

  app.post("/api/vie-perso/membres", isAuthenticated, sur(async (req, res, x) => {
    const p = SCHEMA_MEMBRE.safeParse(req.body);
    if (!p.success) return invalide(res, p.error);
    res.status(201).json(await x.store.ajouterMembre(req.userId, p.data));
  }));
  app.put("/api/vie-perso/membres/:id", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    const p = SCHEMA_MEMBRE.safeParse(req.body);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    if (!p.success) return invalide(res, p.error);
    const l = await x.store.modifierMembre(req.userId, id, p.data);
    return l ? res.json(l) : res.status(404).json({ message: "not_found" });
  }));
  app.delete("/api/vie-perso/membres/:id", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    return (await x.store.supprimerMembre(req.userId, id)) ? res.status(204).end() : res.status(404).json({ message: "not_found" });
  }));

  app.post("/api/vie-perso/recettes", isAuthenticated, sur(async (req, res, x) => {
    const p = SCHEMA_RECETTE.safeParse(req.body);
    if (!p.success) return invalide(res, p.error);
    res.status(201).json(await x.store.ajouterRecette(req.userId, p.data));
  }));
  app.patch("/api/vie-perso/recettes/:id", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    const p = SCHEMA_RECETTE.partial().safeParse(req.body);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    if (!p.success) return invalide(res, p.error);
    const l = await x.store.modifierRecette(req.userId, id, p.data);
    return l ? res.json(l) : res.status(404).json({ message: "not_found" });
  }));
  app.delete("/api/vie-perso/recettes/:id", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    return (await x.store.supprimerRecette(req.userId, id)) ? res.status(204).end() : res.status(404).json({ message: "not_found" });
  }));

  // ─── Plan de la semaine ────────────────────────────────────────────────────────
  // 1 à 2 minutes de génération : 202 tout de suite, la page interroge l'état. Une préparation à
  // la fois par utilisatrice ; un redémarrage oublie l'état (« aucun »).
  const preparations = new Map<string, EtatPreparation>();

  app.get("/api/vie-perso/plans/:semaine", isAuthenticated, sur(async (req, res, x) => {
    const semaine = semaineValide(req.params.semaine);
    if (!semaine) return res.status(400).json({ message: "semaine_invalide" });
    const e = preparations.get(req.userId);
    res.json({ plan: await x.deps.lirePlan(req.userId, semaine), preparation: e?.semaine === semaine ? e : null });
  }));

  app.post("/api/vie-perso/plans/:semaine/preparer", isAuthenticated, sur(async (req, res, x) => {
    const userId: string = req.userId;
    const semaine = semaineValide(req.params.semaine);
    if (!semaine) return res.status(400).json({ message: "semaine_invalide" });
    if (preparations.get(userId)?.statut === "en_cours") return res.status(409).json({ message: "preparation_en_cours" });
    if (await x.iaBloquee(userId)) return res.status(402).json({ message: "ia_bloquee" });
    const etat: EtatPreparation = { semaine, statut: "en_cours" };
    preparations.set(userId, etat);
    preparerPlan(userId, semaine, x.deps)
      .then((r) => preparations.set(userId, r.ok ? { semaine, statut: "fini" } : { semaine, statut: "erreur", erreur: r.erreur }))
      .catch((e: any) => {
        console.error("[vie-perso] préparation :", e?.message ?? e);
        preparations.set(userId, { semaine, statut: "erreur", erreur: "preparation_echec" });
      });
    res.status(202).json(etat);
  }));

  app.post("/api/vie-perso/plans/:semaine/repas", isAuthenticated, sur(async (req, res, x) => {
    const semaine = semaineValide(req.params.semaine);
    const p = z.object({ jour: JOUR, repas: z.enum(REPAS), demande: z.string().max(500).nullable().default(null) }).safeParse(req.body);
    if (!semaine) return res.status(400).json({ message: "semaine_invalide" });
    if (!p.success) return invalide(res, p.error);
    if (await x.iaBloquee(req.userId)) return res.status(402).json({ message: "ia_bloquee" });
    const r = await changerRepas(req.userId, semaine, p.data.jour, p.data.repas as Repas, p.data.demande, x.deps);
    if (!r.ok) return res.status(r.erreur === "plan_introuvable" ? 404 : 400).json({ message: r.erreur });
    res.json(await x.deps.lirePlan(req.userId, semaine));
  }));

  app.post("/api/vie-perso/plans/:semaine/valider", isAuthenticated, sur(async (req, res, x) => {
    const semaine = semaineValide(req.params.semaine);
    if (!semaine) return res.status(400).json({ message: "semaine_invalide" });
    const r = await validerPlan(req.userId, semaine, x.deps);
    if (!r.ok) return res.status(404).json({ message: r.erreur });
    res.json({ taches: r.taches });
  }));

  app.patch("/api/vie-perso/plans/:semaine/courses", isAuthenticated, sur(async (req, res, x) => {
    const semaine = semaineValide(req.params.semaine);
    const p = z.object({ index: z.number().int().min(0).max(500), coche: z.boolean() }).safeParse(req.body);
    if (!semaine) return res.status(400).json({ message: "semaine_invalide" });
    if (!p.success) return invalide(res, p.error);
    const plan = await x.deps.lirePlan(req.userId, semaine);
    if (!plan) return res.status(404).json({ message: "plan_introuvable" });
    if (p.data.index >= plan.contenu.courses.length) return res.status(400).json({ message: "index_invalide" });
    const coches = new Set(plan.coches);
    if (p.data.coche) coches.add(p.data.index); else coches.delete(p.data.index);
    const liste = Array.from(coches).sort((a, b) => a - b);
    await x.store.ecrireCoches(req.userId, semaine, liste);
    res.json({ coches: liste });
  }));

  // ─── Activités ─────────────────────────────────────────────────────────────────
  app.get("/api/vie-perso/activites", isAuthenticated, sur(async (req, res, x) => {
    res.json(await x.store.listerActivites(req.userId));
  }));

  /** Crée l'activité puis la découpe (achats, étapes) ; l'activité reste même si le découpage échoue. */
  app.post("/api/vie-perso/activites", isAuthenticated, sur(async (req, res, x) => {
    const p = SCHEMA_ACTIVITE_ENTREE.safeParse(req.body);
    if (!p.success) return invalide(res, p.error);
    if (await x.iaBloquee(req.userId)) return res.status(402).json({ message: "ia_bloquee" });
    const a = await x.store.ajouterActivite(req.userId, p.data);
    const r = await decouperActivite(req.userId, a.id, x.deps).catch((e: any) => {
      console.error("[vie-perso] découpage :", e?.message ?? e);
      return { ok: false as const, erreur: "decoupage_echec" };
    });
    res.status(201).json({ activite: await x.deps.lireActivite(req.userId, a.id), erreur: r.ok ? null : r.erreur });
  }));

  app.post("/api/vie-perso/activites/:id/decouper", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    if (await x.iaBloquee(req.userId)) return res.status(402).json({ message: "ia_bloquee" });
    const r = await decouperActivite(req.userId, id, x.deps);
    if (!r.ok) return res.status(404).json({ message: r.erreur });
    res.json(await x.deps.lireActivite(req.userId, id));
  }));

  app.post("/api/vie-perso/activites/:id/planifier", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    const r = await planifierActivite(req.userId, id, x.deps);
    if (!r.ok) return res.status(r.erreur === "activite_introuvable" ? 404 : 400).json({ message: r.erreur });
    res.json({ taches: r.taches, nonPlacees: r.nonPlacees });
  }));

  app.delete("/api/vie-perso/activites/:id", isAuthenticated, sur(async (req, res, x) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    return (await x.store.supprimerActivite(req.userId, id)) ? res.status(204).end() : res.status(404).json({ message: "not_found" });
  }));
}
