// Routes de la boîte de réponses et de la désinscription publique. Les routes publiques sont
// enregistrées depuis `registerRoutes`, donc AVANT le fallback SPA/statique de index.ts.
import express, { type Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./auth";
import { leadDuJeton } from "./services/desinscription";
import { normaliser, traiterEvenement, depsDepuisStorage } from "./services/reponses/ingestion";
import { envoyerReponse, type DepsEnvoiReponse } from "./services/reponses/envoi-reponse";
import { proposerReponse, identiteConversation, ConversationIntrouvableError } from "./services/reponses/proposition";
import { SignatureClientManquanteError } from "./services/connexions/resolution";
import { masterSendingEnabled } from "./services/prospection-sender";
import { sendEmailUnipile, sendLinkedInChatMessage } from "./services/unipile-mail";
import { persisterRestrictionLinkedIn } from "./services/linkedin-restriction";
import type { EtatAvantReponse, InboxConversation } from "@shared/schema";

function memeSecret(recu: string | undefined, attendu: string): boolean {
  if (!recu) return false;
  const a = Buffer.from(recu), b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Message d'erreur sans les paramètres SQL (qui contiendraient le corps des messages). */
const erreurSure = (e: any) => String(e?.message ?? e).split(/\bparams:/)[0].slice(0, 200);

/** Stades où le prospect a réellement échangé : la séquence s'arrête. « connected » n'en fait
 *  pas partie (une invitation acceptée n'est pas une réponse). */
export const STADES_ENGAGES = ["in_discussion", "proposal_sent", "signed"];

/** Accès réels de l'envoi d'une réponse (le service est testé sans base). */
const depsEnvoi: DepsEnvoiReponse = {
  now: () => new Date(),
  envoiActif: masterSendingEnabled,
  getConversation: (id, userId) => storage.getInboxConversationParId(id, userId),
  getLead: (id, userId) => storage.getLead(id, userId),
  getMessages: (cid) => storage.getInboxMessages(cid),
  identite: async (userId, conv, lead) => identiteConversation(userId, conv, lead, await storage.getUserPreferences(userId)),
  envoyerLinkedIn: (o) => sendLinkedInChatMessage(o),
  envoyerEmail: (o) => sendEmailUnipile(o),
  journaliserTentativeLinkedIn: (userId, leadId, ok, error, portee) => storage.recordLinkedInSendAttempt(userId, leadId, ok, error, portee),
  persisterRestriction: (userId, portee, error) => persisterRestrictionLinkedIn(userId, portee, error),
  ajouterMessage: (row) => storage.ajouterInboxMessage(row),
  finaliserEnvoi: (cle, providerId, sentAt) => storage.finaliserEnvoiInbox(cle, providerId, sentAt),
  supprimerMessage: (pm) => storage.supprimerInboxMessage(pm),
  updateConversation: (id, patch) => storage.updateInboxConversation(id, patch),
  getTask: (id) => storage.getTask(id),
  completeTask: (id) => storage.completeTask(id),
};

/** Statut HTTP d'un refus d'envoi. */
const STATUT_REFUS: Record<string, number> = { texte_vide: 400, texte_trop_long: 400, introuvable: 404, echec: 502 };

/**
 * « Ce n'était pas une vraie réponse » : la séquence reprend là où elle était, jamais dans le
 * passé (nextRunAt = max(ancien, now)). R13 : un lead qui attendait l'envoi d'un brouillon
 * LinkedIn (supprimé par l'ingestion) repart en `active` maintenant, même étape, et la
 * réservation « draft » de l'étape attendue (currentStep + 1) est libérée pour être régénérée.
 */
export function planRestauration(etat: EtatAvantReponse, now: Date): {
  etat: EtatAvantReponse; opts: { libererBrouillonEtape?: number };
} {
  const { stageAvant: _s, repondueLe: _r, ...base } = etat;
  if (etat.status === "awaiting_linkedin") {
    return {
      etat: { ...base, status: "active", nextRunAt: now.toISOString() },
      opts: { libererBrouillonEtape: etat.currentStep + 1 },
    };
  }
  const ancien = etat.nextRunAt ? new Date(etat.nextRunAt) : null;
  return {
    etat: { ...base, nextRunAt: ancien ? new Date(Math.max(ancien.getTime(), now.getTime())).toISOString() : null },
    opts: {},
  };
}

const page = (titre: string, corps: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${titre}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#222;line-height:1.5}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#222;color:#fff;cursor:pointer}</style>
</head><body>${corps}</body></html>`;

export function registerReponsesRoutes(app: Express) {
  // ── Boîte « Réponses » (spec §6.8). Toutes filtrées par req.userId : la conversation d'un
  // autre utilisateur répond 404, comme une conversation inexistante.
  app.get("/api/reponses", isAuthenticated, async (req: any, res) => {
    const projectId = Number(req.query.projectId);
    const statut = typeof req.query.statut === "string" && ["a_traiter", "traitee"].includes(req.query.statut) ? req.query.statut : undefined;
    try {
      res.json(await storage.listerConversationsInbox(req.userId, {
        ...(Number.isInteger(projectId) && projectId > 0 ? { projectId } : {}), ...(statut ? { statut } : {}),
      }));
    } catch (e: any) {
      console.error(`[Reponses] liste : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec du chargement des réponses" });
    }
  });

  app.get("/api/reponses/compte", isAuthenticated, async (req: any, res) => {
    try {
      res.json({ aTraiter: await storage.compterInboxATraiter(req.userId) });
    } catch (e: any) {
      console.error(`[Reponses] compte : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec du comptage" });
    }
  });

  /** Conversation de l'utilisateur courant, ou réponse 404/400 déjà envoyée (null). */
  const conversationDe = async (req: any, res: any): Promise<InboxConversation | null> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ message: "identifiant invalide" }); return null; }
    const conv = await storage.getInboxConversationParId(id, req.userId);
    if (!conv) { res.status(404).json({ message: "Conversation introuvable" }); return null; }
    return conv;
  };

  app.get("/api/reponses/:id", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const lead = await storage.getLead(conv.leadId, req.userId);
      if (!lead) return res.status(404).json({ message: "Conversation introuvable" });
      const [envoyes, recus, campagne] = await Promise.all([
        storage.getOutreachMessages(req.userId, lead.id),
        storage.getInboxMessages(conv.id),
        lead.prospectionCampaignId ? storage.getProspectionCampaign(lead.prospectionCampaignId) : Promise.resolve(null),
      ]);
      const messages = [
        ...envoyes.filter((m) => m.sentAt).map((m) => ({
          id: `seq-${m.id}`, source: "sequence", sens: "sortant", nature: "nous", canal: m.platform,
          subject: m.subject, body: m.body, sentAt: m.sentAt,
        })),
        ...recus.map((m) => ({
          id: `inbox-${m.id}`, source: "boite", sens: m.sens, nature: m.nature, canal: conv.channel,
          subject: m.subject, body: m.body, sentAt: m.sentAt,
        })),
      ].sort((a, b) => new Date(a.sentAt as any).getTime() - new Date(b.sentAt as any).getTime());
      if (conv.nonLu) await storage.updateInboxConversation(conv.id, { nonLu: false });
      res.json({
        conversation: { ...conv, nonLu: false },
        lead,
        campagne: campagne && campagne.userId === req.userId
          ? { id: campagne.id, name: campagne.name, projectId: campagne.projectId, offer: campagne.offer, messageAngle: campagne.messageAngle }
          : null,
        messages,
      });
    } catch (e: any) {
      console.error(`[Reponses] détail : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec du chargement de la conversation" });
    }
  });

  // Rédige seulement : rien ne part sans « Envoyer ».
  app.post("/api/reponses/:id/proposition", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      res.json({ texte: await proposerReponse(req.userId, conv.id) });
    } catch (e: any) {
      if (e instanceof ConversationIntrouvableError) return res.status(404).json({ message: "Conversation introuvable" });
      if (e instanceof SignatureClientManquanteError) {
        return res.status(409).json({ code: e.code, message: "Ce projet client n'a pas de signature : renseigne-la dans ses connexions." });
      }
      console.error(`[Reponses] proposition : ${erreurSure(e)}`);
      res.status(500).json({ message: "Naya n'a pas pu proposer de réponse" });
    }
  });

  app.post("/api/reponses/:id/envoyer", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const texte = typeof req.body?.texte === "string" ? req.body.texte : "";
      const r = await envoyerReponse(conv.id, req.userId, texte, depsEnvoi);
      if (r.ok) return res.json(r);
      res.status(STATUT_REFUS[r.raison] ?? 409).json(r);
    } catch (e: any) {
      console.error(`[Reponses] envoi : ${erreurSure(e)}`);
      res.status(500).json({ ok: false, raison: "echec" });
    }
  });

  app.post("/api/reponses/:id/traitee", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      await storage.updateInboxConversation(conv.id, { statut: "traitee", nonLu: false });
      if (conv.taskId) {
        const t = await storage.getTask(conv.taskId);
        if (t && !t.completed) await storage.completeTask(t.id);
      }
      res.json({ ok: true });
    } catch (e: any) {
      console.error(`[Reponses] traitée : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec" });
    }
  });

  // Faux positif : la séquence reprend là où elle était (R12 : restaurerEtatSequence, seul
  // chemin hors de stopped_replied ; une désinscription reste définitive).
  app.post("/api/reponses/:id/pas-une-reponse", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      // Jeanne a déjà répondu après le dernier message entrant : c'était bien une réponse.
      const fil = await storage.getInboxMessages(conv.id);
      const t = (m: { sentAt: Date }) => new Date(m.sentAt).getTime();
      const dernierEntrant = Math.max(-Infinity, ...fil.filter((m) => m.sens === "entrant").map(t));
      if (fil.some((m) => m.sens === "sortant" && m.nature === "nous" && t(m) > dernierEntrant)) {
        return res.status(409).json({ ok: false, raison: "deja_repondu" });
      }
      await storage.requalifierDernierEntrantInbox(conv.id, "accuse");
      const etat = conv.etatAvantReponse as EtatAvantReponse | null;
      let restaure = false;
      let raison: string | undefined;
      // Une AUTRE vraie réponse du lead attend encore (après requalification de celle-ci) :
      // la séquence reste arrêtée, et l'état d'avant est gardé pour une restauration future.
      const autre = etat ? await storage.autreReponseEnAttente(conv.leadId, conv.id) : false;
      if (etat && autre) {
        raison = "autre_reponse_en_attente";
      } else if (etat) {
        const plan = planRestauration(etat, new Date());
        restaure = !!(await storage.restaurerEtatSequence(conv.leadId, plan.etat, plan.opts));
        // R13 : défaire les suites de l'ingestion (au mieux : l'état est déjà restauré).
        if (etat.repondueLe) {
          await storage.annulerReponseOutreach(conv.leadId, new Date(etat.repondueLe))
            .catch((e: any) => console.error(`[Reponses] annulation du marquage outreach (lead ${conv.leadId}) : ${erreurSure(e)}`));
        }
        if (etat.stageAvant) {
          const lead = await storage.getLead(conv.leadId, req.userId);
          // Seulement si le lead est encore là où l'ingestion l'a mis : un stade choisi par
          // Jeanne depuis la réponse n'est jamais écrasé.
          if (lead?.stage === "in_discussion") {
            await storage.updateLead(conv.leadId, req.userId, { stage: etat.stageAvant })
              .catch((e: any) => console.error(`[Reponses] stade non restauré (lead ${conv.leadId}) : ${erreurSure(e)}`));
          }
        }
      }
      // etatAvantReponse effacé une fois consommé : une prochaine vraie réponse sauvegardera
      // l'état du moment. Gardé si la restauration a été différée (autre réponse en attente).
      await storage.updateInboxConversation(conv.id, {
        statut: "traitee", nonLu: false, taskId: null, ...(raison ? {} : { etatAvantReponse: null }),
      });
      if (conv.taskId) await storage.deleteTask(conv.taskId);
      res.json({ ok: true, restaure, ...(raison ? { raison } : {}) });
    } catch (e: any) {
      console.error(`[Reponses] pas une réponse : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec" });
    }
  });

  // Invitation LinkedIn vue acceptée à la main (avant Naya). Seul point d'écriture :
  // setLeadLinkedinConnected (garde la date la plus ancienne, réveille la séquence active).
  app.post("/api/leads/:id/invitation-acceptee", isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "identifiant invalide" });
    try {
      const lead = await storage.getLead(id, req.userId);
      if (!lead) return res.status(404).json({ message: "Prospect introuvable" });
      await storage.setLeadLinkedinConnected(id, new Date());
      const apres = await storage.getLead(id, req.userId);
      res.json({ linkedinConnectedAt: apres?.linkedinConnectedAt ?? null });
    } catch (e: any) {
      console.error(`[Reponses] invitation acceptée lead ${id} : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec de l'enregistrement" });
    }
  });

  // Publiques : pas d'isAuthenticated (le destinataire n'a pas de compte).
  // Un GET ne désinscrit jamais (les antivirus et aperçus suivent les liens).
  app.get("/desinscription/:jeton", (req, res) => {
    if (leadDuJeton(req.params.jeton) === null) {
      return res.status(404).type("html").send(page("Lien invalide", "<h1>Lien invalide</h1><p>Ce lien de désinscription n'est pas valide.</p>"));
    }
    res.type("html").send(page("Se désinscrire", `<h1>Se désinscrire</h1>
<p>Vous ne recevrez plus de messages de cet expéditeur.</p>
<form method="post"><button type="submit">Se désinscrire</button></form>`));
  });

  app.post("/desinscription/:jeton", async (req, res) => {
    const leadId = leadDuJeton(req.params.jeton);
    if (leadId === null) {
      return res.status(404).type("html").send(page("Lien invalide", "<h1>Lien invalide</h1><p>Ce lien de désinscription n'est pas valide.</p>"));
    }
    try {
      // Même chemin que le webhook SendGrid : définitif, la séquence entière s'arrête.
      await storage.updateLeadSequenceState(leadId, { status: "unsubscribed", nextRunAt: null } as any);
    } catch (e: any) {
      console.error(`[Desinscription] échec lead ${leadId} : ${String(e?.message ?? e)}`);
      return res.status(500).type("html").send(page("Erreur", "<h1>Une erreur est survenue</h1><p>Merci de réessayer dans un instant.</p>"));
    }
    res.type("html").send(page("Désinscription confirmée", "<h1>Vous êtes désinscrit</h1><p>Vous ne recevrez plus de messages.</p>"));
  });

  // Webhook Unipile (réponses, acceptations, suivi email, statut des comptes). Public,
  // authentifié par l'en-tête secret posé à la création du webhook (ensureWebhooks).
  // Le corps est lu en JSON quel que soit le Content-Type (index.ts monte le même parseur
  // avant express.json() global ; celui-ci ne s'applique que si le corps n'a pas été lu).
  // Jamais coupé par PROSPECTION_SENDING_ENABLED : c'est de la réception.
  app.post("/api/unipile/webhook", express.json({ type: () => true, limit: "2mb" }), (req, res) => {
    const secret = process.env.UNIPILE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ message: "webhook non configuré" });
    if (!memeSecret(req.get("Unipile-Auth"), secret)) return res.status(401).json({ message: "non autorisé" });
    // 200 tout de suite (Unipile attend une réponse en moins de 30 s), traitement ensuite.
    res.status(200).json({ ok: true });
    const evt = normaliser(req.body);
    if (!evt) return;
    traiterEvenement(evt, depsDepuisStorage(storage)).catch((e: any) => {
      console.error(`[Reponses] webhook ${evt.kind} non traité (compte ${evt.accountId}) : ${erreurSure(e)}`);
    });
  });
}
