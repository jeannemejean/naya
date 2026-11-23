// server/routes-autolistes.ts — Autolistes (lot 6, inspiré de Metricool) : une file de posts
// publiée seule à des créneaux récurrents. Tout passe par req.userId : la liste, le post, le
// modèle ou la marque d'un autre compte est introuvable (404) ; un compte hors du périmètre de
// la marque est refusé (400). Chaque changement repose la liste aussitôt (passage du
// planificateur), qui crée des posts ordinaires publiés par le worker habituel.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { depsAutolistes, type DepsAutolistes } from "./services/autolistes/deps";
import {
  materialiserAutoliste, reconstruireAutoliste, retirerDeLaFile, supprimerAutoliste,
} from "./services/autolistes/materialiser";
import { comptesDuPerimetre, porteeReseauxDe } from "./services/connexions/portee";
import { lireAutoliste, lireOrdre, POSTS_MAX, type AutolisteSaisie } from "@shared/autolistes";
import { contenuDeModele, type ContenuModele } from "@shared/bibliotheque";

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const compteVisible = (c: any) => ({
  id: c.id, platform: String(c.platform ?? "").toLowerCase(), accountName: c.accountName ?? null,
  isActive: c.isActive !== false, expiresAt: c.expiresAt ?? null, projectId: c.projectId ?? null,
});

/** Les comptes utilisables par une marque (null = sans marque) : règle du composeur. */
async function comptesDeLaMarque(deps: DepsAutolistes, userId: string, projectId: number | null): Promise<any[] | null> {
  let projet: { id: number; projectKind?: string | null } | undefined;
  if (projectId != null) {
    projet = await deps.projet(projectId, userId);
    if (!projet) return null;
  }
  return comptesDuPerimetre(await deps.comptes(userId), porteeReseauxDe(projet ?? null));
}

/** Un passage de pose qui échoue ne fait pas échouer la modification : le planificateur reprendra. */
async function reposer(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e: any) { console.error("[autolistes] pose après modification :", e?.message ?? e); }
}

