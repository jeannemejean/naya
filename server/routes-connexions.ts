// server/routes-connexions.ts — les connexions d'un projet CLIENT (mode agence) : réseaux
// sociaux, expéditeur e-mail et signature, compte LinkedIn. Mêmes règles que les réglages de
// l'utilisatrice, rangées dans `connexions_projet` ; un projet client n'utilise que celles-ci.
// Toutes les routes : projet de l'utilisatrice sinon 404 ; projet perso → 409 `projet_perso`.
import express, { type Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { encryptToken, decryptToken } from "./services/token-crypto";
import { getSenderStatus, createSingleSender } from "./services/sendgrid-senders";
import { linkedinConfigured, generateConnectLink, listUnipileAccounts } from "./services/linkedin";
import { compteUnipile, nomUnipile, sansDeconnexion, TYPE_UNIPILE_GMAIL } from "./services/connexions/unipile";
import {
  rattacherCompte, compteDejaRange, urlNotification, notificationValide, lireNomUnipile, type CanalUnipile, type CompteListe,
} from "./services/connexions/rattacher-compte";
import { perimetreDemande, statutReseaux, listeComptes } from "./routes-social";

const cleSendgrid = (c: any): string | undefined =>
  (c?.sendgridApiKey ? decryptToken(c.sendgridApiKey) : null) || process.env.SENDGRID_API_KEY || undefined;

const adresseComplete = (c: any) => !!(c?.senderAddress && c?.senderCity && c?.senderCountry);

/** Vue publique de la connexion (la clé n'est jamais renvoyée). */
function vueEmail(c: any, verificationStatus: string) {
  return {
    senderEmail: c?.senderEmail || "",
    senderName: c?.senderName || "",
    address: c?.senderAddress || "",
    city: c?.senderCity || "",
    country: c?.senderCountry || "",
    hasOwnKey: !!c?.sendgridApiKey,
    verificationStatus, // verified | pending | none | unknown
  };
}

/** `address` = l'adresse du compte Google relié (côté Unipile), pas le champ « expéditeur ». */
function vueGmail(c: any, comptes: Array<{ id: string; adresse?: string | null }> = []) {
  const id = c?.emailUnipileAccountId;
  return {
    configured: linkedinConfigured(),
    connected: !!id,
    address: (id && comptes.find((x) => x.id === id)?.adresse) || null,
    disconnectedAt: c?.comptesDeconnectes?.email ?? null,
  };
}

/** Comptes Unipile, seulement si utile ; une panne Unipile ne casse jamais l'écran. */
async function comptesSi(utile: boolean) {
  if (!utile || !linkedinConfigured()) return [];
  try { return await listUnipileAccounts(); } catch { return []; }
}

function vueLinkedin(c: any) {
  return {
    configured: linkedinConfigured(),
    connected: !!c?.linkedinUnipileAccountId,
    restricted: !!c?.linkedinRestrictedAt,
    restrictedAt: c?.linkedinRestrictedAt ?? null,
    restrictedReason: c?.linkedinRestrictedReason ?? null,
    disconnectedAt: c?.comptesDeconnectes?.linkedin ?? null,
  };
}

/**
 * Le compte à ranger pour « Terminé » : celui déjà rangé à la notification d'Unipile, sinon
 * (comptes créés avant la notification) celui qui porte le nom du périmètre.
 */
export async function compteATrouver(comptes: CompteListe[], userId: string, projectId: number | null, canal: CanalUnipile) {
  const range = await compteDejaRange(userId, projectId, canal);
  return (range ? comptes.find((c) => c.id === range) : undefined)
    ?? compteUnipile(comptes, userId, projectId, canal === "linkedin" ? "LINKEDIN" : TYPE_UNIPILE_GMAIL);
}

/** Lien hébergé Unipile : le compte sera rangé au nom `nom` dès que la connexion aboutit. */
export const lienUnipile = (nom: string, canal: CanalUnipile) =>
  generateConnectLink(nom, canal === "gmail" ? ["GOOGLE"] : ["LINKEDIN"], urlNotification(nom, canal));

export function registerConnexionsRoutes(app: Express) {
  // Unipile appelle cette adresse quand une connexion aboutit (`notify_url` du lien hébergé),
  // avec { status, account_id, name }. Publique : la signature de l'adresse prouve que le lien
  // a été créé par Naya pour CE nom et CE canal. Réponse 200 même en cas de refus métier
  // (Unipile n'a rien à renvoyer) ; « Terminé » dira ensuite ce qui manque.
  app.post("/api/unipile/compte-relie", express.json({ type: () => true, limit: "100kb" }), async (req: any, res) => {
    const secret = process.env.UNIPILE_WEBHOOK_SECRET;
    const nom = String(req.body?.name ?? "");
    const canal = String(req.query.canal ?? "");
    if (!secret || !notificationValide(nom, canal, req.query.sig ? String(req.query.sig) : undefined, secret)) {
      console.warn("[unipile] notification de compte refusée : signature absente ou invalide");
      return res.status(401).json({ message: "non autorisé" });
    }
    const qui = lireNomUnipile(nom);
    const accountId = String(req.body?.account_id ?? "");
    if (!qui || !accountId) return res.status(200).json({ ok: true });
    try {
      const comptes = await listUnipileAccounts();
      const compte = comptes.find((c) => c.id === accountId);
      if (!compte) {
        console.warn(`[unipile] notification : compte ${accountId} absent de la liste Unipile`);
        return res.status(200).json({ ok: true });
      }
      const issue = await rattacherCompte(qui.userId, qui.projectId, canal, compte, comptes);
      if (!issue.ok) console.warn(`[unipile] compte ${accountId} non rangé (${canal}) : ${issue.message}`);
      res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error(`[unipile] notification de compte non traitée : ${e.message}`);
      res.status(500).json({ message: "erreur" });
    }
  });

  /** Le projet client demandé, ou la réponse d'erreur déjà envoyée (null). */
  const projetClient = async (req: any, res: any): Promise<number | null> => {
    const p = await perimetreDemande(req.userId, req.params.id);
    if (!p.ok) { res.status(p.status).json({ message: p.message }); return null; }
    // `perimetreDemande` avec un id rend toujours un périmètre client (sinon 404/409).
    return p.portee;
  };

  app.get("/api/projects/:id/connexions", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const [c, comptes] = await Promise.all([
        storage.getConnexionProjet(req.userId, projectId),
        storage.getSocialAccounts(req.userId),
      ]);
      const statut = c?.senderEmail ? await getSenderStatus(cleSendgrid(c), c.senderEmail) : "none";
      res.json({
        reseaux: {
          statut: statutReseaux(comptes, projectId),
          comptes: listeComptes(comptes, projectId),
          // Pages LinkedIn importées à la connexion, en attente du choix de l'utilisatrice.
          enAttente: comptes
            .filter((a: any) => a.projectId === projectId && !a.isActive && String(a.platform).startsWith("linkedin_page_"))
            .map((a: any) => ({ id: a.id, platform: a.platform, accountName: a.accountName })),
        },
        email: vueEmail(c, statut),
        linkedin: vueLinkedin(c),
        gmail: vueGmail(c, await comptesSi(!!c?.emailUnipileAccountId)),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/projects/:id/connexions/email", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const { senderEmail, senderName, sendgridApiKey, address, city, country } = req.body || {};
      const data: any = {};
      if (typeof senderEmail === "string") data.senderEmail = senderEmail.trim() || null;
      if (typeof senderName === "string") data.senderName = senderName.trim() || null;
      if (typeof address === "string") data.senderAddress = address.trim() || null;
      if (typeof city === "string") data.senderCity = city.trim() || null;
      if (typeof country === "string") data.senderCountry = country.trim() || null;
      // Clé : chiffrée si fournie non vide ; effacée si chaîne vide ; inchangée si absente.
      if (typeof sendgridApiKey === "string") {
        data.sendgridApiKey = sendgridApiKey.trim() ? encryptToken(sendgridApiKey.trim()) : null;
      }
      const avant = await storage.getConnexionProjet(req.userId, projectId);
      const c = await storage.upsertConnexionProjet(req.userId, projectId, data);
      // Signature changée : les messages déjà rédigés pour ce client portent l'ancienne.
      if ("senderName" in data && (avant?.senderName ?? null) !== (c.senderName ?? null)) {
        const campagnes = (await storage.getProspectionCampaigns(req.userId)).filter((x: any) => x.projectId === projectId);
        for (const x of campagnes) await storage.purgeLeadStepMessagesForCampaign(x.id);
      }

      // Vérification SendGrid demandée d'elle-même quand l'adresse est complète (non bloquant).
      let verificationStatus = "none";
      let verificationTriggered = false;
      if (c.senderEmail) {
        const cle = cleSendgrid(c);
        verificationStatus = await getSenderStatus(cle, c.senderEmail);
        if (verificationStatus === "none" && adresseComplete(c)) {
          const r = await createSingleSender(cle, {
            email: c.senderEmail, name: c.senderName || "",
            address: c.senderAddress!, city: c.senderCity!, country: c.senderCountry!,
          });
          if (r.ok) { verificationStatus = "pending"; verificationTriggered = true; }
        }
      }
      res.json({ ok: true, email: vueEmail(c, verificationStatus), verificationTriggered });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/connexions/email/verify", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const c = await storage.getConnexionProjet(req.userId, projectId);
      if (!c?.senderEmail) return res.status(400).json({ message: "no_sender_email" });
      const cle = cleSendgrid(c);
      if ((await getSenderStatus(cle, c.senderEmail)) === "verified") return res.json({ verificationStatus: "verified" });
      if (!adresseComplete(c)) return res.status(400).json({ message: "address_required" });
      const r = await createSingleSender(cle, {
        email: c.senderEmail, name: c.senderName || "",
        address: c.senderAddress!, city: c.senderCity!, country: c.senderCountry!,
      });
      if (!r.ok) return res.status(400).json({ message: r.error });
      res.json({ verificationStatus: "pending" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** Un compte social du projet, ou null (réponse 404 envoyée). */
  const compteDuProjet = async (req: any, res: any, projectId: number) => {
    const id = Number(req.params.compteId);
    const compte = Number.isInteger(id)
      ? (await storage.getSocialAccounts(req.userId)).find((a: any) => a.id === id && a.projectId === projectId)
      : undefined;
    if (!compte) { res.status(404).json({ message: "not_found" }); return null; }
    return compte;
  };

  // Choisir une page en attente : elle devient un compte du client.
  app.post("/api/projects/:id/connexions/reseaux/:compteId/activer", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const compte = await compteDuProjet(req, res, projectId);
      if (!compte) return;
      await storage.updateSocialAccount(compte.id, req.userId, { isActive: true });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Écarter un compte du client (page en attente qui n'est pas la sienne, par exemple).
  app.delete("/api/projects/:id/connexions/reseaux/:compteId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const compte = await compteDuProjet(req, res, projectId);
      if (!compte) return;
      await storage.deleteSocialAccount(compte.id, req.userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Lien Unipile pour connecter le LinkedIn du client (compte nommé d'après le projet).
  app.post("/api/projects/:id/connexions/linkedin/lien", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      if (!linkedinConfigured()) return res.status(400).json({ message: "linkedin_not_configured" });
      const url = await lienUnipile(nomUnipile(req.userId, projectId), "linkedin");
      if (!url) return res.status(502).json({ message: "link_generation_failed" });
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Après connexion : retrouve le compte au nom du projet (jamais un autre) et le range.
  app.post("/api/projects/:id/connexions/linkedin/sync", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      if (!linkedinConfigured()) return res.status(400).json({ message: "linkedin_not_configured" });
      const comptes = await listUnipileAccounts();
      const compte = await compteATrouver(comptes, req.userId, projectId, "linkedin");
      if (!compte) return res.status(404).json({ message: "no_linkedin_account_found" });
      // Le même profil LinkedIn ne sert qu'à un périmètre : sinon deux budgets pour un seul compte.
      const issue = await rattacherCompte(req.userId, projectId, "linkedin", compte, comptes);
      if (!issue.ok) return res.status(issue.status).json({ message: issue.message });
      const c = issue.connexion;
      res.json({ linkedin: vueLinkedin(c) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Action humaine EXPLICITE pour lever une restriction LinkedIn (jamais automatique).
  app.post("/api/projects/:id/connexions/linkedin/lever-restriction", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const c = await storage.upsertConnexionProjet(req.userId, projectId, { linkedinRestrictedAt: null, linkedinRestrictedReason: null });
      res.json({ linkedin: vueLinkedin(c) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/projects/:id/connexions/linkedin", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const c = await storage.upsertConnexionProjet(req.userId, projectId, {
        linkedinUnipileAccountId: null, linkedinAccountConnectedAt: null, linkedinRestrictedAt: null, linkedinRestrictedReason: null,
      });
      res.json({ linkedin: vueLinkedin(c) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Gmail du client (Unipile) : compte Google nommé d'après le projet, jamais celui de l'utilisatrice ──
  app.post("/api/projects/:id/connexions/gmail/lien", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      if (!linkedinConfigured()) return res.status(400).json({ message: "linkedin_not_configured" });
      const url = await lienUnipile(nomUnipile(req.userId, projectId), "gmail");
      if (!url) return res.status(502).json({ message: "link_generation_failed" });
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/connexions/gmail/sync", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      if (!linkedinConfigured()) return res.status(400).json({ message: "linkedin_not_configured" });
      const comptes = await listUnipileAccounts();
      const compte = await compteATrouver(comptes, req.userId, projectId, "gmail");
      if (!compte) return res.status(404).json({ message: "no_gmail_account_found" });
      // Un même Gmail ne sert qu'à un périmètre (utilisatrice ou un seul projet).
      const issue = await rattacherCompte(req.userId, projectId, "gmail", compte, comptes);
      if (!issue.ok) return res.status(issue.status).json({ message: issue.message });
      const c = issue.connexion;
      res.json({ gmail: vueGmail(c, comptes) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/projects/:id/connexions/gmail", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const avant: any = await storage.getConnexionProjet(req.userId, projectId);
      const c = await storage.upsertConnexionProjet(req.userId, projectId, {
        emailUnipileAccountId: null, emailAccountConnectedAt: null,
        comptesDeconnectes: sansDeconnexion(avant?.comptesDeconnectes, "email"),
      } as any);
      res.json({ gmail: vueGmail(c) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Gmail de l'utilisatrice (Unipile, même lien hébergé que LinkedIn) ──
  app.get("/api/prospection/gmail/status", isAuthenticated, async (req: any, res) => {
    try {
      const prefs: any = await storage.getUserPreferences(req.userId);
      res.json(vueGmail(prefs, await comptesSi(!!prefs?.emailUnipileAccountId)));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/prospection/gmail/connect-link", isAuthenticated, async (req: any, res) => {
    try {
      if (!linkedinConfigured()) return res.status(400).json({ message: "linkedin_not_configured" });
      const url = await lienUnipile(nomUnipile(req.userId, null), "gmail");
      if (!url) return res.status(502).json({ message: "link_generation_failed" });
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Le compte Google de l'utilisatrice (jamais celui d'un projet client).
  app.post("/api/prospection/gmail/sync", isAuthenticated, async (req: any, res) => {
    try {
      if (!linkedinConfigured()) return res.status(400).json({ message: "linkedin_not_configured" });
      const comptes = await listUnipileAccounts();
      const mine = await compteATrouver(comptes, req.userId, null, "gmail");
      if (!mine) return res.status(404).json({ message: "no_gmail_account_found" });
      const issue = await rattacherCompte(req.userId, null, "gmail", mine, comptes);
      if (!issue.ok) return res.status(issue.status).json({ message: issue.message });
      res.json({ connected: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/prospection/gmail", isAuthenticated, async (req: any, res) => {
    try {
      const prefs: any = await storage.getUserPreferences(req.userId);
      await storage.updateUserPreferences(req.userId, {
        emailUnipileAccountId: null, emailAccountConnectedAt: null,
        comptesDeconnectes: sansDeconnexion(prefs?.comptesDeconnectes, "email"),
      } as any);
      res.json({ connected: false });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Délier le LinkedIn de l'utilisatrice. On NE touche NI à la date de connexion (départ de la montée
  // en charge) NI à une restriction : elles doivent survivre à un délier/relier du même compte.
  app.delete("/api/prospection/linkedin", isAuthenticated, async (req: any, res) => {
    try {
      const prefs: any = await storage.getUserPreferences(req.userId);
      await storage.updateUserPreferences(req.userId, {
        linkedinUnipileAccountId: null,
        comptesDeconnectes: sansDeconnexion(prefs?.comptesDeconnectes, "linkedin"),
      } as any);
      res.json({ connected: false });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
