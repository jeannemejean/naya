// server/routes-livrables.ts — routes des livrables de tâche.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { lienValide, limiteOctets, typeAccepte, type LivrableKind } from "@shared/livrables";
import {
  createUploadUrl, createPrivateUploadUrl, createPrivateDownloadUrl,
  privateStorageConfigured, r2Configured,
} from "./services/r2-storage";
import { creerLivrable, modifierLivrable, supprimerLivrable, rattraperMemoire } from "./services/livrables/service";
import { estCleFichierDe, estUrlMediaDe } from "./services/livrables/urls";
import { livrablesDeps, listerLivrables } from "./services/livrables/deps";
import { nourrirLePost, nouvelOrdreMedias, type PostDeps } from "./services/livrables/post";
import { effetSurPost, postModifiable } from "@shared/livrables";

const postDeps: PostDeps = {
  lirePost: (id, userId) => storage.getContentById(id, userId) as any,
  majPost: (id, patch) => storage.updateContent(id, patch as any),
  ajouterMedia: (id, mediaId) => db.execute(sql`
    UPDATE content
       SET media_ids = COALESCE(media_ids, '[]'::jsonb) || jsonb_build_array(${mediaId}::int),
           updated_at = now()
     WHERE id = ${id}
       AND NOT (COALESCE(media_ids, '[]'::jsonb) @> jsonb_build_array(${mediaId}::int))`),
};

/** La tâche si elle appartient à l'utilisateur (getTask ne filtre pas par compte). */
async function tacheDe(userId: string, taskId: number | null | undefined) {
  if (taskId == null) return undefined;
  const t = await storage.getTask(taskId);
  return t && t.userId === userId ? t : undefined;
}

const KINDS: LivrableKind[] = ["texte", "media", "fichier", "lien"];

