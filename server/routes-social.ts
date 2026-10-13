// server/routes-social.ts — connexion des comptes sociaux (OAuth), listes, état et
// déconnexion. Mode agence : `?projectId=N` (projet CLIENT de l'utilisatrice) range ou lit les
// comptes du client ; sans paramètre, ce sont ceux de l'utilisatrice, comme avant.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { etatConnexion } from "./services/social-connection-state";
import {
  getInstagramAuthUrl, exchangeInstagramCode,
  getLinkedInAuthUrl, exchangeLinkedInCode,
  getTwitterAuthUrl, exchangeTwitterCode,
  getTikTokAuthUrl, exchangeTikTokCode,
  isPlatformConfigured,
} from "./services/social-oauth";
import { dansPortee, porteeDe, type Portee } from "./services/connexions/portee";

export type Perimetre = { ok: true; portee: Portee } | { ok: false; status: number; message: string };

/**
 * Le périmètre demandé : aucun projet → l'utilisatrice ; sinon un projet CLIENT à elle.
 * Projet introuvable (ou d'une autre) → 404 ; projet perso → 409 `projet_perso`.
 */
export async function perimetreDemande(userId: string, brut: unknown, opts: { persoAccepte?: boolean } = {}): Promise<Perimetre> {
  if (brut === undefined || brut === null || brut === "") return { ok: true, portee: null };
  const id = Number(brut);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 404, message: "not_found" };
  const projet = await storage.getProject(id, userId);
  if (!projet) return { ok: false, status: 404, message: "not_found" };
  const portee = porteeDe(projet as any);
  // En lecture, un projet perso désigne simplement le périmètre de l'utilisatrice.
  if (portee == null && !opts.persoAccepte) return { ok: false, status: 409, message: "projet_perso" };
  return { ok: true, portee };
}

/** Comptes actifs du périmètre, sans jeton, pour le composeur. */
export function listeComptes(comptes: any[], portee: Portee) {
  return comptes
    .filter((a) => a.isActive && dansPortee(a, portee))
    .map((a) => ({
      id: a.id,
      platform: a.platform,                                   // instagram|facebook|linkedin|linkedin_page_<id>|tiktok
      basePlatform: a.platform.startsWith("linkedin") ? "linkedin" : a.platform,
      accountName: a.accountName,
      isPage: a.platform.startsWith("linkedin_page_"),
    }));
}

/** État RÉEL de chaque réseau dans le périmètre (un jeton expiré n'est pas « connecté »). */
export function statutReseaux(comptes: any[], portee: Portee, maintenant = new Date()) {
  const permis = comptes.filter((a) => dansPortee(a, portee));
  const status: Record<string, { connected: boolean; etat: string; accountName?: string; expiresAt?: Date; configured: boolean; pagesCount?: number }> = {};
  for (const platform of ["instagram", "linkedin", "tiktok"] as const) {
    const linkedinPages = platform === "linkedin" ? permis.filter((a) => a.platform.startsWith("linkedin_page_") && a.isActive) : [];
    // Un client n'a jamais de profil LinkedIn personnel : sa page choisie fait la connexion.
    const account = permis.find((a) => a.platform === platform && a.isActive) ?? (portee != null ? linkedinPages[0] : undefined);
    // `is_active` dit que la connexion n'a pas été révoquée, pas qu'elle marche (jetons morts
    // affichés « Connecté » le 18 septembre) : on qualifie le jeton.
    const etat = account
      ? etatConnexion({ accessToken: account.accessToken, isActive: account.isActive, expiresAt: account.expiresAt ?? null, now: maintenant })
      : ("absente" as const);
    status[platform] = {
      configured: isPlatformConfigured(platform),
      connected: etat === "connectee" || etat === "expire_bientot" || etat === "echeance_inconnue",
      etat,
      accountName: account?.accountName,
      expiresAt: account?.expiresAt || undefined,
      ...(platform === "linkedin" && linkedinPages.length > 0 && { pagesCount: linkedinPages.length }),
    };
  }
  return status;
}

/** Où revenir après la connexion : la page du projet client, sinon les Réglages. */
const retour = (projectId: number | null, query: string) =>
  projectId != null ? `/projects/${projectId}?${query}` : `/settings?${query}`;

