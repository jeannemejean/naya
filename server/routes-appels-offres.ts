// server/routes-appels-offres.ts — lire ses appels d'offres, changer leur statut, annoter.
// Tout passe par req.userId : 404 pour une ligne qui n'est pas à l'utilisatrice.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { appelsOffresStore, type DepsAppelsOffres, type ModifAppelOffres } from "./services/appels-offres-store";
import { estStatutAO } from "@shared/appels-offres";
import type { BilanVeilleAO } from "./services/veille-ao/pipeline";
import { veilleActivePour, veilleEnCours } from "./services/veille-ao/etat";

export const NOTES_MAX = 20_000;
/** Un lancement manuel de la veille au plus toutes les 10 minutes, par utilisatrice. */
export const INTERVALLE_VEILLE_MS = 10 * 60_000;

export interface DepsVeilleRoutes {
  estActivee(userId: string): boolean;
  enCours(userId: string): boolean;
  /** null : un passage est déjà en cours pour elle. */
  lancer(userId: string): Promise<BilanVeilleAO | null>;
  maintenant?: () => number;
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

export function registerAppelsOffresRoutes(app: Express, deps: DepsAppelsOffres = appelsOffresStore, veille: DepsVeilleRoutes = veilleParDefaut) {
  // Express 4 n'achemine pas un rejet async : sans ce garde-fou la requête pend.
  const sur = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { await h(req, res); } catch (e: any) {
      console.error("[AppelsOffres] route :", e?.message);
      if (!res.headersSent) res.status(500).json({ message: "appels_offres_failed" });
    }
  };
  const idValide = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

  // ─── Veille (avant /:id, sinon « veille » serait pris pour un id) ─────────────
  const derniersLancements = new Map<string, number>();
  const maintenant = veille.maintenant ?? Date.now;

  app.get("/api/appels-offres/veille", isAuthenticated, sur(async (req, res) => {
    res.json({ active: veille.estActivee(req.userId), enCours: veille.enCours(req.userId) });
  }));

  app.post("/api/appels-offres/veille", isAuthenticated, sur(async (req, res) => {
    const userId: string = req.userId;
    if (!veille.estActivee(userId)) return res.status(403).json({ message: "veille_non_activee" });
    const dernier = derniersLancements.get(userId);
    if (dernier !== undefined && maintenant() - dernier < INTERVALLE_VEILLE_MS) {
      return res.status(429).json({ message: "veille_trop_recente", reessayerDansMs: INTERVALLE_VEILLE_MS - (maintenant() - dernier) });
    }
    derniersLancements.set(userId, maintenant());
    const bilan = await veille.lancer(userId);
    if (!bilan) return res.status(409).json({ message: "veille_en_cours" });
    res.json({
      nouveaux: bilan.nouveaux, rafraichis: bilan.rafraichis, examines: bilan.examines,
      reportes: bilan.reportesPlafond, iaBloquee: bilan.iaBloquee, sourcesEnErreur: bilan.erreursSources.length,
    });
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
    res.json(ligne);
  }));
}