export function registerAutolistesRoutes(app: Express, deps: DepsAutolistes = depsAutolistes): void {
  const lireListe = async (req: any, res: any) => {
    const id = idPositif(req.params.id);
    const liste = id == null ? undefined : await deps.liste(req.userId, id);
    if (!liste) { res.status(404).json({ message: "not_found" }); return undefined; }
    return liste;
  };

  app.get("/api/autolistes", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await deps.listes(req.userId));
    } catch (e: any) {
      console.error("[autolistes] listes :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  app.get("/api/autolistes/comptes", isAuthenticated, async (req: any, res) => {
    try {
      let projectId: number | null = null;
      if (req.query.projectId !== undefined && req.query.projectId !== "") {
        projectId = idPositif(req.query.projectId);
        if (projectId == null) return res.status(404).json({ message: "projet_introuvable" });
      }
      const comptes = await comptesDeLaMarque(deps, req.userId, projectId);
      if (!comptes) return res.status(404).json({ message: "projet_introuvable" });
      res.json(comptes.map(compteVisible));
    } catch (e: any) {
      console.error("[autolistes] comptes :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  app.post("/api/autolistes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const v = lireAutoliste(req.body) as AutolisteSaisie | null;
      if (!v) return res.status(400).json({ message: "invalide" });
      const permis = await comptesDeLaMarque(deps, userId, v.projectId);
      if (!permis) return res.status(404).json({ message: "projet_introuvable" });
      if (!v.comptes.every((id) => permis.some((c) => c.id === id))) return res.status(400).json({ message: "compte_hors_perimetre" });
      const liste = await deps.creerListe(userId, v);
      await reposer(() => materialiserAutoliste(deps.materialiser, userId, liste.id));
      res.status(201).json((await deps.liste(userId, liste.id)) ?? liste);
    } catch (e: any) {
      console.error("[autolistes] création :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  app.get("/api/autolistes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const liste = await lireListe(req, res);
      if (!liste) return;
      const [posts, materialisations] = await Promise.all([
        deps.posts(liste.id),
        deps.materialisationsAVenir(req.userId, liste.id, new Date()),
      ]);
      res.json({ autoliste: liste, posts, materialisations });
    } catch (e: any) {
      console.error("[autolistes] lecture :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  app.patch("/api/autolistes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const liste = await lireListe(req, res);
      if (!liste) return;
      const v = lireAutoliste(req.body, true);
      if (!v) return res.status(400).json({ message: "invalide" });
      if (v.projectId !== undefined || v.comptes !== undefined) {
        const projectId = v.projectId !== undefined ? v.projectId : liste.projectId ?? null;
        const comptes = v.comptes ?? (Array.isArray(liste.comptes) ? (liste.comptes as number[]) : []);
        const permis = await comptesDeLaMarque(deps, userId, projectId);
        if (!permis) return res.status(404).json({ message: "projet_introuvable" });
        if (!comptes.every((id) => permis.some((c) => c.id === id))) return res.status(400).json({ message: "compte_hors_perimetre" });
      }
      const maj = await deps.modifierListe(userId, liste.id, v);
      if (!maj) return res.status(404).json({ message: "not_found" });
      // Un simple changement de nom ne touche pas aux posts posés.
      if (Object.keys(v).some((k) => k !== "nom")) await reposer(() => reconstruireAutoliste(deps.materialiser, userId, liste.id));
      res.json((await deps.liste(userId, liste.id)) ?? maj);
    } catch (e: any) {
      console.error("[autolistes] modification :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  app.delete("/api/autolistes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const liste = await lireListe(req, res);
      if (!liste) return;
      const ok = await supprimerAutoliste(deps.materialiser, userId, liste.id, () => deps.supprimerListe(userId, liste.id));
      if (!ok) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[autolistes] suppression :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  // Ajouter un post à la file (en fin) : depuis un post du calendrier ({ contentId }) — son
  // texte par réseau (frères du même envoi), ses visuels, son format et ses options, comme un
  // modèle — ou depuis un modèle de la bibliothèque ({ modeleId }).
  app.post("/api/autolistes/:id/posts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const liste = await lireListe(req, res);
      if (!liste) return;
      const b = (req.body ?? {}) as Record<string, unknown>;
      let contenu: ContenuModele | null = null;
      if (b.contentId !== undefined) {
        const cid = idPositif(b.contentId);
        const post = cid == null ? undefined : await deps.post(cid, userId);
        if (!post) return res.status(404).json({ message: "post_introuvable" });
        const freres = post.crossPostGroupId ? (await deps.freres(userId, post.crossPostGroupId)).filter((f) => f.id !== post.id) : [];
        contenu = contenuDeModele(post as any, freres as any[]);
      } else if (b.modeleId !== undefined) {
        const mid = idPositif(b.modeleId);
        const modele = mid == null ? undefined : await deps.modele(userId, mid);
        if (!modele) return res.status(404).json({ message: "modele_introuvable" });
        contenu = modele.contenu as ContenuModele;
      }
      if (!contenu) return res.status(400).json({ message: "invalide" });
      const posts = await deps.posts(liste.id);
      if (posts.length >= POSTS_MAX) return res.status(409).json({ message: "liste_pleine" });
      const ajoute = await deps.ajouterPost(liste.id, contenu);
      await reposer(() => materialiserAutoliste(deps.materialiser, userId, liste.id));
      res.status(201).json(ajoute);
    } catch (e: any) {
      console.error("[autolistes] ajout d'un post :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  // Remettre en file (actif) un post consommé, ou le mettre de côté.
  app.patch("/api/autolistes/:id/posts/:postId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const liste = await lireListe(req, res);
      if (!liste) return;
      const pid = idPositif(req.params.postId);
      if (typeof req.body?.actif !== "boolean") return res.status(400).json({ message: "invalide" });
      const p = pid == null ? undefined : await deps.modifierPost(liste.id, pid, { actif: req.body.actif });
      if (!p) return res.status(404).json({ message: "not_found" });
      await reposer(() => reconstruireAutoliste(deps.materialiser, userId, liste.id));
      res.json(p);
    } catch (e: any) {
      console.error("[autolistes] modification d'un post :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  app.delete("/api/autolistes/:id/posts/:postId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const liste = await lireListe(req, res);
      if (!liste) return;
      const pid = idPositif(req.params.postId);
      if (pid == null) return res.status(404).json({ message: "not_found" });
      const ok = await retirerDeLaFile(deps.materialiser, userId, liste.id, pid, () => deps.supprimerPost(liste.id, pid));
      if (!ok) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[autolistes] retrait d'un post :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });

  // Nouvel ordre de la file : { ids } = tous les posts de la liste, dans l'ordre voulu.
  app.put("/api/autolistes/:id/ordre", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const liste = await lireListe(req, res);
      if (!liste) return;
      const posts = await deps.posts(liste.id);
      const ordre = lireOrdre(req.body, posts.map((p) => p.id));
      if (!ordre) return res.status(400).json({ message: "invalide" });
      const avant = new Map(posts.map((p) => [p.id, p.ordre]));
      for (let i = 0; i < ordre.length; i++) {
        if (avant.get(ordre[i]) !== i) await deps.modifierPost(liste.id, ordre[i], { ordre: i });
      }
      await reposer(() => reconstruireAutoliste(deps.materialiser, userId, liste.id));
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[autolistes] ordre :", e?.message);
      res.status(500).json({ message: "autolistes_failed" });
    }
  });
}
