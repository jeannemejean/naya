// server/routes-gestion-posts.ts — gestion des posts du calendrier (lot 2, inspiré de Metricool) :
// notes internes, historique, duplication vers d'autres marques, corbeille et actions groupées.
// Tout passe par req.userId : le post (ou la marque) d'un autre compte est introuvable (404).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { depsGestionPosts, type DepsGestionPosts } from "./services/gestion-posts/deps";
import {
  copiePourDuplication, dateCorbeilleLimite, lireActionGroupee, lireTexteNote, trierPourAction,
} from "@shared/gestion-posts";

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Les marques visées par une duplication : `projectIds`, sinon `projectId` (null = sans marque), sinon celle du post. */
function lireCibles(body: any, post: { projectId: number | null }): Array<number | null> | null {
  if (body?.projectIds !== undefined) {
    if (!Array.isArray(body.projectIds) || body.projectIds.length === 0 || body.projectIds.length > 20) return null;
    if (!body.projectIds.every((x: unknown) => idPositif(x) != null)) return null;
    return Array.from(new Set(body.projectIds.map(Number)));
  }
  if (body?.projectId === null) return [null];
  if (body?.projectId !== undefined) return idPositif(body.projectId) != null ? [Number(body.projectId)] : null;
  return [post.projectId ?? null];
}

/** Date facultative : absente → celle du post ; null → aucune ; illisible → erreur. */
function lireDate(v: unknown): Date | null | undefined | "invalide" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? "invalide" : d;
}

async function marquesAElle(deps: DepsGestionPosts, userId: string, cibles: Array<number | null>): Promise<boolean> {
  for (const pid of cibles) if (pid != null && !(await deps.projet(pid, userId))) return false;
  return true;
}

async function dupliquer(deps: DepsGestionPosts, userId: string, post: any, cibles: Array<number | null>, quand?: Date | null) {
  const crees = [];
  for (const projectId of cibles) {
    const copie = await deps.creer(copiePourDuplication(post, { projectId, scheduledFor: quand }));
    crees.push(copie);
    await deps.journaliser(userId, post.id, "duplique", { versProjetId: projectId, nouveauId: copie.id });
    await deps.journaliser(userId, copie.id, "cree", { depuis: post.id });
  }
  return crees;
}

