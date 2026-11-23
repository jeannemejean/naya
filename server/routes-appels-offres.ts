// server/routes-appels-offres.ts — lire ses appels d'offres, changer leur statut, annoter.
// Tout passe par req.userId : 404 pour une ligne qui n'est pas à l'utilisatrice.
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { isAuthenticated } from "./auth";
import { appelsOffresStore, type DepsAppelsOffres, type ModifAppelOffres } from "./services/appels-offres-store";
import { estStatutAO } from "@shared/appels-offres";
import type { BilanVeilleAO } from "./services/veille-ao/pipeline";
import { veilleActivePour, veilleEnCours } from "./services/veille-ao/etat";
import { RC_MAX, refusPremierJet, type ResultatPremierJet } from "./services/veille-ao/premier-jet";

export const NOTES_MAX = 20_000;
/** Un lancement manuel de la veille au plus toutes les 10 minutes, par utilisatrice. */
export const INTERVALLE_VEILLE_MS = 10 * 60_000;

export interface PassageManuel {
  id: string;
  statut: "en_cours" | "fini" | "erreur";
  nouveaux?: number;
  misAJour?: number;
  examines?: number;
  reportes?: number;
  iaBloquee?: boolean;
  sourcesEnErreur?: number;
  erreur?: string;
}

/** Bilan d'un passage → ce que la page affiche. Erreur si le passage n'a rien pu lire. */
export function resultatPassage(id: string, b: BilanVeilleAO | null): PassageManuel {
  if (!b) return { id, statut: "erreur", erreur: "veille_en_cours" };
  const echecGlobal = b.erreursSources.some((e) => e.startsWith("passage:")) || (b.examines === 0 && b.erreursSources.length > 0);
  if (echecGlobal) return { id, statut: "erreur", erreur: "veille_echec" };
  return {
    id, statut: "fini", nouveaux: b.nouveaux, misAJour: b.rafraichis, examines: b.examines,
    reportes: b.reportesPlafond, iaBloquee: b.iaBloquee, sourcesEnErreur: b.erreursSources.length,
  };
}

export interface DepsVeilleRoutes {
  estActivee(userId: string): boolean;
  enCours(userId: string): boolean;
  /** null : un passage est déjà en cours pour elle. */
  lancer(userId: string): Promise<BilanVeilleAO | null>;
  maintenant?: () => number;
  nouvelId?: () => string;
}

const veilleParDefaut: DepsVeilleRoutes = {
  estActivee: (userId) => veilleActivePour(userId),
  enCours: (userId) => veilleEnCours(userId),
  lancer: async (userId) => {
    const [{ lancerVeilleAO }, { depsVeilleAO }] = await Promise.all([
      import("./services/veille-ao/pipeline"), import("./services/veille-ao/deps"),
    ]);
    return lancerVeilleAO(userId, depsVeilleAO);
  },
};

/** Après un changement de statut : jalons de l'AO (chef d'orchestre, étape 2) puis re-tassage. */
export type ApresStatut = (userId: string) => Promise<void>;
const apresStatutParDefaut: ApresStatut = async (userId) => {
  const [{ synchroniserJalonsAO }, { depsJalonsAO }, { storage }, { parisTodayString }, { filActifPour }] = await Promise.all([
    import("./services/orchestre/jalons-ao"), import("./services/orchestre/jalons-ao-deps"),
    import("./storage"), import("./utils/timezone"), import("./services/fil/interrupteur"),
  ]);
  // Même interrupteur que le passage du matin.
  if (!filActifPour(userId)) return;
  const r = await synchroniserJalonsAO(userId, new Date(), depsJalonsAO);
  if (Object.values(r).some((n) => n > 0)) await storage.fixOverlappingTasks(userId, parisTodayString(new Date()));
};

