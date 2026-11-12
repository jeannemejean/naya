// Routes du fil conducteur : propositions d'étapes (à la demande, « Refaire », « Ajuster ») et
// rattachement des chaînes existantes. Toutes réservées à l'interrupteur (sinon 404). Valider
// et annuler passent par les routes de l'agent (/api/agent/propositions/:id/*).
import type { Express, NextFunction, Response } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { isAiBlocked } from "./services/usage";
import { depot } from "./services/agent/depot";
import { annulerProposition, proposerHorsConversation } from "./services/agent/propositions";
import { filActifPour } from "./services/fil/interrupteur";
import { OUTILS_FIL_PROPOSITIONS, proposerEtapesPour, proposerRattachements } from "./services/fil/etapes";

function reserveAuFil(req: any, res: Response, next: NextFunction) {
  if (!filActifPour(req.userId)) return res.status(404).json({ message: "Not found" });
  next();
}

const idValide = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// L'objectif s'il est à l'utilisatrice (par son projet).
async function objectifDe(userId: string, id: number) {
  const objectif = await storage.getProjectGoal(id);
  if (!objectif || !(await storage.getProject(objectif.projectId, userId))) return null;
  return objectif;
}

export function registerFilRoutes(app: Express): void {
  // Propositions ouvertes du fil, avec l'objectif concerné (titre) pour l'affichage.
  app.get("/api/fil/propositions", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const liste = await depot.propositionsEnAttente(userId, OUTILS_FIL_PROPOSITIONS, new Date());
      const sortie = await Promise.all(liste.map(async (p) => {
        const objectifId = idValide((p.arguments as any)?.objectifId);
        const objectif = objectifId ? await objectifDe(userId, objectifId) : null;
        return {
          id: p.id, outil: p.outil, arguments: p.arguments, changements: p.changements, expireA: p.expireA,
          objectif: objectif ? { id: objectif.id, titre: objectif.title, projetId: objectif.projectId } : null,
        };
      }));
      res.json(sortie);
    } catch (error: any) {
      console.error("Propositions du fil :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la lecture des propositions" });
    }
  });

  // À la demande, et « Refaire » (le client annule l'ancienne avant).
  app.post("/api/fil/objectifs/:id/proposer-etapes", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = idValide(req.params.id);
      if (!id || !(await objectifDe(userId, id))) return res.status(404).json({ message: "introuvable" });
      if (await isAiBlocked(userId)) return res.status(429).json({ message: "ai_monthly_limit_reached" });
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : undefined;
      const r = await proposerEtapesPour(userId, id, new Date(), note);
      if ("erreur" in r) return res.status(409).json({ message: r.erreur });
      res.json(r);
    } catch (error: any) {
      console.error("Proposition d'étapes :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la proposition d'étapes" });
    }
  });

  // « Ajuster » : la liste éditée par Jeanne remplace l'ancienne proposition, sans IA. La
  // nouvelle est créée d'abord : refusée (2 étapes, ordre…), l'ancienne reste intacte.
  app.post("/api/fil/propositions/:id/ajuster", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = idValide(req.params.id);
      const ancienne = id ? await depot.getProposition(id, userId) : undefined;
      if (!ancienne || ancienne.outil !== "proposer_etapes") return res.status(404).json({ message: "introuvable" });
      if (ancienne.statut !== "en_attente") return res.status(409).json({ message: "deja_traitee" });
      const objectifId = (ancienne.arguments as any)?.objectifId;
      const nouvelle = await proposerHorsConversation(userId, "proposer_etapes", { objectifId, etapes: req.body?.etapes }, new Date());
      if ("erreur" in nouvelle) return res.status(400).json({ message: nouvelle.erreur });
      const a = await annulerProposition(userId, ancienne.id);
      if (!a.ok) {
        // L'ancienne a été validée ou annulée entre-temps : on retire la nouvelle.
        await annulerProposition(userId, nouvelle.id);
        return res.status(409).json({ message: a.raison });
      }
      res.json(nouvelle);
    } catch (error: any) {
      console.error("Ajustement d'étapes :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de l'ajustement" });
    }
  });

  app.post("/api/fil/rattachements", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      res.json(await proposerRattachements(req.userId, new Date()));
    } catch (error: any) {
      console.error("Rattachement des chaînes :", error?.message || error);
      res.status(500).json({ message: "Erreur lors du rattachement" });
    }
  });
}
