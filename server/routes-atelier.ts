// server/routes-atelier.ts — l'atelier de contenu (spec 2026-10-14-atelier-contenu-design.md).
//
// Une semaine de posts sur un seul écran : Naya pré-rédige, l'utilisatrice corrige, ajoute
// les visuels et valide. Un post d'un autre compte est toujours introuvable (404).
import type { Express } from "express";
import { and, eq, sql } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { content } from "@shared/schema";
import { etatPost, genreDuPost, lundiDe, manquesPourValider, plusJours } from "@shared/atelier";
import { postModifiable } from "@shared/livrables";
import { jourDuPost } from "./services/campagne/production";
import { redigerPost, refairePost } from "./services/atelier/redaction";
import { validerPost, devaliderPost, lireModifications } from "./services/atelier/validation";
import { compteDuPost, depsRedaction, depsValidation, mediasDuPost } from "./services/atelier/deps";
import { creerLivrable } from "./services/livrables/service";
import { depsComptesMemorisees, type DepsComptes } from "./services/connexions/comptes";
import { livrablesDeps } from "./services/livrables/deps";
import { estUrlMediaDe } from "./services/livrables/urls";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Un post de la semaine, tel que l'écran de l'atelier le montre. */
async function vuePost(userId: string, p: any, noms: Map<number, string>, comptes: DepsComptes) {
  const [medias, compte] = await Promise.all([
    mediasDuPost(userId, p),
    compteDuPost(userId, p, comptes).catch(() => null),
  ]);
  const etat = etatPost(p);
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    consigne: p.consigne ?? null,
    platform: p.platform,
    postFormat: p.postFormat,
    genre: genreDuPost(p),
    scheduledFor: p.scheduledFor,
    projectId: p.projectId ?? null,
    projet: p.projectId != null ? noms.get(p.projectId) ?? null : null,
    campaignId: p.campaignId ?? null,
    tendanceProjetId: p.tendanceProjetId ?? null,
    etat,
    // Naya publiera seule ce post (programmé) ; sinon, validé, il attend une publication à la main.
    programme: p.autoPost === true && etat === "valide",
    erreurPublication: p.postStatus === "failed" ? (p.lastError ?? null) : null,
    medias: medias.map(({ id, url, mimeType, genre }) => ({ id, url, mimeType, genre })),
    manques: etat === "valide" || etat === "publie" ? [] : manquesPourValider({
      genre: genreDuPost(p), body: p.body, scheduledFor: p.scheduledFor, medias: medias.map((m) => m.genre), maintenant: new Date(),
    }),
    compteConnecte: !!compte,
  };
}

