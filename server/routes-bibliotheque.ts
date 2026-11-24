// server/routes-bibliotheque.ts — Bibliothèque (lot 3, inspiré de Metricool) : textes
// enregistrés et posts modèles ; et aperçu de la grille Instagram d'une marque (lot 4).
// Tout passe par req.userId : le texte, le modèle, le post ou la marque d'un autre compte est
// introuvable (404). Utiliser un modèle crée un brouillon, jamais programmé.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { depsBibliotheque, type DepsBibliotheque } from "./services/bibliotheque/deps";
import { comptesDuPerimetre, porteeReseauxDe } from "./services/connexions/portee";
import {
  contenuDeModele, lireNomModele, lireTexteEnregistre, lireUtilisation, postDepuisModele, type ContenuModele,
} from "@shared/bibliotheque";
import { tuilesInstagram } from "@shared/apercu-instagram";

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Une marque facultative : null passe ; un id doit être à elle. */
async function marqueAElle(deps: DepsBibliotheque, userId: string, projectId: number | null | undefined): Promise<boolean> {
  return projectId == null || !!(await deps.projet(projectId, userId));
}

export function registerBibliothequeRoutes(app: Express, deps: DepsBibliotheque = depsBibliotheque): void {
  // ── Textes enregistrés ────────────────────────────────────────────────────────────
  app.get("/api/bibliotheque/textes", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await deps.textes(req.userId));
    } catch (e: any) {
      console.error("[Bibliothèque] textes:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  app.post("/api/bibliotheque/textes", isAuthenticated, async (req: any, res) => {
    try {
      const v = lireTexteEnregistre(req.body);
      if (!v) return res.status(400).json({ message: "invalide" });
      if (!(await marqueAElle(deps, req.userId, v.projectId))) return res.status(404).json({ message: "projet_introuvable" });
      res.status(201).json(await deps.creerTexte(req.userId, v as { titre: string; texte: string; projectId: number | null }));
    } catch (e: any) {
      console.error("[Bibliothèque] création de texte:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  app.patch("/api/bibliotheque/textes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const v = lireTexteEnregistre(req.body, true);
      if (!v) return res.status(400).json({ message: "invalide" });
      if (!(await marqueAElle(deps, req.userId, v.projectId))) return res.status(404).json({ message: "projet_introuvable" });
      const t = await deps.modifierTexte(req.userId, id, v);
      if (!t) return res.status(404).json({ message: "not_found" });
      res.json(t);
    } catch (e: any) {
      console.error("[Bibliothèque] modification de texte:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  app.delete("/api/bibliotheque/textes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null || !(await deps.supprimerTexte(req.userId, id))) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Bibliothèque] suppression de texte:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  // ── Posts modèles ─────────────────────────────────────────────────────────────────
  app.get("/api/bibliotheque/modeles", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await deps.modeles(req.userId));
    } catch (e: any) {
      console.error("[Bibliothèque] modèles:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  app.post("/api/content/:id/enregistrer-modele", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.post(id, userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      const nom = lireNomModele(req.body);
      if (!nom) return res.status(400).json({ message: "invalide" });
      const freres = post.crossPostGroupId ? (await deps.freres(userId, post.crossPostGroupId)).filter((f) => f.id !== post.id) : [];
      const contenu = contenuDeModele(post as any, freres as any[]);
      res.status(201).json(await deps.creerModele(userId, { nom, projectId: post.projectId ?? null, contenu }));
    } catch (e: any) {
      console.error("[Bibliothèque] enregistrer un modèle:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  app.delete("/api/bibliotheque/modeles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null || !(await deps.supprimerModele(req.userId, id))) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Bibliothèque] suppression de modèle:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  app.post("/api/bibliotheque/modeles/:id/utiliser", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = idPositif(req.params.id);
      const modele = id == null ? undefined : await deps.modele(userId, id);
      if (!modele) return res.status(404).json({ message: "not_found" });
      const u = lireUtilisation(req.body);
      if (!u) return res.status(400).json({ message: "invalide" });
      if (!(await marqueAElle(deps, userId, u.projectId))) return res.status(404).json({ message: "projet_introuvable" });
      const row = postDepuisModele(modele.contenu as ContenuModele, userId, u);
      if (!row) return res.status(400).json({ message: "reseau_absent_du_modele" });
      const post = await deps.creerPost(row);
      await deps.journaliser(userId, post.id, "cree", { modele: modele.nom });
      res.status(201).json(post);
    } catch (e: any) {
      console.error("[Bibliothèque] utiliser un modèle:", e?.message);
      res.status(500).json({ message: "bibliotheque_failed" });
    }
  });

  // ── Aperçu de la grille Instagram (lot 4) ─────────────────────────────────────────
  // Un post appartient à une marque par son projectId ; sans marque → les posts sans projet
  // (compte des Réglages). Le compte affiché suit la règle du composeur (comptesDuPerimetre).
  app.get("/api/content/apercu-instagram", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      let projet: { id: number; projectKind?: string | null } | undefined;
      if (req.query.projectId !== undefined && req.query.projectId !== "") {
        const pid = idPositif(req.query.projectId);
        projet = pid == null ? undefined : await deps.projet(pid, userId);
        if (!projet) return res.status(404).json({ message: "projet_introuvable" });
      }
      const maintenant = new Date();
      const posts = await deps.postsInstagram(userId, projet?.id ?? null, new Date(maintenant.getTime() - 24 * 3_600_000));
      const ids = Array.from(new Set(posts.flatMap((p) => {
        const m = Array.isArray(p.mediaIds) ? (p.mediaIds as unknown[]) : [];
        const n = Number(m[0]);
        return Number.isInteger(n) && n > 0 ? [n] : [];
      })));
      const medias = new Map((await deps.medias(userId, ids)).map((m) => [m.id, m]));
      const tuiles = tuilesInstagram(posts as any[], medias, maintenant);
      const compte = comptesDuPerimetre(await deps.comptes(userId), porteeReseauxDe(projet ?? null))
        .find((c) => c.isActive !== false && String(c.platform).toLowerCase() === "instagram");
      res.json({ compte: compte ? { id: compte.id, accountName: compte.accountName ?? null } : null, tuiles });
    } catch (e: any) {
      console.error("[Bibliothèque] aperçu Instagram:", e?.message);
      res.status(500).json({ message: "apercu_failed" });
    }
  });
}
