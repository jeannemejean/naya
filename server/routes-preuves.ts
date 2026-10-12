// server/routes-preuves.ts — bibliothèque de preuves d'un projet (réalisations réelles où
// la prospection puise). Les règles sont dans services/prospection/preuves.ts.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { validerPreuve } from "./services/prospection/preuves";
import { suggererPreuves, SourcesIndisponiblesError } from "./services/prospection/preuves-suggestion";

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerPreuvesRoutes(app: Express) {
  // Le projet doit appartenir à l'utilisatrice ; sinon 404 (jamais 403 : on ne confirme pas son existence).
  async function projetDe(req: any): Promise<number | null> {
    const id = idPositif(req.params.id);
    if (!id) return null;
    const p = await storage.getProject(id, req.userId);
    return p ? id : null;
  }

  app.get("/api/projects/:id/proofs", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      if (!projectId) return res.status(404).json({ message: "not_found" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json(await storage.getProjectProofs(req.userId, projectId, status));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/proofs", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      if (!projectId) return res.status(404).json({ message: "not_found" });
      const v = validerPreuve(req.body);
      if (!v.ok) return res.status(400).json({ message: v.erreur });
      // Saisie par l'utilisatrice elle-même : validée d'office (sauf statut explicite).
      const cree = await storage.createProjectProof({
        ...(v.valeur as any), status: v.valeur.status ?? "validated", source: "manual", userId: req.userId, projectId,
      });
      res.status(201).json(cree);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/projects/:id/proofs/:proofId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      const proofId = idPositif(req.params.proofId);
      const preuve = proofId ? await storage.getProjectProof(proofId, req.userId) : undefined;
      if (!projectId || !preuve || preuve.projectId !== projectId) return res.status(404).json({ message: "not_found" });
      const v = validerPreuve(req.body, { partiel: true });
      if (!v.ok) return res.status(400).json({ message: v.erreur });
      res.json(await storage.updateProjectProof(preuve.id, req.userId, v.valeur as any));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/projects/:id/proofs/:proofId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      const proofId = idPositif(req.params.proofId);
      const preuve = proofId ? await storage.getProjectProof(proofId, req.userId) : undefined;
      if (!projectId || !preuve || preuve.projectId !== projectId) return res.status(404).json({ message: "not_found" });
      await storage.deleteProjectProof(preuve.id, req.userId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/proofs/suggest", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      if (!projectId) return res.status(404).json({ message: "not_found" });
      res.json(await suggererPreuves(req.userId, projectId));
    } catch (e: any) {
      if (e instanceof SourcesIndisponiblesError) return res.status(502).json({ message: "sources_indisponibles" });
      console.error("[preuves/suggest]", e?.message);
      res.status(500).json({ message: e.message });
    }
  });
}