export function registerSocialRoutes(app: Express) {
  // GET /api/social/oauth/:platform/url[?projectId=N] — URL de consentement
  app.get("/api/social/oauth/:platform/url", isAuthenticated, async (req: any, res) => {
    const { platform } = req.params;
    const validPlatforms = ["instagram", "linkedin", "twitter", "tiktok"];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: "social_connect_failed", message: `Plateforme non supportée: ${platform}` });
    }
    if (!isPlatformConfigured(platform as any)) {
      return res.status(503).json({
        error: "social_not_configured",
        message: `${platform} n'est pas encore configuré sur ce serveur. Ajoute les variables d'environnement.`,
        notConfigured: true,
      });
    }
    try {
      const p = await perimetreDemande(req.userId, req.query.projectId);
      if (!p.ok) return res.status(p.status).json({ message: p.message });
      const state = `${req.userId}:${Date.now()}`;
      (req.session as any).socialOAuthState = state;
      (req.session as any).socialOAuthUserId = req.userId;
      (req.session as any).socialOAuthProjectId = p.portee;

      let url: string;
      if (platform === "instagram") url = getInstagramAuthUrl(state);
      else if (platform === "linkedin") url = getLinkedInAuthUrl(state);
      else if (platform === "tiktok") url = getTikTokAuthUrl(state);
      else {
        // twitter — génère un code_verifier simple
        const codeVerifier = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        (req.session as any).twitterCodeVerifier = codeVerifier;
        url = getTwitterAuthUrl(state, codeVerifier);
      }
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: "social_connect_failed", message: err.message });
    }
  });

  // GET /api/social/oauth/:platform/callback — reçoit le code, échange le token
  app.get("/api/social/oauth/:platform/callback", async (req: any, res) => {
    const { platform } = req.params;
    const { code, state, error } = req.query as Record<string, string>;
    const session = (req.session as any) || {};
    const sessionProjectId: number | null = typeof session.socialOAuthProjectId === "number" ? session.socialOAuthProjectId : null;

    if (error) {
      console.error(`[Social OAuth] ${platform} error:`, error);
      return res.redirect(retour(sessionProjectId, `social=${platform}&status=error&reason=${encodeURIComponent(error)}`));
    }
    // Le `state` renvoyé doit être celui émis pour CETTE session. Sans connexion en cours dans
    // la session, on refuse aussi : n'importe qui pourrait sinon forger `?state=<id>:…` et
    // rattacher son propre compte à celui d'une autre (ancien repli « session perdue »).
    if (!session.socialOAuthState || state !== session.socialOAuthState) {
      return res.redirect(retour(sessionProjectId, `social=${platform}&status=error&reason=state_invalide`));
    }
    const userId: string | undefined = session.socialOAuthUserId;

    if (!code) return res.redirect(retour(sessionProjectId, `social=${platform}&status=error&reason=missing_code`));
    if (!userId) return res.redirect(retour(sessionProjectId, `social=${platform}&status=error&reason=missing_session`));

    try {
      // Le projet est revérifié au retour : toujours à elle, toujours client.
      let projectId: number | null = null;
      if (sessionProjectId != null) {
        const p = await perimetreDemande(userId, sessionProjectId);
        if (!p.ok) return res.redirect(`/settings?social=${platform}&status=error&reason=${p.message}`);
        projectId = p.portee;
      }
      if (platform === "instagram") await exchangeInstagramCode(userId, code, projectId);
      else if (platform === "linkedin") await exchangeLinkedInCode(userId, code, projectId);
      else if (platform === "tiktok") await exchangeTikTokCode(userId, code, projectId);
      else if (platform === "twitter") {
        await exchangeTwitterCode(userId, code, session.twitterCodeVerifier || "", projectId);
        delete session.twitterCodeVerifier;
      }
      delete session.socialOAuthState;
      delete session.socialOAuthUserId;
      delete session.socialOAuthProjectId;
      res.redirect(retour(projectId, `social=${platform}&status=connected`));
    } catch (err: any) {
      console.error(`[Social OAuth] ${platform} callback error:`, err.message);
      res.redirect(retour(sessionProjectId, `social=${platform}&status=error&reason=${encodeURIComponent(err.message)}`));
    }
  });

  // Comptes connectés du périmètre (avec IDs) pour le composeur multi-réseaux.
  app.get("/api/social/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const p = await perimetreDemande(req.userId, req.query.projectId, { persoAccepte: true });
      if (!p.ok) return res.status(p.status).json({ message: p.message });
      res.json(listeComptes(await storage.getSocialAccounts(req.userId), p.portee));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // État de connexion de chaque réseau du périmètre.
  app.get("/api/social/status", isAuthenticated, async (req: any, res) => {
    try {
      const p = await perimetreDemande(req.userId, req.query.projectId, { persoAccepte: true });
      if (!p.ok) return res.status(p.status).json({ message: p.message });
      res.json(statutReseaux(await storage.getSocialAccounts(req.userId), p.portee));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/social/disconnect/:platform[?projectId=N] — déconnecte un réseau du périmètre
  app.delete("/api/social/disconnect/:platform", isAuthenticated, async (req: any, res) => {
    try {
      const p = await perimetreDemande(req.userId, req.query.projectId);
      if (!p.ok) return res.status(p.status).json({ message: p.message });
      const account = await storage.getSocialAccountByPlatform(req.userId, req.params.platform, p.portee);
      if (!account) return res.status(404).json({ message: "Compte non trouvé" });
      await storage.deleteSocialAccount(account.id, req.userId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
