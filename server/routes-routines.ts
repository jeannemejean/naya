// server/routes-routines.ts — la routine de sourcing quotidien d'une campagne de prospection :
// état, pause/reprise, et « lancer maintenant ».
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { executerUne, routineSourcingPour, REGISTRE } from "./services/routines/ordonnanceur";
import { KIND_SOURCING } from "./services/routines/sourcing";

async function routineDe(req: any) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const campaign: any = await storage.getProspectionCampaign(id);
  if (!campaign || campaign.userId !== req.userId) return null;
  // Idempotent : renvoie la routine existante, ou la crée (campagnes antérieures).
  return storage.ensureRoutine(routineSourcingPour(campaign, new Date()) as any);
}

export function registerRoutinesRoutes(app: Express) {
  app.get("/api/prospection/campaigns/:id/routine", isAuthenticated, async (req: any, res) => {
    try {
      const routine = await routineDe(req);
      if (!routine) return res.status(404).json({ message: "not_found" });
      const derniersPassages = await storage.getRoutineRuns(routine.id, req.userId, 5);
      res.json({ routine, derniersPassages });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/prospection/campaigns/:id/routine", isAuthenticated, async (req: any, res) => {
    try {
      const routine = await routineDe(req);
      if (!routine) return res.status(404).json({ message: "not_found" });
      if (typeof req.body?.actif !== "boolean") return res.status(400).json({ message: "actif_requis" });
      res.json(await storage.updateRoutine(routine.id, req.userId, { actif: req.body.actif }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // « Lancer maintenant » : même exécution que l'ordonnanceur, sans toucher au prochain passage.
  app.post("/api/prospection/campaigns/:id/routine/run", isAuthenticated, async (req: any, res) => {
    try {
      const routine = await routineDe(req);
      if (!routine) return res.status(404).json({ message: "not_found" });
      // Le verrou en base (executerUne) couvre aussi l'ordonnanceur et les autres instances.
      const r = await executerUne(routine, REGISTRE[KIND_SOURCING]);
      if (r.dejaEnCours) return res.status(409).json({ message: "deja_en_cours" });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