export function registerAtelierRoutes(app: Express): void {
  // La semaine (lundi YYYY-MM-DD) : ses posts et ses tâches d'atelier.
  app.get("/api/atelier/:semaine", isAuthenticated, async (req: any, res) => {
    try {
      const semaine = String(req.params.semaine);
      if (!JOUR.test(semaine) || lundiDe(semaine) !== semaine) return res.status(400).json({ message: "semaine_invalide" });
      const userId = req.userId;
      const posts = (await storage.getPostsEntre(userId, new Date(`${plusJours(semaine, -1)}T00:00:00Z`), new Date(`${plusJours(semaine, 8)}T00:00:00Z`)))
        .filter((p) => p.scheduledFor && lundiDe(jourDuPost(p.scheduledFor)) === semaine);
      // Tout en parallèle, chaque projet et la liste des comptes lus une seule fois : la page
      // attendait ici des dizaines d'allers-retours successifs vers la base.
      const comptes = depsComptesMemorisees();
      const pids = Array.from(new Set(posts.map((p) => p.projectId).filter((x): x is number => x != null)));
      const [projets, taches] = await Promise.all([
        Promise.all(pids.map((pid) => comptes.getProject(pid, userId))),
        storage.getTachesAtelier(userId, semaine),
      ]);
      const noms = new Map<number, string>();
      projets.forEach((pr, i) => { if (pr) noms.set(pids[i], pr.name); });
      const vues = await Promise.all(posts.map((p) => vuePost(userId, p, noms, comptes)));
      res.json({
        semaine,
        posts: vues,
        taches: taches.map((t) => ({ id: t.id, title: t.title, taskType: t.taskType, completed: t.completed, scheduledDate: t.scheduledDate, estimatedDuration: t.estimatedDuration })),
      });
    } catch (e: any) {
      console.error("[Atelier] lecture:", e?.message);
      res.status(500).json({ message: "atelier_read_failed" });
    }
  });

  // Naya rédige un post encore « à rédiger » (une seule fois ; sinon rien, sans dépense).
  app.post("/api/atelier/posts/:id/rediger", isAuthenticated, async (req: any, res) => {
    const id = idPositif(req.params.id);
    if (id == null) return res.status(404).json({ message: "not_found" });
    const r = await redigerPost(depsRedaction, req.userId, id);
    if (r.statut === "introuvable") return res.status(404).json({ message: "not_found" });
    if (r.statut === "refus") return res.status(402).json({ message: "budget" });
    if (r.statut === "erreur") return res.status(502).json({ message: "redaction_failed" });
    res.json(r);
  });

  // « Refaire » : une nouvelle version, avec une consigne courte facultative.
  app.post("/api/atelier/posts/:id/refaire", isAuthenticated, async (req: any, res) => {
    const id = idPositif(req.params.id);
    if (id == null) return res.status(404).json({ message: "not_found" });
    const consigne = typeof req.body?.consigne === "string" ? req.body.consigne : "";
    const r = await refairePost(depsRedaction, req.userId, id, consigne);
    if (r.statut === "introuvable") return res.status(404).json({ message: "not_found" });
    if (r.statut === "deja") return res.status(409).json({ message: "post_valide" });
    if (r.statut === "refus") return res.status(402).json({ message: "budget" });
    if (r.statut === "erreur") return res.status(502).json({ message: "redaction_failed" });
    res.json(r);
  });

  // Enregistrement au fil de la frappe (texte, titre, date, format). Un post validé se dévalide d'abord.
  app.patch("/api/atelier/posts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await storage.getContentById(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      if (!postModifiable(post.postStatus) || ["valide", "publie"].includes(etatPost(post as any))) {
        return res.status(409).json({ message: "post_valide" });
      }
      const patch = lireModifications(req.body ?? {});
      if (!patch) return res.status(400).json({ message: "invalide" });
      if (Object.keys(patch).length === 0) return res.json({ ok: true });
      // Écrire soi-même un post « à rédiger » en fait un brouillon (Naya ne le réécrira plus seule).
      if (typeof patch.body === "string" && etatPost(post as any) === "a_rediger") {
        patch.contentStatus = "draft";
        // Jamais une consigne vide : elle sert de verrou (« déjà rédigé »).
        if (post.consigne == null) patch.consigne = (post.body ?? "").trim() || post.title || "—";
      }
      await db.update(content).set({ ...(patch as any), updatedAt: new Date() })
        // Jamais sous un post validé entre-temps (il part tel que validé).
        .where(and(eq(content.id, post.id), eq(content.userId, req.userId), sql`coalesce(${content.contentStatus}, '') <> 'ready'`, sql`coalesce(${content.autoPost}, false) = false`));
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Atelier] enregistrement:", e?.message);
      res.status(500).json({ message: "atelier_save_failed" });
    }
  });

  app.post("/api/atelier/posts/:id/valider", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const r = await validerPost(depsValidation, req.userId, id, req.body ?? {});
      if (r.statut === "introuvable") return res.status(404).json({ message: "not_found" });
      if (r.statut === "invalide") return res.status(400).json({ message: "invalide" });
      if (r.statut === "en_cours" || r.statut === "deja_publie" || r.statut === "deja_valide") return res.status(409).json({ message: r.statut });
      if (r.statut === "manques") return res.status(422).json(r);
      res.json(r);
    } catch (e: any) {
      console.error("[Atelier] validation:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  app.delete("/api/atelier/posts/:id/valider", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      if (id == null) return res.status(404).json({ message: "not_found" });
      const r = await devaliderPost(depsValidation, req.userId, id);
      if (r.statut === "introuvable") return res.status(404).json({ message: "not_found" });
      if (r.statut !== "brouillon") return res.status(409).json({ message: r.statut });
      res.json(r);
    } catch (e: any) {
      console.error("[Atelier] dévalidation:", e?.message);
      res.status(500).json({ message: "devalidation_failed" });
    }
  });

  // Un visuel déposé dans l'atelier : rangé dans la médiathèque (comme un livrable) et joint au post.
  app.post("/api/atelier/posts/:id/visuels", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const post = id == null ? undefined : await storage.getContentById(id, req.userId);
      if (!post) return res.status(404).json({ message: "not_found" });
      if (!postModifiable(post.postStatus) || ["valide", "publie"].includes(etatPost(post as any))) {
        return res.status(409).json({ message: "post_valide" });
      }
      const { url, fileName, mimeType, size } = req.body ?? {};
      if (typeof url !== "string" || !estUrlMediaDe(req.userId, url.trim())) return res.status(400).json({ message: "invalid_url" });
      const l = await creerLivrable(livrablesDeps, {
        userId: req.userId, taskId: null, taskTitle: null, projectId: post.projectId ?? null, kind: "media", content: null,
        url: url.trim(), fileName: typeof fileName === "string" ? fileName : null,
        mimeType: typeof mimeType === "string" ? mimeType : null, size: Number.isFinite(Number(size)) ? Number(size) : null,
      });
      const mediaId = (l as any)?.mediaId;
      if (mediaId == null) return res.status(500).json({ message: "media_failed" });
      await db.execute(sql`
        UPDATE content
           SET media_ids = COALESCE(media_ids, '[]'::jsonb) || jsonb_build_array(${mediaId}::int), updated_at = now()
         WHERE id = ${post.id} AND user_id = ${req.userId}
           AND COALESCE(content_status, '') <> 'ready' AND NOT COALESCE(auto_post, false)
           AND NOT (COALESCE(media_ids, '[]'::jsonb) @> jsonb_build_array(${mediaId}::int))`);
      res.status(201).json({ mediaId });
    } catch (e: any) {
      console.error("[Atelier] visuel:", e?.message);
      res.status(500).json({ message: "visuel_failed" });
    }
  });

  // Retirer un visuel du post (il reste dans la médiathèque).
  app.delete("/api/atelier/posts/:id/visuels/:mediaId", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const mediaId = idPositif(req.params.mediaId);
      const post = id == null ? undefined : await storage.getContentById(id, req.userId);
      if (!post || mediaId == null) return res.status(404).json({ message: "not_found" });
      if (!postModifiable(post.postStatus) || ["valide", "publie"].includes(etatPost(post as any))) {
        return res.status(409).json({ message: "post_valide" });
      }
      await db.execute(sql`
        UPDATE content
           SET media_ids = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(COALESCE(media_ids, '[]'::jsonb)) x
                                      WHERE x <> to_jsonb(${mediaId}::int)), '[]'::jsonb),
               updated_at = now()
         WHERE id = ${post.id} AND user_id = ${req.userId}
           AND COALESCE(content_status, '') <> 'ready' AND NOT COALESCE(auto_post, false)`);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Atelier] retrait visuel:", e?.message);
      res.status(500).json({ message: "visuel_failed" });
    }
  });
}
