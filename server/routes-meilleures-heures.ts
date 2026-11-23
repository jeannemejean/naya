// server/routes-meilleures-heures.ts — Meilleures heures pour publier (lot 7, inspiré de Metricool).
//
// GET /api/meilleures-heures?projectId=&reseau= → { reseau, matrice 7 × 24 (0..1), source, n }.
// La grille est recalculée à chaque appel (seule la dernière compte) : générique, mélangée aux
// mesures des posts publiés de la marque au-delà du seuil (shared/meilleures-heures.ts). Tout
// passe par req.userId : la marque d'un autre compte est introuvable (404).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { meilleuresHeures, reseauMeilleuresHeures, type MesurePost } from "@shared/meilleures-heures";

/** Les mesures prises en compte : les 18 derniers mois (l'audience change). */
export const FENETRE_MESURES_JOURS = 548;

export interface DepsMeilleuresHeures {
  projet(id: number, userId: string): Promise<{ id: number } | undefined>;
  mesures(userId: string, projectId: number | null, reseau: string, depuis: Date): Promise<MesurePost[]>;
  maintenant(): Date;
}

export const depsMeilleuresHeures: DepsMeilleuresHeures = {
  projet: (id, userId) => storage.getProject(id, userId),
  mesures: (userId, projectId, reseau, depuis) => storage.getMesuresPublication(userId, projectId, reseau, depuis),
  maintenant: () => new Date(),
};

/** La grille d'une marque (null = marque des Réglages) pour un réseau. */
export async function grilleDeLaMarque(deps: DepsMeilleuresHeures, userId: string, projectId: number | null, reseau: string) {
  const depuis = new Date(deps.maintenant().getTime() - FENETRE_MESURES_JOURS * 86_400_000);
  const mesures = await deps.mesures(userId, projectId, reseau, depuis);
  return meilleuresHeures(reseau, mesures);
}

export function registerMeilleuresHeuresRoutes(app: Express, deps: DepsMeilleuresHeures = depsMeilleuresHeures): void {
  app.get("/api/meilleures-heures", isAuthenticated, async (req: any, res) => {
    try {
      const reseau = reseauMeilleuresHeures(req.query.reseau);
      if (!reseau) return res.status(400).json({ message: "reseau_invalide" });
      const brut = req.query.projectId;
      let projectId: number | null = null;
      if (brut !== undefined && brut !== "" && brut !== "null") {
        const n = Number(brut);
        if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ message: "projet_invalide" });
        if (!(await deps.projet(n, req.userId))) return res.status(404).json({ message: "not_found" });
        projectId = n;
      }
      const g = await grilleDeLaMarque(deps, req.userId, projectId, reseau);
      res.json({ reseau, matrice: g.matrice, source: g.source, n: g.n });
    } catch (e: any) {
      console.error("[meilleures-heures]", e?.message ?? e);
      res.status(500).json({ message: "meilleures_heures_failed" });
    }
  });
}
