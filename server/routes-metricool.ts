// Connexion Metricool (Réglages) : GET /api/metricool/connexion (état seulement, jamais le jeton),
// POST /api/metricool/marques (jeton + mcUserId → les marques du compte, à cocher),
// PUT (jeton, mcUserId, blogIds cochés — toutes si absent → vérifié par un appel sur 1 jour, puis chiffré), DELETE.
// C'est l'utilisatrice qui colle son jeton (Metricool > Réglages du compte > API).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import type { ConnexionMarquesMc, ConnexionMc, MarqueMc, PostMc, RefusMc } from "./services/metricool/client";

export interface DepsMetricool {
  etat(userId: string): Promise<Record<string, unknown>>;
  /** Connexion enregistrée (jeton déchiffré), pour changer de marques sans recoller le jeton. */
  lire(userId: string): Promise<ConnexionMarquesMc | null>;
  marques(jeton: string, mcUserId: string): Promise<{ ok: true; marques: MarqueMc[] } | RefusMc>;
  verifier(cx: ConnexionMc, debut: Date, fin: Date): Promise<{ ok: true; posts: PostMc[] } | RefusMc>;
  enregistrer(userId: string, cx: ConnexionMarquesMc, etat: "ok" | "refuse", maintenant: Date): Promise<void>;
  supprimer(userId: string): Promise<void>;
  maintenant(): Date;
}

const store = () => import("./services/metricool/store");
export const depsMetricool: DepsMetricool = {
  etat: async (u) => (await store()).etatConnexionMetricool(u),
  lire: async (u) => (await store()).lireConnexionMetricool(u),
  marques: async (j, u) => (await import("./services/metricool/client")).marquesMetricool(j, u),
  verifier: async (cx, d, f) => (await import("./services/metricool/client")).postsMetricool(cx, d, f),
  enregistrer: async (u, cx, e, m) => (await store()).enregistrerConnexionMetricool(u, cx, e, m),
  supprimer: async (u) => (await store()).supprimerConnexionMetricool(u),
  maintenant: () => new Date(),
};

const champ = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Jeton et userId collés, sinon ceux de la connexion déjà enregistrée. */
async function identifiants(deps: DepsMetricool, userId: string, body: any): Promise<{ jeton: string; mcUserId: string } | null> {
  const jeton = champ(body?.jeton); const mcUserId = champ(body?.mcUserId);
  if (jeton && mcUserId) return { jeton, mcUserId };
  if (jeton || mcUserId) return null;
  const cx = await deps.lire(userId);
  return cx ? { jeton: cx.jeton, mcUserId: cx.mcUserId } : null;
}

export function registerMetricoolRoutes(app: Express, deps: DepsMetricool = depsMetricool): void {
  app.get("/api/metricool/connexion", isAuthenticated, async (req: any, res) => {
    try {
      const { connecte, etat, marques } = (await deps.etat(req.userId)) as any;
      res.json(connecte ? { connecte, etat, marques } : { connecte: false });
    } catch (e: any) {
      console.error("[metricool] état :", e?.message);
      res.status(500).json({ message: "Lecture impossible" });
    }
  });

  app.post("/api/metricool/marques", isAuthenticated, async (req: any, res) => {
    try {
      const id = await identifiants(deps, req.userId, req.body);
      if (!id) return res.status(400).json({ message: "jeton et mcUserId requis" });
      const r = await deps.marques(id.jeton, id.mcUserId);
      if (!r.ok) return res.status(422).json({ message: r.raison });
      res.json({ marques: r.marques });
    } catch (e: any) {
      console.error("[metricool] marques :", e?.message);
      res.status(500).json({ message: "Lecture impossible" });
    }
  });

  app.put("/api/metricool/connexion", isAuthenticated, async (req: any, res) => {
    try {
      const id = await identifiants(deps, req.userId, req.body);
      if (!id) return res.status(400).json({ message: "jeton et mcUserId requis" });
      const { jeton, mcUserId } = id;
      const coches = Array.isArray(req.body?.blogIds) ? req.body.blogIds.map(String) : null;
      // Les noms viennent de Metricool, jamais du formulaire ; une marque inconnue est ignorée.
      const liste = await deps.marques(jeton, mcUserId);
      if (!liste.ok) return res.status(422).json({ message: liste.raison });
      const marques = coches ? liste.marques.filter((m) => coches.includes(m.blogId)) : liste.marques;
      if (!marques.length) return res.status(400).json({ message: "aucune_marque" });
      const fin = deps.maintenant();
      const r = await deps.verifier({ jeton, mcUserId, blogId: marques[0].blogId }, new Date(fin.getTime() - 86_400_000), fin);
      if (!r.ok) return res.status(422).json({ message: r.raison });
      await deps.enregistrer(req.userId, { jeton, mcUserId, marques }, "ok", fin);
      res.json({ connecte: true, etat: "ok", marques });
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
