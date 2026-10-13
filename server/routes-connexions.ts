// server/routes-connexions.ts — les connexions d'un projet CLIENT (mode agence) : réseaux
// sociaux, expéditeur e-mail et signature, compte LinkedIn. Mêmes règles que les réglages de
// l'utilisatrice, rangées dans `connexions_projet` ; un projet client n'utilise que celles-ci.
// Toutes les routes : projet de l'utilisatrice sinon 404 ; projet perso → 409 `projet_perso`.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { encryptToken, decryptToken } from "./services/token-crypto";
import { getSenderStatus, createSingleSender } from "./services/sendgrid-senders";
import { linkedinConfigured, generateConnectLink, listUnipileAccounts } from "./services/linkedin";
import { compteUnipile, nomUnipile } from "./services/connexions/unipile";
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

function vueLinkedin(c: any) {
  return {
    configured: linkedinConfigured(),
    connected: !!c?.linkedinUnipileAccountId,
    restricted: !!c?.linkedinRestrictedAt,
    restrictedAt: c?.linkedinRestrictedAt ?? null,
    restrictedReason: c?.linkedinRestrictedReason ?? null,
  };
}

export function registerConnexionsRoutes(app: Express) {
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
      const url = await generateConnectLink(nomUnipile(req.userId, projectId));
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
      const compte = compteUnipile(await listUnipileAccounts(), req.userId, projectId);
      if (!compte) return res.status(404).json({ message: "no_linkedin_account_found" });
      const avant = await storage.getConnexionProjet(req.userId, projectId);
      // La montée en charge repart de zéro pour un compte NOUVEAU seulement.
      const nouveau = avant?.linkedinUnipileAccountId !== compte.id || !avant?.linkedinAccountConnectedAt;
      const c = await storage.upsertConnexionProjet(req.userId, projectId, {
        linkedinUnipileAccountId: compte.id,
        ...(nouveau ? { linkedinAccountConnectedAt: new Date() } : {}),
      });
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
}
