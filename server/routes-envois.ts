// Envois aux marques (séance de redémarrage) : GET /api/envois?projectId=, POST, PATCH /:id.
// Tout passe par req.userId : l'envoi ou le projet d'une autre est introuvable (404).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { STATUTS_A_RELANCER, STATUTS_ENVOI } from "@shared/envois";
import type { Envoi } from "@shared/schema";

export interface DepsEnvois {
  lister(userId: string, filtre: { projectId?: number }): Promise<Envoi[]>;
  creer(userId: string, e: any): Promise<Envoi>;
  lire(id: number, userId: string): Promise<Envoi | undefined>;
  maj(userId: string, id: number, champs: any): Promise<Envoi | undefined>;
  retirerRelanceNonFaite(userId: string, e: Envoi): Promise<number>;
  projet(id: number, userId: string): Promise<{ id: number } | undefined>;
  aujourdhui(): string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const plusJours = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const RELANCE_PAR_DEFAUT_JOURS = 7;

export const depsEnvois: DepsEnvois = {
  lister: async (u, f) => (await import("./services/envois/store")).envoisDe(u, f),
  creer: async (u, e) => (await import("./services/envois/store")).creerEnvoi(u, e),
  lire: async (id, u) => (await import("./services/envois/store")).getEnvoi(id, u),
  maj: async (u, id, c) => (await import("./services/envois/store")).majEnvoi(u, id, c),
  retirerRelanceNonFaite: async (u, e) => (await import("./services/envois/relances")).retirerRelanceNonFaite(u, e),
  projet: async (id, u) => (await import("./storage")).storage.getProject(id, u),
  aujourdhui: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
};

const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function registerEnvoisRoutes(app: Express, deps: DepsEnvois = depsEnvois): void {
  app.get("/api/envois", isAuthenticated, async (req: any, res) => {
    try {
      const pid = req.query.projectId != null ? Number(req.query.projectId) : undefined;
      res.json(await deps.lister(req.userId, Number.isInteger(pid) ? { projectId: pid } : {}));
    } catch (e: any) {
      console.error("[envois] liste :", e?.message);
      res.status(500).json({ message: "Lecture des envois impossible" });
    }
  });

  app.post("/api/envois", isAuthenticated, async (req: any, res) => {
    try {
      const b = req.body ?? {};
      const marque = texte(b.marque); const objet = texte(b.objet);
      if (!marque || !objet) return res.status(400).json({ message: "marque et objet requis" });
      const envoyeLe = typeof b.envoyeLe === "string" && DATE.test(b.envoyeLe) ? b.envoyeLe : deps.aujourdhui();
      const prochaineRelance = b.prochaineRelance === null ? null
        : typeof b.prochaineRelance === "string" && DATE.test(b.prochaineRelance) ? b.prochaineRelance
        : plusJours(envoyeLe, RELANCE_PAR_DEFAUT_JOURS);
      let projectId: number | null = null;
      if (b.projectId != null) {
        projectId = Number(b.projectId);
        if (!(await deps.projet(projectId, req.userId))) return res.status(404).json({ message: "Projet introuvable" });
      }
      res.json(await deps.creer(req.userId, {
        marque, objet, projectId, envoyeLe, prochaineRelance, statut: "envoye",
        contact: texte(b.contact), canal: texte(b.canal), notes: texte(b.notes),
      }));
    } catch (e: any) {
      console.error("[envois] création :", e?.message);
      res.status(500).json({ message: "Création de l'envoi impossible" });
    }
  });

  app.patch("/api/envois/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const avant = Number.isInteger(id) ? await deps.lire(id, req.userId) : undefined;
      if (!avant) return res.status(404).json({ message: "Envoi introuvable" });
      const b = req.body ?? {};
      const champs: Record<string, unknown> = {};
      if (b.statut !== undefined) {
        if (!(STATUTS_ENVOI as readonly string[]).includes(b.statut)) return res.status(400).json({ message: "statut invalide" });
        champs.statut = b.statut;
      }
      if (b.prochaineRelance !== undefined) {
        if (b.prochaineRelance !== null && !(typeof b.prochaineRelance === "string" && DATE.test(b.prochaineRelance))) {
          return res.status(400).json({ message: "prochaineRelance invalide (AAAA-MM-JJ)" });
        }
        champs.prochaineRelance = b.prochaineRelance;
      }
      if (b.notes !== undefined) champs.notes = texte(b.notes);
      if (b.contact !== undefined) champs.contact = texte(b.contact);
      const apres = await deps.maj(req.userId, id, champs);
      // Relance en attente devenue fausse : date changée, ou réponse reçue / refus / sans suite.
      const dateChangee = "prochaineRelance" in champs && champs.prochaineRelance !== avant.prochaineRelance;
      const plusARelancer = "statut" in champs && !STATUTS_A_RELANCER.has(String(champs.statut));
      if (dateChangee || plusARelancer) await deps.retirerRelanceNonFaite(req.userId, avant);
      res.json(apres);
    } catch (e: any) {
      console.error("[envois] mise à jour :", e?.message);
      res.status(500).json({ message: "Mise à jour de l'envoi impossible" });
    }
  });
}
