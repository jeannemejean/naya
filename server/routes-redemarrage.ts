// Séance de redémarrage : GET /api/redemarrage (séance en cours, ou proposition d'en lancer une),
// POST /api/redemarrage/demarrer, POST /api/redemarrage/abandonner. Réservé aux utilisatrices de
// SEANCE_REDEMARRAGE_USERS : ailleurs, 404.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import type { SeanceRedemarrage } from "@shared/schema";
import type { EtatSynchro } from "./services/redemarrage/seance";
import { seanceActivePour } from "./services/redemarrage/seance-interrupteur";

export interface DepsRoutesRedemarrage {
  actif(userId: string): boolean;
  synchroniser(userId: string, maintenant: Date): Promise<EtatSynchro>;
  /** Lecture seule : le bandeau ne fait jamais avancer la séance. */
  lire(userId: string, maintenant: Date): Promise<EtatSynchro>;
  demarrer(userId: string, maintenant: Date): Promise<SeanceRedemarrage>;
  abandonner(userId: string): Promise<boolean>;
  derniereActivite(userId: string): Promise<Date | null>;
  maintenant(): Date;
}

const seance = () => import("./services/redemarrage/seance");
export const depsRoutesRedemarrage: DepsRoutesRedemarrage = {
  actif: (u) => seanceActivePour(u),
  synchroniser: async (u, m) => (await seance()).synchroniser(u, m),
  lire: async (u, m) => (await seance()).lireSeance(u, m),
  demarrer: async (u, m) => (await seance()).demarrerSeance(u, m),
  abandonner: async (u) => (await seance()).abandonnerSeance(u),
  derniereActivite: async (u) => (await import("./services/redemarrage/absence")).derniereActivite(u),
  maintenant: () => new Date(),
};

export function registerRedemarrageRoutes(app: Express, deps: DepsRoutesRedemarrage = depsRoutesRedemarrage): void {
  const garde = (req: any, res: any, next: any) => (deps.actif(req.userId) ? next() : res.status(404).json({ message: "introuvable" }));

  app.get("/api/redemarrage", isAuthenticated, garde, async (req: any, res) => {
    try {
      const { vueSeance } = await seance();
      const { absenceDetectee } = await import("./services/redemarrage/absence");
      const m = deps.maintenant();
      const sync = await deps.lire(req.userId, m);
      if (sync.seance && sync.seance.statut === "en_cours") {
        return res.json({ seance: vueSeance(sync.seance, sync.propositionEnAttente), proposer: false });
      }
      res.json({ seance: null, proposer: absenceDetectee(await deps.derniereActivite(req.userId), m) });
    } catch (e: any) {
      console.error("[redemarrage] lecture :", e?.message ?? e);
      res.status(500).json({ message: "Lecture de la séance impossible" });
    }
  });

  app.post("/api/redemarrage/demarrer", isAuthenticated, garde, async (req: any, res) => {
    try {
      const { vueSeance } = await seance();
      res.json({ seance: vueSeance(await deps.demarrer(req.userId, deps.maintenant())) });
    } catch (e: any) {
      console.error("[redemarrage] démarrage :", e?.message ?? e);
      res.status(500).json({ message: "Démarrage de la séance impossible" });
    }
  });

  app.post("/api/redemarrage/abandonner", isAuthenticated, garde, async (req: any, res) => {
    try {
      res.json({ ok: await deps.abandonner(req.userId) });
    } catch (e: any) {
      console.error("[redemarrage] abandon :", e?.message ?? e);
      res.status(500).json({ message: "Abandon impossible" });
    }
  });
}
