// server/routes-validation.ts — validation client (lot 8, inspiré de Metricool).
//
// Deux familles de routes :
//  - PUBLIQUES (sans compte) : /api/portail-validation/:token — le portail d'une marque, ouvert
//    par lien privé (page /v/:token du SPA). Le relecteur se choisit dans la liste de la marque,
//    puis valide, refuse ou commente. Montées par registerValidationPublique AVANT
//    l'authentification ; le préfixe est dans PUBLIC_API_PREFIXES (pas de gate d'abonnement).
//    Jeton inconnu, coupé, expiré ou validation désactivée : la même réponse (404).
//  - AUTHENTIFIÉES : réglages de la marque, lien du portail, envoi en validation. Tout passe par
//    req.userId ; la marque ou le post d'un autre compte est introuvable (404).
import type { Express, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAuthenticated } from "./auth";
import { depsValidation, decisionsDeLaDemande, type DepsValidation, type PostValidation } from "./services/validation/deps";
import { postVerrouille } from "@shared/gestion-posts";
import {
  creerLimiteur, lireDecision, lireReglagesValidation, nomPublic, relecteurParId, relecteursDe, relecteursPublics,
  statutApresDecisions, type RegleValidation, type StatutValidation,
} from "@shared/validation-client";

const JETON_RE = /^[A-Za-z0-9_-]{32,100}$/;
const IDS_MAX = 100;
/** Le portail montre aussi les décisions des 30 derniers jours. */
const RECENTS_MS = 30 * 86_400_000;

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function memeJeton(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const lienPortail = (token: string) => `/v/${token}`;

/**
 * Identifiant opaque d'un relecteur sur le portail public : HMAC (secret du serveur) de
 * l'adresse et du jeton du lien. Stable pour un lien, sans rien révéler de l'adresse ; un lien
 * régénéré change les identifiants.
 */
export function idRelecteurPortail(token: string, secret = process.env.SESSION_SECRET || "naya-portail-validation") {
  return (email: string) => createHmac("sha256", secret).update(`relecteur:${token}:${email.toLowerCase()}`).digest("base64url").slice(0, 22);
}

/** Ce qu'on montre d'un post : texte, visuels (https seulement), date, statut, décisions. */
async function vuePosts(deps: DepsValidation, userId: string, posts: PostValidation[], nomDe: (email: string) => string) {
  const decisions = await deps.decisions(posts.map((p) => p.id));
  const ids = Array.from(new Set(posts.flatMap((p) => (Array.isArray(p.mediaIds) ? (p.mediaIds as unknown[]) : [])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0))));
  const medias = new Map((await deps.medias(userId, ids)).map((m) => [m.id, m]));
  const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);
  return posts.map((p) => {
    const mediaIds = Array.isArray(p.mediaIds) ? (p.mediaIds as unknown[]).map(Number) : [];
    const visuels = mediaIds.flatMap((id) => {
      const m = medias.get(id);
      if (!m || !https(m.url)) return [];
      const video = String(m.mimeType ?? "").startsWith("video/");
      return [{ url: m.url, type: video ? "video" : "image", vignette: https(m.thumbnailUrl) ? m.thumbnailUrl : null }];
    });
    if (visuels.length === 0 && https(p.mediaUrl)) visuels.push({ url: p.mediaUrl, type: "image", vignette: null });
    return {
      id: p.id, titre: p.title, texte: p.body, plateforme: p.platform, format: p.postFormat,
      prevuLe: p.scheduledFor, statut: p.validationStatut, demandeLe: p.validationDemandeeAt,
      visuels, couverture: https(p.couvertureUrl) ? p.couvertureUrl : null,
      decisions: decisions.filter((d) => d.contentId === p.id).map((d) => ({
        id: d.id, relecteur: nomDe(d.relecteurEmail), relecteurEmail: d.relecteurEmail, decision: d.decision,
        commentaire: d.commentaire, le: d.createdAt,
      })),
    };
  });
}

// ── Routes publiques ─────────────────────────────────────────────────────────────────

