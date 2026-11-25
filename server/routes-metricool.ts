// Connexion Metricool (Réglages) : GET /api/metricool/connexion (état seulement, jamais le jeton),
// PUT (jeton, mcUserId, blogId → vérifié par un appel sur 1 jour, puis chiffré), DELETE.
// C'est l'utilisatrice qui colle son jeton (Metricool > Réglages du compte > API).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import type { ConnexionMc, PostMc, RefusMc } from "./services/metricool/client";

export interface DepsMetricool {
  etat(userId: string): Promise<Record<string, unknown>>;
  verifier(cx: ConnexionMc, debut: Date, fin: Date): Promise<{ ok: true; posts: PostMc[] } | RefusMc>;
  enregistrer(userId: string, cx: ConnexionMc, etat: "ok" | "refuse", maintenant: Date): Promise<void>;
  supprimer(userId: string): Promise<void>;
  maintenant(): Date;
}

const store = () => import("./services/metricool/store");
export const depsMetricool: DepsMetricool = {
  etat: async (u) => (await store()).etatConnexionMetricool(u),
  verifier: async (cx, d, f) => (await import("./services/metricool/client")).postsMetricool(cx, d, f),
  enregistrer: async (u, cx, e, m) => (await store()).enregistrerConnexionMetricool(u, cx, e, m),
  supprimer: async (u) => (await store()).supprimerConnexionMetricool(u),
  maintenant: () => new Date(),
};

const champ = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function registerMetricoolRoutes(app: Express, deps: DepsMetricool = depsMetricool): void {
  app.get("/api/metricool/connexion", isAuthenticated, async (req: any, res) => {
    try {
      const { connecte, etat, blogId } = (await deps.etat(req.userId)) as any;
      res.json(connecte ? { connecte, etat, blogId } : { connecte: false });
    } catch (e: any) {
      console.error("[metricool] état :", e?.message);
      res.status(500).json({ message: "Lecture impossible" });
    }
  });

  app.put("/api/metricool/connexion", isAuthenticated, async (req: any, res) => {
    try {
      const jeton = champ(req.body?.jeton); const mcUserId = champ(req.body?.mcUserId); const blogId = champ(req.body?.blogId);
      if (!jeton || !mcUserId || !blogId) return res.status(400).json({ message: "jeton, mcUserId et blogId requis" });
      const cx = { jeton, mcUserId, blogId };
      const fin = deps.maintenant();
      const r = await deps.verifier(cx, new Date(fin.getTime() - 86_400_000), fin);
      if (!r.ok) return res.status(422).json({ message: r.raison });
      await deps.enregistrer(req.userId, cx, "ok", fin);
      res.json({ connecte: true, etat: "ok" });
    } catch (e: any) {
      console.error("[metricool] connexion :", e?.message);
      res.status(500).json({ message: "Connexion impossible" });
    }
  });

  app.delete("/api/metricool/connexion", isAuthenticated, async (req: any, res) => {
    try {
      await deps.supprimer(req.userId);
      res.json({ connecte: false });
    } catch (e: any) {
      console.error("[metricool] déconnexion :", e?.message);
      res.status(500).json({ message: "Déconnexion impossible" });
    }
  });
}
