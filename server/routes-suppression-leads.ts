// Suppression DÉFINITIVE de prospects (un seul ou une sélection). L'archivage
// (/api/leads/bulk-archive) reste le geste réversible ; celui-ci efface la fiche et tout son
// historique — voir services/prospection-suppression.ts pour le sort de chaque table.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage, type IStorage } from "./storage";

/** Au-delà, la requête est refusée : une sélection plus grande se supprime en plusieurs fois. */
export const MAX_SUPPRESSION_GROUPEE = 500;

export type DepsSuppressionLeads = Pick<IStorage, "deleteLeads">;

export function registerSuppressionLeadsRoutes(app: Express, deps: DepsSuppressionLeads = storage) {
  // Un prospect. 404 s'il n'est pas à l'utilisatrice (ou n'existe plus), 409 si un envoi
  // lui part en ce moment même.
  app.delete("/api/leads/:id", isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "invalid_id" });
    try {
      const r = await deps.deleteLeads([id], req.userId);
      const refus = r.refuses[0];
      if (refus) {
        const code = refus.raison === "introuvable" ? 404 : refus.raison === "envoi_en_cours" ? 409 : 500;
        return res.status(code).json({ message: refus.raison });
      }
      res.json({ supprimes: r.supprimes.length, bloques: r.bloques });
    } catch (e: any) {
      console.error("[Suppression] prospect", id, e?.message);
      res.status(500).json({ message: "delete_failed" });
    }
  });

  // Sélection : { ids: number[] }. Les ids qui ne sont pas à l'utilisatrice sont refusés
  // (`introuvable`), sans rien révéler de plus ; chaque prospect a sa propre transaction.
  app.post("/api/leads/bulk-delete", isAuthenticated, async (req: any, res) => {
    const ids: number[] = Array.isArray(req.body?.ids)
      ? Array.from(new Set<number>(req.body.ids.filter((n: any) => Number.isInteger(n) && n > 0)))
      : [];
    if (ids.length === 0) return res.status(400).json({ message: "no_ids" });
    if (ids.length > MAX_SUPPRESSION_GROUPEE) return res.status(400).json({ message: "too_many_ids" });
    try {
      const r = await deps.deleteLeads(ids, req.userId);
      res.json({ supprimes: r.supprimes.length, ids: r.supprimes, refuses: r.refuses, bloques: r.bloques });
    } catch (e: any) {
      console.error("[Suppression] sélection", e?.message);
      res.status(500).json({ message: "delete_failed" });
    }
  });
}