export function registerValidationPublique(app: Express, deps: DepsValidation = depsValidation): void {
  const limiter = creerLimiteur();

  const indisponible = (res: Response) => res.status(404).json({ message: "indisponible" });

  /** Le portail, sa marque et ses réglages — ou null (404 déjà envoyée). */
  async function portailOuvert(token: unknown, res: Response) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    const t = String(token ?? "");
    if (!JETON_RE.test(t)) { indisponible(res); return null; }
    const portail = await deps.portailParJeton(t);
    if (!portail || !memeJeton(portail.token, t) || !portail.actif) { indisponible(res); return null; }
    if (portail.expireAt && new Date(portail.expireAt).getTime() <= deps.maintenant().getTime()) { indisponible(res); return null; }
    const projet = await deps.projetParId(portail.projectId);
    if (!projet || projet.userId !== portail.userId) { indisponible(res); return null; }
    const reglages = await deps.reglages(portail.projectId);
    if (!reglages || !reglages.actif || reglages.userId !== portail.userId) { indisponible(res); return null; }
    return { portail, projet, reglages, relecteurs: relecteursDe(reglages.relecteurs) };
  }

  app.get("/api/portail-validation/:token", async (req, res) => {
    try {
      const o = await portailOuvert(req.params.token, res);
      if (!o) return;
      const idDe = idRelecteurPortail(o.portail.token);
      const nomDe = (email: string) => nomPublic(o.relecteurs, email, idDe);
      const posts = await deps.postsDuProjet(o.portail.userId, o.portail.projectId, new Date(deps.maintenant().getTime() - RECENTS_MS));
      const vues = await vuePosts(deps, o.portail.userId, posts, nomDe);
      res.json({
        marque: o.projet.clientName || o.projet.name || "",
        langue: await deps.langue(o.portail.userId),
        regle: o.reglages.regle,
        // Aucune adresse ne sort du portail : un nom (homonymes départagés par l'adresse masquée)
        // et un identifiant opaque, que le serveur ramène à l'adresse au moment de décider.
        relecteurs: relecteursPublics(o.relecteurs, idDe),
        posts: vues.map(({ decisions, ...v }) => ({ ...v, decisions: decisions.map(({ relecteurEmail: _e, ...d }) => d) })),
      });
    } catch (e: any) {
      console.error("[Validation] portail:", e?.message);
      indisponible(res);
    }
  });

  app.post("/api/portail-validation/:token/posts/:contentId/decision", async (req, res) => {
    try {
      const o = await portailOuvert(req.params.token, res);
      if (!o) return;
      if (!limiter(o.portail.token, deps.maintenant().getTime())) return res.status(429).json({ message: "trop_de_decisions" });
      const body = req.body;
      if (!body || typeof body !== "object" || typeof body.relecteurId !== "string") return res.status(400).json({ message: "invalide" });
      const idDe = idRelecteurPortail(o.portail.token);
      const relecteur = relecteurParId(o.relecteurs, body.relecteurId, idDe);
      if (!relecteur) return res.status(403).json({ message: "relecteur_inconnu" });
      const d = lireDecision({ ...body, relecteurEmail: relecteur.email });
      if (!d) return res.status(400).json({ message: "invalide" });
      const id = idPositif(req.params.contentId);
      const [post] = id == null ? [] : await deps.posts(o.portail.userId, [id]);
      if (!post || post.projectId !== o.portail.projectId || !post.validationStatut) return res.status(404).json({ message: "not_found" });
      if (d.decision !== "commentaire" && (post.validationStatut !== "a_valider" || postVerrouille(post as any))) {
        return res.status(409).json({ message: "deja_decide", statut: post.validationStatut });
      }
      await deps.ajouterDecision({ contentId: post.id, relecteurEmail: d.relecteurEmail, decision: d.decision, commentaire: d.commentaire });
      const userId = o.portail.userId;
      // L'historique est lu par l'utilisatrice : le vrai nom (ou l'adresse) du relecteur.
      const nom = relecteur.nom || relecteur.email;
      if (d.decision === "commentaire") {
        await deps.journaliser(userId, post.id, "validation_commentaire", { relecteur: nom });
        return res.json({ statut: post.validationStatut });
      }
      const toutes = decisionsDeLaDemande(await deps.decisions([post.id]), post.validationDemandeeAt);
      const statut = statutApresDecisions(o.reglages.regle as RegleValidation, o.relecteurs, toutes);
      await deps.journaliser(userId, post.id, d.decision === "validee" ? "validation_validee" : "validation_refusee", {
        relecteur: nom, ...(d.commentaire ? { commentaire: d.commentaire.slice(0, 300) } : {}),
      });
      if (statut !== "a_valider") {
        // Seulement si personne n'a modifié le post entre-temps (une relance gagne).
        await deps.poserStatut(post.id, userId, statut, post.validationDemandeeAt ?? null,
          { statut: "a_valider", demandeeAt: post.validationDemandeeAt ?? null });
      }
      res.json({ statut });
    } catch (e: any) {
      console.error("[Validation] décision:", e?.message);
      res.status(500).json({ message: "decision_failed" });
    }
  });
}

// ── Routes authentifiées ─────────────────────────────────────────────────────────────