export function registerGestionPostsRoutes(app: Express, deps: DepsGestionPosts = depsGestionPosts): void {
  // ── Corbeille ──────────────────────────────────────────────────────────────────────
  app.get("/api/content/corbeille", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await deps.corbeille(req.userId, dateCorbeilleLimite(new Date())));
    } catch (e: any) {
      console.error("[GestionPosts] corbeille:", e?.message);
      res.status(500).json({ message: "corbeille_failed" });
    }
  });

  app.post("/api/content/:id/restaurer", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.postMemeSupprime(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      if (!(post as any).supprimeLe || !(await deps.restaurer(post.id, req.userId))) {
        return res.status(409).json({ message: "pas_dans_la_corbeille" });
      }
      await deps.journaliser(req.userId, post.id, "restaure", null);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[GestionPosts] restaurer:", e?.message);
      res.status(500).json({ message: "restauration_failed" });
    }
  });

  // Suppression définitive, seulement depuis la corbeille (même chemin que l'ancienne
  // suppression : ses tâches non faites partent avec lui, les faites restent détachées).
  app.delete("/api/content/:id/definitif", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.postMemeSupprime(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      if (!(post as any).supprimeLe) return res.status(409).json({ message: "pas_dans_la_corbeille" });
      await deps.supprimerDefinitivement(post.id);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[GestionPosts] suppression définitive:", e?.message);
      res.status(500).json({ message: "suppression_failed" });
    }
  });

  // ── Actions groupées (calendrier) ─────────────────────────────────────────────────
  app.post("/api/content/actions-groupees", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const a = lireActionGroupee(req.body);
      if (!a) return res.status(400).json({ message: "invalide" });
      const posts = await deps.posts(userId, a.ids);
      // Tous les posts doivent être à elle (et hors corbeille) : sinon rien n'est touché.
      if (posts.length !== a.ids.length) return res.status(404).json({ message: "not_found" });
      if (a.action === "dupliquer" && !(await marquesAElle(deps, userId, a.projectIds))) {
        return res.status(404).json({ message: "projet_introuvable" });
      }
      const ordre = new Map(a.ids.map((id, i) => [id, i]));
      posts.sort((x, y) => (ordre.get(x.id) ?? 0) - (ordre.get(y.id) ?? 0));
      const { retenus, ignores } = trierPourAction(posts as any[], a, new Date());
      const traites: number[] = [];
      const crees: any[] = [];
      for (const { post, scheduledFor } of retenus) {
        if (a.action === "dupliquer") {
          crees.push(...(await dupliquer(deps, userId, post, a.projectIds)));
          traites.push(post.id);
        } else if (a.action === "supprimer") {
          if (await deps.mettreALaCorbeille(post.id, userId)) {
            traites.push(post.id);
            await deps.journaliser(userId, post.id, "supprime", { etaitProgramme: post.autoPost === true });
          } else ignores.push({ id: post.id, raison: "en_cours" });
        } else if (scheduledFor) {
          if (await deps.deplacer(post.id, userId, scheduledFor)) {
            traites.push(post.id);
            await deps.journaliser(userId, post.id, "date_modifiee", {
              avant: post.scheduledFor ? new Date(post.scheduledFor).toISOString() : null, apres: scheduledFor.toISOString(),
            });
            await deps.relancerValidation?.(userId, post, { scheduledFor });
          } else ignores.push({ id: post.id, raison: "en_cours" });
        }
      }
      res.json({ action: a.action, traites, ignores, ...(a.action === "dupliquer" ? { crees } : {}) });
    } catch (e: any) {
      console.error("[GestionPosts] action groupée:", e?.message);
      res.status(500).json({ message: "action_groupee_failed" });
    }
  });

  // ── Dupliquer vers une ou plusieurs marques ───────────────────────────────────────
  app.post("/api/content/:id/dupliquer", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.post(id, userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      const cibles = lireCibles(req.body, post as any);
      if (!cibles) return res.status(400).json({ message: "invalide" });
      const quand = lireDate(req.body?.scheduledFor);
      if (quand === "invalide") return res.status(400).json({ message: "invalid_date" });
      if (!(await marquesAElle(deps, userId, cibles))) return res.status(404).json({ message: "projet_introuvable" });
      const crees = await dupliquer(deps, userId, post, cibles, quand);
      res.status(201).json({ crees });
    } catch (e: any) {
      console.error("[GestionPosts] dupliquer:", e?.message);
      res.status(500).json({ message: "duplication_failed" });
    }
  });

  // ── Notes internes ────────────────────────────────────────────────────────────────
  app.get("/api/content/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.postMemeSupprime(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      res.json(await deps.notes(req.userId, post.id));
    } catch (e: any) {
      console.error("[GestionPosts] notes:", e?.message);
      res.status(500).json({ message: "notes_failed" });
    }
  });

  app.post("/api/content/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.postMemeSupprime(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      const texte = lireTexteNote(req.body);
      if (!texte) return res.status(400).json({ message: "invalide" });
      const note = await deps.ajouterNote(req.userId, post.id, texte);
      await deps.journaliser(req.userId, post.id, "note_ajoutee", null);
      res.status(201).json(note);
    } catch (e: any) {
      console.error("[GestionPosts] ajout de note:", e?.message);
      res.status(500).json({ message: "notes_failed" });
    }
  });

  app.delete("/api/content/:id/notes/:noteId", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const noteId = idPositif(req.params.noteId);
      const post = id == null ? undefined : await deps.postMemeSupprime(id, req.userId);
      if (!post || noteId == null) return res.status(404).json({ message: "not_found" });
      if (!(await deps.supprimerNote(req.userId, post.id, noteId))) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[GestionPosts] suppression de note:", e?.message);
      res.status(500).json({ message: "notes_failed" });
    }
  });

  // ── Historique ────────────────────────────────────────────────────────────────────
  app.get("/api/content/:id/historique", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await deps.postMemeSupprime(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      const evenements: any[] = await deps.historique(req.userId, post.id);
      // Les posts antérieurs au journal : leur création se lit sur la ligne elle-même.
      if (!evenements.some((e) => e.evenement === "cree") && post.createdAt) {
        evenements.push({ id: null, evenement: "cree", details: null, createdAt: post.createdAt });
      }
      res.json(evenements);
    } catch (e: any) {
      console.error("[GestionPosts] historique:", e?.message);
      res.status(500).json({ message: "historique_failed" });
    }
  });
}
