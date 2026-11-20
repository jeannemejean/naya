// Le bilan de la semaine (chef d'orchestre, étape 5) : calculé à la demande, pour l'utilisatrice connectée.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { parisTodayString } from "./utils/timezone";
import { semaineARevoir } from "./services/orchestre/revue-semaine";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

export function registerOrchestreRoutes(
  app: Express,
  calculer: (userId: string, semaine: string) => Promise<unknown> = async (userId, semaine) =>
    (await import("./services/orchestre/revue-semaine-run")).calculerBilanSemaine(userId, semaine),
) {
  app.get("/api/orchestre/semaine", isAuthenticated, async (req: any, res) => {
    try {
      const demande = typeof req.query.semaine === "string" ? req.query.semaine : null;
      if (demande && !JOUR.test(demande)) return res.status(400).json({ message: "semaine_invalide" });
      // Ramené au lundi : la semaine du jour donné (la suivante pour un samedi ou un dimanche).
      res.json(await calculer(req.userId, semaineARevoir(demande ?? parisTodayString(new Date()))));
    } catch (e: any) {
      console.error("[orchestre] bilan de la semaine :", e?.message);
      res.status(500).json({ message: "bilan_indisponible" });
    }
  });
}