/** Premier jet préparé à la demande (bouton) : état d'une préparation, en mémoire. */
export interface EtatPremierJet { statut: "en_cours" | "fini" | "erreur"; erreur?: string }
export interface DepsRoutesPremierJet {
  preparer(userId: string, id: number, rc: string | null): Promise<ResultatPremierJet>;
}
const premierJetParDefaut: DepsRoutesPremierJet = {
  preparer: async (userId, id, rc) => {
    const [{ preparerPremierJet }, { depsPremierJet }] = await Promise.all([
      import("./services/veille-ao/premier-jet"), import("./services/veille-ao/premier-jet-deps"),
    ]);
    return preparerPremierJet(userId, id, { rc }, depsPremierJet);
  },
};

export function registerAppelsOffresRoutes(
  app: Express, deps: DepsAppelsOffres = appelsOffresStore, veille: DepsVeilleRoutes = veilleParDefaut,
  apresStatut: ApresStatut = apresStatutParDefaut, premierJet: DepsRoutesPremierJet = premierJetParDefaut,
) {
  // Express 4 n'achemine pas un rejet async : sans ce garde-fou la requête pend.
  const sur = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { await h(req, res); } catch (e: any) {
      console.error("[AppelsOffres] route :", e?.message);
      if (!res.headersSent) res.status(500).json({ message: "appels_offres_failed" });
    }
  };
  const idValide = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

  // ─── Veille (avant /:id, sinon « veille » serait pris pour un id) ─────────────
  // Le lancement manuel répond tout de suite (202 + id) : un passage peut durer plusieurs
  // minutes, et le proxy ne doit pas garder la requête ouverte. Le passage continue dans le
  // processus (même verrou « un seul à la fois » que le passage quotidien) ; la page interroge
  // son état toutes les 3 s. État en mémoire : un redémarrage l'oublie (le passage aussi).
  const derniersLancements = new Map<string, number>();
  const passages = new Map<string, PassageManuel>(); // userId → dernier passage manuel
  const maintenant = veille.maintenant ?? Date.now;
  const nouvelId = veille.nouvelId ?? (() => randomUUID());

  app.get("/api/appels-offres/veille", isAuthenticated, sur(async (req, res) => {
    const userId: string = req.userId;
    res.json({ active: veille.estActivee(userId), enCours: veille.enCours(userId), passage: passages.get(userId) ?? null });
  }));

  app.get("/api/appels-offres/veille/passages/:passageId", isAuthenticated, sur(async (req, res) => {
    const p = passages.get(req.userId);
    if (!p || p.id !== req.params.passageId) return res.status(404).json({ message: "not_found" });
    res.json(p);
  }));

  app.post("/api/appels-offres/veille", isAuthenticated, sur(async (req, res) => {
    const userId: string = req.userId;
    if (!veille.estActivee(userId)) return res.status(403).json({ message: "veille_non_activee" });
    const enCours = passages.get(userId);
    if (veille.enCours(userId) || enCours?.statut === "en_cours") {
      return res.status(409).json({ message: "veille_en_cours", id: enCours?.statut === "en_cours" ? enCours.id : null });
    }
    const dernier = derniersLancements.get(userId);
    if (dernier !== undefined && maintenant() - dernier < INTERVALLE_VEILLE_MS) {
      return res.status(429).json({ message: "veille_trop_recente", reessayerDansMs: INTERVALLE_VEILLE_MS - (maintenant() - dernier) });
    }
    derniersLancements.set(userId, maintenant());
    const passage: PassageManuel = { id: nouvelId(), statut: "en_cours" };
    passages.set(userId, passage);
    veille.lancer(userId)
      .then((b) => passages.set(userId, resultatPassage(passage.id, b)))
      .catch((e: any) => {
        console.error("[veille-ao] passage manuel :", e?.message ?? e);
        passages.set(userId, { id: passage.id, statut: "erreur", erreur: "veille_echec" });
      });
    res.status(202).json(passage);
  }));

  // ─── Premier jet (bouton) ─────────────────────────────────────────────────────
  // 2 à 3 minutes de rédaction : réponse 202 tout de suite, la page interroge l'état toutes les
  // 3 s. Une préparation à la fois par utilisatrice. Un redémarrage oublie l'état (« aucun »).
  const jets = new Map<string, Map<number, EtatPremierJet>>(); // userId → id AO → état
  const jetsDe = (userId: string) => { let m = jets.get(userId); if (!m) { m = new Map(); jets.set(userId, m); } return m; };

  app.get("/api/appels-offres/:id/premier-jet", isAuthenticated, sur(async (req, res) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    res.json(jets.get(req.userId)?.get(id) ?? { statut: "aucun" });
  }));

  app.post("/api/appels-offres/:id/premier-jet", isAuthenticated, sur(async (req, res) => {
    const userId: string = req.userId;
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    const rc = req.body?.rc ?? null;
    if (rc !== null && typeof rc !== "string") return res.status(400).json({ message: "rc_invalide" });
    if (typeof rc === "string" && rc.length > RC_MAX) return res.status(400).json({ message: "rc_trop_long" });
    const ligne = await deps.lireAppelOffres(id, userId);
    if (!ligne) return res.status(404).json({ message: "not_found" });
    const refus = refusPremierJet(ligne as any, new Date());
    if (refus) return res.status(400).json({ message: refus });
    const mes = jetsDe(userId);
    if (Array.from(mes.values()).some((e) => e.statut === "en_cours")) return res.status(409).json({ message: "premier_jet_en_cours" });
    mes.set(id, { statut: "en_cours" });
    premierJet.preparer(userId, id, typeof rc === "string" && rc.trim() ? rc : null)
      .then((r) => mes.set(id, r.ok ? { statut: "fini" } : { statut: "erreur", erreur: r.erreur }))
      .catch((e: any) => {
        console.error("[premier-jet] bouton :", e?.message ?? e);
        mes.set(id, { statut: "erreur", erreur: "premier_jet_echec" });
      });
    res.status(202).json({ statut: "en_cours" });
  }));

  app.get("/api/appels-offres", isAuthenticated, sur(async (req, res) => {
    res.json(await deps.listerAppelsOffres(req.userId));
  }));

  app.get("/api/appels-offres/:id", isAuthenticated, sur(async (req, res) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    const ligne = await deps.lireAppelOffres(id, req.userId);
    if (!ligne) return res.status(404).json({ message: "not_found" });
    res.json(ligne);
  }));

  // Seuls le statut et les notes se modifient ici ; le reste vient de la veille.
  app.patch("/api/appels-offres/:id", isAuthenticated, sur(async (req, res) => {
    const id = idValide(req.params.id);
    if (!id) return res.status(400).json({ message: "invalid_id" });
    const corps = req.body ?? {};
    const modif: ModifAppelOffres = {};
    if ("statut" in corps) {
      if (!estStatutAO(corps.statut)) return res.status(400).json({ message: "statut_invalide" });
      modif.statut = corps.statut;
    }
    if ("notes" in corps) {
      if (corps.notes !== null && typeof corps.notes !== "string") return res.status(400).json({ message: "notes_invalides" });
      if (typeof corps.notes === "string" && corps.notes.length > NOTES_MAX) return res.status(400).json({ message: "notes_trop_longues" });
      modif.notes = corps.notes === null || corps.notes.trim() === "" ? null : corps.notes;
    }
    if (Object.keys(modif).length === 0) return res.status(400).json({ message: "rien_a_modifier" });
    const ligne = await deps.modifierAppelOffres(id, req.userId, modif);
    if (!ligne) return res.status(404).json({ message: "not_found" });
    // Les jalons ne doivent jamais faire échouer le changement de statut : consigné, avalé.
    if (modif.statut) {
      await apresStatut(req.userId).catch((e: any) => console.error("[AppelsOffres] jalons :", e?.message));
    }
    res.json(ligne);
  }));
}