export function registerValidationRoutes(app: Express, deps: DepsValidation = depsValidation): void {
  /** La marque de l'utilisatrice, ou null (404 déjà envoyée). */
  async function marque(req: any, res: Response): Promise<number | null> {
    const id = idPositif(req.params.projectId);
    if (id == null || !(await deps.projet(id, req.userId))) { res.status(404).json({ message: "not_found" }); return null; }
    return id;
  }

  const vueReglages = (r: any) => (r ? { actif: r.actif, regle: r.regle, relecteurs: relecteursDe(r.relecteurs) } : null);

  app.get("/api/validation/projets/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await marque(req, res);
      if (projectId == null) return;
      const [reglages, portail] = await Promise.all([deps.reglages(projectId), deps.portail(req.userId, projectId)]);
      const relecteurs = relecteursDe(reglages?.relecteurs);
      const nomDe = (email: string) => relecteurs.find((r) => r.email === email)?.nom ?? email;
      const posts = await deps.postsDuProjet(req.userId, projectId, new Date(deps.maintenant().getTime() - RECENTS_MS));
      res.json({
        reglages: reglages && reglages.userId === req.userId ? vueReglages(reglages) : null,
        portail: portail ? { lien: lienPortail(portail.token), creeLe: portail.createdAt, expireLe: portail.expireAt } : null,
        posts: await vuePosts(deps, req.userId, posts, nomDe),
      });
    } catch (e: any) {
      console.error("[Validation] lecture:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  app.put("/api/validation/projets/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await marque(req, res);
      if (projectId == null) return;
      const v = lireReglagesValidation(req.body);
      if (!v) return res.status(400).json({ message: "invalide" });
      const existant = await deps.reglages(projectId);
      if (existant && existant.userId !== req.userId) return res.status(404).json({ message: "not_found" });
      res.json(vueReglages(await deps.enregistrerReglages({ userId: req.userId, projectId, ...v })));
    } catch (e: any) {
      console.error("[Validation] réglages:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  // Créer ou régénérer le lien du portail : l'ancien lien meurt.
  app.post("/api/validation/projets/:projectId/portail", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await marque(req, res);
      if (projectId == null) return;
      const p = await deps.nouveauPortail(req.userId, projectId, deps.jeton());
      res.status(201).json({ lien: lienPortail(p.token), creeLe: p.createdAt, expireLe: p.expireAt });
    } catch (e: any) {
      console.error("[Validation] portail:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  app.delete("/api/validation/projets/:projectId/portail", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await marque(req, res);
      if (projectId == null) return;
      await deps.couperPortail(req.userId, projectId);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Validation] couper le portail:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  // Envoyer en validation (un post ou une sélection du calendrier). Un post sans marque, d'une
  // marque sans validation active, publié ou en train de partir est laissé (raison donnée).
  app.post("/api/validation/envoyer", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brut = req.body?.ids;
      if (!Array.isArray(brut) || brut.length === 0 || brut.length > IDS_MAX || !brut.every((x) => idPositif(x) != null)) {
        return res.status(400).json({ message: "invalide" });
      }
      const ids = Array.from(new Set(brut.map(Number)));
      const posts = await deps.posts(userId, ids);
      if (posts.length !== ids.length) return res.status(404).json({ message: "not_found" });
      const actives = new Map<number, boolean>();
      const traites: number[] = [];
      const ignores: Array<{ id: number; raison: string }> = [];
      const quand = deps.maintenant();
      for (const p of posts) {
        if (p.projectId == null) { ignores.push({ id: p.id, raison: "sans_validation" }); continue; }
        if (!actives.has(p.projectId)) {
          const r = await deps.reglages(p.projectId);
          actives.set(p.projectId, !!r && r.actif && r.userId === userId);
        }
        if (!actives.get(p.projectId)) { ignores.push({ id: p.id, raison: "sans_validation" }); continue; }
        if (postVerrouille(p as any)) { ignores.push({ id: p.id, raison: "deja_publie" }); continue; }
        if (await deps.poserStatut(p.id, userId, "a_valider", quand)) {
          traites.push(p.id);
          await deps.journaliser(userId, p.id, "validation_demandee", null);
        }
      }
      res.json({ traites, ignores });
    } catch (e: any) {
      console.error("[Validation] envoi:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  // Le statut d'un post et ce que les relecteurs en ont dit (fenêtre du post, atelier).
  app.get("/api/validation/posts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const [post] = id == null ? [] : await deps.posts(req.userId, [id]);
      if (!post) return res.status(404).json({ message: "not_found" });
      const reglages = post.projectId != null ? await deps.reglages(post.projectId) : undefined;
      const actif = !!reglages && reglages.actif && reglages.userId === req.userId;
      const relecteurs = relecteursDe(reglages?.relecteurs);
      const nomDe = (email: string) => relecteurs.find((r) => r.email === email)?.nom ?? email;
      const decisions = (await deps.decisions([post.id])).map((d) => ({
        id: d.id, relecteur: nomDe(d.relecteurEmail), decision: d.decision, commentaire: d.commentaire, le: d.createdAt,
      }));
      res.json({ actif, regle: reglages?.regle ?? null, statut: post.validationStatut as StatutValidation | null, demandeLe: post.validationDemandeeAt, decisions });
    } catch (e: any) {
      console.error("[Validation] statut du post:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });

  // Retirer de la validation (« enregistrer sans validation ») : le post redevient publiable.
  app.delete("/api/validation/posts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idPositif(req.params.id);
      const [post] = id == null ? [] : await deps.posts(req.userId, [id]);
      if (!post) return res.status(404).json({ message: "not_found" });
      const avant = post.validationStatut;
      if (!avant) return res.json({ ok: true });
      await deps.poserStatut(post.id, req.userId, null, null);
      await deps.journaliser(req.userId, post.id, "validation_retiree", { avant });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Validation] retrait:", e?.message);
      res.status(500).json({ message: "validation_failed" });
    }
  });
}