/** Entier strictement positif, sinon null (évite les requêtes avec NaN). */
function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerLivrablesRoutes(app: Express): void {
  app.get("/api/livrables/config", isAuthenticated, (_req, res) => {
    res.json({ fichiers: privateStorageConfigured(), medias: r2Configured() });
  });

  app.get("/api/tasks/:id/livrables", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(400).json({ message: "invalid_id" });
      const liste = await listerLivrables(req.userId, { taskId: id });
      rattraperMemoire(livrablesDeps, liste).catch(() => {}); // paresseux, sans bloquer
      res.json(liste);
    } catch (e: any) {
      console.error("[Livrables] liste tâche:", e?.message);
      res.status(500).json({ message: "livrables_read_failed" });
    }
  });

  app.get("/api/projects/:id/livrables", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(400).json({ message: "invalid_id" });
      const liste = await listerLivrables(req.userId, { projectId: id });
      rattraperMemoire(livrablesDeps, liste).catch(() => {});
      res.json(liste);
    } catch (e: any) {
      console.error("[Livrables] liste projet:", e?.message);
      res.status(500).json({ message: "livrables_read_failed" });
    }
  });

  // Le post auquel une tâche de production est rattachée : aperçu dans la tâche, et ce
  // que le dépôt y changera. `null` quand la tâche n'a pas de post.
  app.get("/api/tasks/:id/post", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(400).json({ message: "invalid_id" });
      const tache = await tacheDe(req.userId, id);
      if (!tache) return res.status(404).json({ message: "not_found" });
      const contentId = (tache as any).contentId as number | null;
      if (contentId == null) return res.json(null);
      const post = await storage.getContentById(contentId, req.userId);
      if (!post) return res.json(null);
      const ids = Array.isArray((post as any).mediaIds) ? ((post as any).mediaIds as unknown[]).map(Number) : [];
      const medias = (await Promise.all(ids.map((m) => storage.getMediaItemById(m, req.userId))))
        .filter(Boolean)
        .map((m: any) => ({ id: m.id, url: m.url, mimeType: m.mimeType }));
      if (medias.length === 0 && (post as any).mediaUrl) medias.push({ id: 0, url: (post as any).mediaUrl, mimeType: "image/*" });
      res.json({
        id: post.id,
        title: post.title,
        body: post.body,
        platform: post.platform,
        postFormat: (post as any).postFormat ?? null,
        scheduledFor: (post as any).scheduledFor ?? null,
        modifiable: postModifiable((post as any).postStatus),
        medias,
        effet: effetSurPost(tache.title),
      });
    } catch (e: any) {
      console.error("[Livrables] post de la tâche:", e?.message);
      res.status(500).json({ message: "post_read_failed" });
    }
  });

  // Réordonner les visuels d'un post (glisser-déposer dans le calendrier de contenu).
  // L'ordre est celui de la publication (carrousel). Écriture conditionnelle sur la liste
  // relue : si un visuel arrive au même moment, on recommence avec la liste à jour.
  app.put("/api/content/:id/medias/ordre", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const demande = req.body?.mediaIds;
      if (id == null || !Array.isArray(demande)) return res.status(400).json({ message: "invalid_request" });
      for (let essai = 0; essai < 3; essai++) {
        const post = await storage.getContentById(id, req.userId);
        if (!post) return res.status(404).json({ message: "not_found" });
        if (!postModifiable((post as any).postStatus)) return res.status(409).json({ message: "post_locked" });
        const actuels = Array.isArray((post as any).mediaIds) ? ((post as any).mediaIds as unknown[]).map(Number) : [];
        const ordre = nouvelOrdreMedias(actuels, demande);
        const r: any = await db.execute(sql`
          UPDATE content SET media_ids = ${JSON.stringify(ordre)}::jsonb, updated_at = now()
           WHERE id = ${id} AND user_id = ${req.userId}
             AND COALESCE(media_ids, '[]'::jsonb) = ${JSON.stringify(actuels)}::jsonb`);
        if ((r.rowCount ?? 0) > 0) return res.json({ mediaIds: ordre });
      }
      res.status(409).json({ message: "concurrent_update" });
    } catch (e: any) {
      console.error("[Livrables] ordre des visuels:", e?.message);
      res.status(500).json({ message: "media_order_failed" });
    }
  });

  app.post("/api/livrables/upload-url", isAuthenticated, async (req: any, res) => {
    try {
      const { kind, filename, contentType, size } = req.body ?? {};
      if ((kind !== "media" && kind !== "fichier") || !filename || !contentType) {
        return res.status(400).json({ message: "kind_filename_contentType_required" });
      }
      if (!typeAccepte(kind, contentType)) return res.status(400).json({ message: "unsupported_content_type" });
      if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > limiteOctets(kind, contentType)) {
        return res.status(400).json({ message: "file_too_large" });
      }
      if (kind === "fichier") {
        if (!privateStorageConfigured()) return res.status(503).json({ message: "private_storage_not_configured" });
        const out = await createPrivateUploadUrl({ userId: req.userId, filename, contentType });
        return res.json({ uploadUrl: out.uploadUrl, url: out.key });
      }
      if (!r2Configured()) return res.status(503).json({ message: "storage_not_configured" });
      const out = await createUploadUrl({ userId: req.userId, filename, contentType });
      res.json({ uploadUrl: out.uploadUrl, url: out.publicUrl });
    } catch (e: any) {
      console.error("[Livrables] upload-url:", e?.message);
      res.status(500).json({ message: "upload_url_failed" });
    }
  });

  app.post("/api/livrables", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { taskId, kind, content, url: urlBrute, fileName, mimeType, size } = req.body ?? {};
      // L'URL est nettoyée avant validation et stockage.
      const url = typeof urlBrute === "string" ? urlBrute.trim() : urlBrute;
      if (taskId != null && idPositif(taskId) == null) return res.status(400).json({ message: "invalid_task_id" });
      if (!KINDS.includes(kind)) return res.status(400).json({ message: "invalid_kind" });
      if (kind === "lien" && !(typeof url === "string" && lienValide(url))) {
        return res.status(400).json({ message: "invalid_url" });
      }
      if (kind === "texte" && !(typeof content === "string" && content.trim())) {
        return res.status(400).json({ message: "content_required" });
      }
      if ((kind === "media" || kind === "fichier") && !(typeof url === "string" && url)) {
        return res.status(400).json({ message: "url_required" });
      }
      // Forme exacte des URL/clés que nous avons produites : jamais l'objet d'un autre compte.
      if (kind === "media" && !estUrlMediaDe(userId, url)) {
        return res.status(400).json({ message: "invalid_url" });
      }
      if (kind === "fichier" && !estCleFichierDe(userId, url)) {
        return res.status(400).json({ message: "invalid_url" });
      }

      // getTask ne filtre pas par utilisateur : la tâche d'un autre compte est traitée comme introuvable.
      const found = taskId != null ? await storage.getTask(Number(taskId)) : undefined;
      const task = found && found.userId === userId ? found : undefined;
      if (taskId != null && !task) return res.status(404).json({ message: "task_not_found" });

      // Tâche sans projet → marque active (validé le 6 oct. 2026).
      let projectId: number | null = (task as any)?.projectId ?? null;
      if (projectId == null) {
        const prefs = await storage.getUserPreferences(userId);
        projectId = (prefs as any)?.activeProjectId ?? null;
      }

      // Le projet doit appartenir à l'utilisateur, sinon on l'ignore.
      if (projectId != null && !(await storage.getProject(projectId, userId))) projectId = null;

      const l = await creerLivrable(livrablesDeps, {
        userId,
        taskId: task ? task.id : null,
        taskTitle: task ? task.title : null,
        projectId,
        kind,
        content: typeof content === "string" ? content : null,
        url: typeof url === "string" ? url : null,
        fileName: typeof fileName === "string" ? fileName : null,
        mimeType: typeof mimeType === "string" ? mimeType : null,
        size: Number.isFinite(Number(size)) ? Number(size) : null,
      });
      // Tâche de production d'un post : le dépôt nourrit le post (texte ou visuel).
      const post = await nourrirLePost(postDeps, { userId, tache: task as any, livrable: l as any });
      res.status(201).json({ ...l, post });
    } catch (e: any) {
      console.error("[Livrables] création:", e?.message);
      res.status(500).json({ message: "livrable_create_failed" });
    }
  });

  app.patch("/api/livrables/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { content } = req.body ?? {};
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const existant = await livrablesDeps.lire(id, req.userId);
      if (!existant) return res.status(404).json({ message: "not_found" });
      if (existant.kind === "texte" && !(typeof content === "string" && content.trim())) {
        return res.status(400).json({ message: "content_required" });
      }
      const l = await modifierLivrable(livrablesDeps, id, req.userId,
        typeof content === "string" ? content : null);
      if (!l) return res.status(404).json({ message: "not_found" });
      const post = await nourrirLePost(postDeps, {
        userId: req.userId, tache: (await tacheDe(req.userId, l.taskId)) as any, livrable: l as any,
      });
      res.json({ ...l, post });
    } catch (e: any) {
      console.error("[Livrables] modification:", e?.message);
      res.status(500).json({ message: "livrable_update_failed" });
    }
  });

  app.delete("/api/livrables/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const ok = await supprimerLivrable(livrablesDeps, id, req.userId);
      if (!ok) return res.status(404).json({ message: "not_found" });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Livrables] suppression:", e?.message);
      res.status(500).json({ message: "livrable_delete_failed" });
    }
  });

  app.get("/api/livrables/:id/fichier", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const l = await livrablesDeps.lire(id, req.userId);
      if (!l || l.kind !== "fichier" || !l.url) return res.status(404).json({ message: "not_found" });
      const lien = await createPrivateDownloadUrl(l.url, l.fileName ?? "fichier");
      res.redirect(302, lien);
    } catch (e: any) {
      console.error("[Livrables] lecture fichier:", e?.message);
      res.status(500).json({ message: "file_read_failed" });
    }
  });
}
