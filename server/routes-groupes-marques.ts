// server/routes-groupes-marques.ts — groupes de marques (lot 9, inspiré des « brand groups » de
// Metricool). Tout passe par req.userId : le groupe d'un autre compte est introuvable (404), et
// un groupe ne peut contenir que des projets de l'utilisatrice.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { depsGroupesMarques, type DepsGroupesMarques, type GroupeAvecProjets } from "./services/groupes-marques/deps";
import { GROUPES_MAX, lireGroupeMarques, type GroupeSaisi } from "@shared/groupes-marques";

const vue = (g: GroupeAvecProjets) => ({ id: g.id, nom: g.nom, couleur: g.couleur, projectIds: g.projectIds });

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerGroupesMarquesRoutes(app: Express, deps: DepsGroupesMarques = depsGroupesMarques): void {
  /** Tous les projets demandés sont-ils à l'utilisatrice ? */
  const projetsAElle = async (userId: string, ids: number[] | undefined) =>
    !ids || ids.length === 0 || (await deps.projetsSiens(userId, ids)).length === ids.length;

  app.get("/api/groupes-marques", isAuthenticated, async (req: any, res) => {
    try {
      res.json((await deps.groupes(req.userId)).map(vue));
    } catch (e: any) {
      console.error("[groupes-marques] liste:", e?.message);
      res.status(500).json({ message: "groupes_failed" });
    }
  });

  app.post("/api/groupes-marques", isAuthenticated, async (req: any, res) => {
    try {
      const g = lireGroupeMarques(req.body) as GroupeSaisi | null;
      if (!g) return res.status(400).json({ message: "invalide" });
      if ((await deps.groupes(req.userId)).length >= GROUPES_MAX) return res.status(400).json({ message: "trop_de_groupes" });
      if (!(await projetsAElle(req.userId, g.projectIds))) return res.status(400).json({ message: "projet_inconnu" });
      res.status(201).json(vue(await deps.creer(req.userId, g)));
    } catch (e: any) {
      console.error("[groupes-marques] création:", e?.message);
      res.status(500).json({ message: "groupes_failed" });
    }
  });

  app.patch("/api/groupes-marques/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const patch = lireGroupeMarques(req.body, true);
      if (!patch) return res.status(400).json({ message: "invalide" });
      if (!(await projetsAElle(req.userId, patch.projectIds))) return res.status(400).json({ message: "projet_inconnu" });
      const g = await deps.modifier(id, req.userId, patch);
      if (!g) return res.status(404).json({ message: "not_found" });
      res.json(vue(g));
    } catch (e: any) {
      console.error("[groupes-marques] modification:", e?.message);
      res.status(500).json({ message: "groupes_failed" });
    }
  });

  app.delete("/api/groupes-marques/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null || !(await deps.supprimer(id, req.userId))) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[groupes-marques] suppression:", e?.message);
      res.status(500).json({ message: "groupes_failed" });
    }
  });
}
