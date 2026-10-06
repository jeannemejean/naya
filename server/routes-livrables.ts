// server/routes-livrables.ts — routes des livrables de tâche.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { lienValide, limiteOctets, typeAccepte, type LivrableKind } from "@shared/livrables";
import {
  createUploadUrl, createPrivateUploadUrl, createPrivateDownloadUrl,
  privateStorageConfigured, r2Configured,
} from "./services/r2-storage";
import { creerLivrable, modifierLivrable, supprimerLivrable, rattraperMemoire } from "./services/livrables/service";
import { livrablesDeps, listerLivrables } from "./services/livrables/deps";

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
      // Le lien est nettoyé avant validation et stockage.
      const url = kind === "lien" && typeof urlBrute === "string" ? urlBrute.trim() : urlBrute;
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
      if (kind === "fichier" && !url.startsWith(`livrables/${userId}/`)) {
        return res.status(400).json({ message: "invalid_url" }); // jamais la clé d'un autre compte
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
      res.status(201).json(l);
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
      const l = await modifierLivrable(livrablesDeps, id, req.userId,
        typeof content === "string" ? content : null);
      if (!l) return res.status(404).json({ message: "not_found" });
      res.json(l);
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
