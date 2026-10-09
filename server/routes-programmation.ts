// server/routes-programmation.ts — programmer un post du calendrier de contenu.
//
// Programmer = autoPost passe à true : le worker social-publisher publie le post à son
// heure, sur le compte connecté. Rien ne part sans ce clic. Les règles (ce qui bloque, le
// format qui part) sont dans @shared/programmation ; ici on lit l'état et on l'écrit.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import {
  compteDuPost, formatDePublication, plateformeDe, problemesProgrammation, type GenreMedia,
} from "@shared/programmation";

const EN_COURS = ["posting", "uploading", "processing"];

async function etatProgrammation(userId: string, post: any) {
  const ids = Array.isArray(post.mediaIds) ? (post.mediaIds as unknown[]).map(Number) : [];
  const medias: GenreMedia[] = [];
  for (const id of ids) {
    const m = await storage.getMediaItemById(id, userId);
    if (m?.url) medias.push((m.mimeType || "").startsWith("video/") ? "video" : "image");
  }
  if (medias.length === 0 && post.mediaUrl) medias.push("image");
  const comptes = (await storage.getSocialAccounts(userId)) as any[];
  const compte = compteDuPost(post, comptes);
  return {
    programme: post.autoPost === true && post.postStatus !== "posted",
    etat: post.postStatus ?? "pending",
    derniereErreur: post.lastError ?? null,
    publieLe: post.publishedAt ?? null,
    scheduledFor: post.scheduledFor ?? null,
    plateforme: plateformeDe(post.platform),
    compte: compte ? { id: compte.id, platform: compte.platform, accountName: compte.accountName ?? null, isActive: compte.isActive, expiresAt: compte.expiresAt ?? null } : null,
    medias,
    format: formatDePublication(post.postFormat, medias),
    nbVisuels: medias.length,
    problemes: problemesProgrammation({ post, medias, compte, maintenant: new Date() }),
  };
}

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerProgrammationRoutes(app: Express): void {
  app.get("/api/content/:id/programmation", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await storage.getContentById(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      res.json(await etatProgrammation(req.userId, post));
    } catch (e: any) {
      console.error("[Programmation] lecture:", e?.message);
      res.status(500).json({ message: "programmation_read_failed" });
    }
  });

  // Programme le post. Le texte et la date en cours d'édition dans la fenêtre partent avec
  // la demande : on programme ce que l'utilisatrice voit, pas une version plus ancienne.
  app.post("/api/content/:id/programmation", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      let post: any = id == null ? undefined : await storage.getContentById(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      if (EN_COURS.includes(post.postStatus)) return res.status(409).json({ message: "publication_en_cours" });

      const { body, title, scheduledFor } = req.body ?? {};
      const maj: Record<string, unknown> = {};
      if (typeof body === "string") maj.body = body;
      if (typeof title === "string" && title.trim()) maj.title = title;
      if (scheduledFor !== undefined) {
        const d = scheduledFor ? new Date(scheduledFor) : null;
        if (d && isNaN(d.getTime())) return res.status(400).json({ message: "invalid_date" });
        maj.scheduledFor = d;
      }
      if (Object.keys(maj).length) post = await storage.updateContent(post.id, maj as any);

      const etat = await etatProgrammation(req.userId, post);
      if (etat.problemes.length) return res.status(422).json({ message: "programmation_impossible", ...etat });

      post = await storage.updateContent(post.id, {
        autoPost: true,
        postStatus: "pending",
        lastError: null,
        socialAccountId: etat.compte!.id,
        platform: etat.plateforme,
        contentStatus: "ready",
      } as any);
      res.json(await etatProgrammation(req.userId, post));
    } catch (e: any) {
      console.error("[Programmation] programmer:", e?.message);
      res.status(500).json({ message: "programmation_failed" });
    }
  });

  // Annule la programmation : le post reste dans le calendrier, il ne part plus seul.
  app.delete("/api/content/:id/programmation", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      let post: any = id == null ? undefined : await storage.getContentById(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      if (EN_COURS.includes(post.postStatus)) return res.status(409).json({ message: "publication_en_cours" });
      if (post.postStatus === "posted") return res.status(409).json({ message: "deja_publie" });
      post = await storage.updateContent(post.id, { autoPost: false, postStatus: "pending" } as any);
      res.json(await etatProgrammation(req.userId, post));
    } catch (e: any) {
      console.error("[Programmation] annuler:", e?.message);
      res.status(500).json({ message: "programmation_cancel_failed" });
    }
  });
}
