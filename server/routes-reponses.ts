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
import { creerTache, modifierTache } from "./services/taches/ecrire-tache";
import {
  validerRelance, refuserRelance, reformulerRelance, modifierRelance, deplacerRelance, relancesAuRequalifier, vueRelances, type DepsRelance,
} from "./services/reponses/relance";
import { estEtatAvant } from "./services/reponses/relance-etat";

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
  estDesinscrit: (leadId, userId) => storage.isLeadUnsubscribed(leadId, userId),
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

/** Accès réels des relances (le service est testé sans base). Rien n'y envoie de message. */
const depsRelance: DepsRelance = {
  now: () => new Date(),
  getConversation: (id, userId) => storage.getInboxConversationParId(id, userId),
  getMessages: (cid) => storage.getInboxMessages(cid),
  getLead: (id, userId) => storage.getLead(id, userId),
  getPrefs: (userId) => storage.getUserPreferences(userId) as any,
  getTask: (id) => storage.getTask(id),
  reserver: (cid, mid, now) => storage.reserverRelanceInbox(cid, mid, now),
  ecrire: (cid, mid, d, siEnCoursLe) => storage.ecrireRelanceInbox(cid, mid, d, siEnCoursLe),
  estDesinscrit: (leadId, userId) => storage.isLeadUnsubscribed(leadId, userId),
  refuser: (cid, mid, now) => storage.refuserRelanceInbox(cid, mid, now),
  creerTache: (userId, donnees) => creerTache(userId, donnees),
  rediger: (userId, cid, relance) => proposerReponse(userId, cid, undefined, relance),
  etatSequence: async (leadId) => (await storage.getLeadSequenceState(leadId)) ?? undefined,
  arreterSequence: (leadId) => storage.updateLeadSequenceState(leadId, { status: "stopped_replied", nextRunAt: null }),
  majTache: (id, patch) => storage.updateTask(id, patch),
  deplacerTache: (userId, taskId, patch) => modifierTache(userId, taskId, patch),
};

/** Délai de traitement d'un webhook avant de répondre 500 (Unipile coupe à 30 s). Modifiable en test. */
export const reglagesWebhook = { delaiMs: 20_000 };

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

  // Conversation « à traiter » d'un prospect (tâche « Répondre à… » → fil). Propriété vérifiée
  // par le filtre userId de la liste ; 404 si rien n'attend pour ce prospect.
  app.get("/api/reponses/par-lead/:leadId", isAuthenticated, async (req: any, res) => {
    const leadId = Number(req.params.leadId);
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ message: "identifiant invalide" });
    try {
      const liste = await storage.listerConversationsInbox(req.userId, { statut: "a_traiter" });
      const conv = liste.find((c) => c.leadId === leadId);
      if (!conv) return res.status(404).json({ message: "Aucune réponse à traiter pour ce prospect" });
      res.json({ conversationId: conv.id });
    } catch (e: any) {
      console.error(`[Reponses] par lead : ${erreurSure(e)}`);
      res.status(500).json({ message: "Échec" });
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
      // Relances : au mieux (une erreur ici ne doit jamais cacher le fil).
      // Prospect désinscrit / « ne plus contacter » (ou lecture impossible) : aucune relance proposée.
      const bloque = await storage.isLeadUnsubscribed(lead.id, req.userId).catch(() => true);
      const relances = await vueRelances(conv, recus, await storage.getUserPreferences(req.userId), depsRelance, { bloque })
        .catch((e: any) => { console.error(`[Reponses] relances : ${erreurSure(e)}`); return { parMessage: {} as Record<number, never>, prete: null }; });
      const messages = [
        ...envoyes.filter((m) => m.sentAt).map((m) => ({
          id: `seq-${m.id}`, source: "sequence", sens: "sortant", nature: "nous", canal: m.platform,
          subject: m.subject, body: m.body, sentAt: m.sentAt,
        })),
        ...recus.map((m) => ({
          id: `inbox-${m.id}`, source: "boite", sens: m.sens, nature: m.nature, canal: conv.channel,
          subject: m.subject, body: m.body, sentAt: m.sentAt,
          ...(relances.parMessage[m.id] ? { relance: relances.parMessage[m.id] } : {}),
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
        relancePrete: relances.prete,
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

  // ── Relances demandées par le prospect. Valider crée une tâche datée et rédige le message ;
  // rien n'est jamais envoyé ici (l'envoi reste le clic « Envoyer » du jour venu).
  const idMessage = (req: any) => { const n = Number(req.params.messageId); return Number.isInteger(n) && n > 0 ? n : null; };

  app.post("/api/reponses/:id/relances/:messageId/valider", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const mid = idMessage(req);
      if (mid == null) return res.status(400).json({ ok: false, raison: "introuvable" });
      const date = typeof req.body?.date === "string" ? req.body.date : null;
      const r = await validerRelance(req.userId, conv.id, mid, date, depsRelance);
      if (r.ok) return res.json(r);
      res.status(r.status).json({ ok: false, raison: r.raison });
    } catch (e: any) {
      if (e instanceof SignatureClientManquanteError) {
        return res.status(409).json({ ok: false, raison: "signature_client", message: "Ce projet client n'a pas de signature : renseigne-la dans ses connexions." });
      }
      console.error(`[Reponses] relance (validation) : ${erreurSure(e)}`);
      res.status(500).json({ ok: false, raison: "echec" });
    }
  });

  app.post("/api/reponses/:id/relances/:messageId/refuser", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const mid = idMessage(req);
      if (mid == null) return res.status(400).json({ ok: false, raison: "introuvable" });
      const r = await refuserRelance(req.userId, conv.id, mid, depsRelance);
      if (r.ok) return res.json(r);
      res.status(r.status).json(r);
    } catch (e: any) {
      console.error(`[Reponses] relance (refus) : ${erreurSure(e)}`);
      res.status(500).json({ ok: false, raison: "echec" });
    }
  });

  // Brouillon de relance relu et modifié : rangé dans la tâche, reste un brouillon (jamais envoyé).
  app.post("/api/reponses/:id/relances/:messageId/texte", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const mid = idMessage(req);
      if (mid == null) return res.status(400).json({ ok: false, raison: "introuvable" });
      const r = await modifierRelance(req.userId, conv.id, mid, req.body?.texte, depsRelance);
      if (r.ok) return res.json(r);
      res.status(r.status).json(r);
    } catch (e: any) {
      console.error(`[Reponses] relance (modification) : ${erreurSure(e)}`);
      res.status(500).json({ ok: false, raison: "echec" });
    }
  });

  // Nouvelle date d'une relance validée : la tâche et la date convenue bougent ensemble.
  app.post("/api/reponses/:id/relances/:messageId/date", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const mid = idMessage(req);
      if (mid == null) return res.status(400).json({ ok: false, raison: "introuvable" });
      const r = await deplacerRelance(req.userId, conv.id, mid, req.body?.date, depsRelance);
      if (r.ok) return res.json(r);
      res.status(r.status).json(r);
    } catch (e: any) {
      console.error(`[Reponses] relance (date) : ${erreurSure(e)}`);
      res.status(500).json({ ok: false, raison: "echec" });
    }
  });

  // « Proposer une autre version » de la relance : rédige seulement.
  app.post("/api/reponses/:id/relances/:messageId/proposition", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const mid = idMessage(req);
      if (mid == null) return res.status(400).json({ message: "identifiant invalide" });
      const r = await reformulerRelance(req.userId, conv.id, mid, depsRelance);
      if (r.ok) return res.json({ texte: r.texte });
      res.status(r.status).json({ message: "Aucune relance validée pour ce message" });
    } catch (e: any) {
      if (e instanceof SignatureClientManquanteError) {
        return res.status(409).json({ code: e.code, message: "Ce projet client n'a pas de signature : renseigne-la dans ses connexions." });
      }
      console.error(`[Reponses] relance (proposition) : ${erreurSure(e)}`);
      res.status(500).json({ message: "Naya n'a pas pu proposer de relance" });
    }
  });

  app.post("/api/reponses/:id/envoyer", isAuthenticated, async (req: any, res) => {
    try {
      const conv = await conversationDe(req, res);
      if (!conv) return;
      const texte = typeof req.body?.texte === "string" ? req.body.texte : "";
      const r = await envoyerReponse(conv.id, req.userId, texte, depsEnvoi);
      if (r.ok) {
        // La relance du jour est faite : sa tâche est cochée (au mieux, le message est parti).
        try {
          const fraiche = await storage.getInboxConversationParId(conv.id, req.userId);
          const vue = fraiche
            ? await vueRelances(fraiche, await storage.getInboxMessages(conv.id), await storage.getUserPreferences(req.userId), depsRelance)
            : null;
          if (vue?.prete) await storage.completeTask(vue.prete.taskId);
        } catch (e: any) {
          console.error(`[Reponses] tâche de relance non cochée (conversation ${conv.id}) : ${erreurSure(e)}`);
        }
        return res.json(r);
      }
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
      // Le jsonb peut ne porter que des décisions de relance : seul un `status` est un état d'avant.
      const etat = estEtatAvant(conv.etatAvantReponse) ? conv.etatAvantReponse : null;
      let restaure = false;
      let raison: string | undefined;
      // Relances : celle du message requalifié n'a plus d'objet (annulée, tâche retirée) ; une
      // relance validée sur un AUTRE message garde la séquence à l'arrêt jusqu'à sa date.
      const requalifie = [...fil].filter((m) => m.sens === "entrant")
        .sort((a, b) => (t(b) - t(a)) || (b.id - a.id))[0]?.id ?? null;
      const relancePrevue = await relancesAuRequalifier(conv, requalifie, {
        getTask: (id) => storage.getTask(id), supprimerTache: (id) => storage.deleteTask(id),
        ecrire: (cid, mid, d) => storage.ecrireRelanceInbox(cid, mid, d), now: () => new Date(),
      });
      // Une AUTRE vraie réponse du lead attend encore (après requalification de celle-ci) :
      // la séquence reste arrêtée, et l'état d'avant est gardé pour une restauration future.
      const autre = etat ? await storage.autreReponseEnAttente(conv.leadId, conv.id) : false;
      if (etat && autre) {
        raison = "autre_reponse_en_attente";
      } else if (etat && relancePrevue) {
        // Une relance validée attend sur un autre message : la séquence ne reprend PAS (elle
        // relancerait le prospect avant la date qu'il a choisie). L'état d'avant est gardé :
        // si cette relance est faite ou retirée, un nouveau « pas une vraie réponse » ne le
        // restaurera pas tout seul — c'est voulu, le prospect a bel et bien répondu.
        raison = "relance_prevue";
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
      // (Les décisions de relance, rangées dans le même jsonb, sont toujours gardées.)
      await storage.updateInboxConversation(conv.id, { statut: "traitee", nonLu: false, taskId: null });
      if (!raison) await storage.effacerEtatAvantReponse(conv.id);
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
    let issue;
    try {
      // Même chemin que le webhook SendGrid : définitif, la séquence entière s'arrête. Prospect
      // supprimé depuis l'envoi : sa pierre tombale devient « ne plus contacter ».
      issue = await storage.desinscrireProspect(leadId);
    } catch (e: any) {
      console.error(`[Desinscription] échec lead ${leadId} : ${String(e?.message ?? e)}`);
      return res.status(500).type("html").send(page("Erreur", "<h1>Une erreur est survenue</h1><p>Merci de réessayer dans un instant.</p>"));
    }
    if (issue === "inconnu") {
      // Ni fiche ni pierre tombale (supprimée il y a plus de 90 jours, ou jamais contactée) :
      // on ne prétend pas avoir enregistré ce qu'on n'a pas pu enregistrer.
      console.error(`[Desinscription] DÉSINSCRIPTION NON ENREGISTRÉE : lead ${leadId} introuvable (ni fiche ni trace de suppression)`);
      return res.status(404).type("html").send(page("Désinscription impossible ici",
        "<h1>Nous n'avons pas retrouvé votre adresse</h1><p>Cette demande n'a pas pu être enregistrée automatiquement. Répondez directement à l'email reçu en demandant à ne plus être contacté : l'expéditeur la verra.</p>"));
    }
    res.type("html").send(page("Désinscription confirmée", "<h1>Vous êtes désinscrit</h1><p>Vous ne recevrez plus de messages.</p>"));
  });

  // Webhook Unipile (réponses, acceptations, suivi email, statut des comptes). Public,
  // authentifié par l'en-tête secret posé à la création du webhook (ensureWebhooks).
  // Le corps est lu en JSON quel que soit le Content-Type (index.ts monte le même parseur
  // avant express.json() global ; celui-ci ne s'applique que si le corps n'a pas été lu).
  // Jamais coupé par PROSPECTION_SENDING_ENABLED : c'est de la réception.
  app.post("/api/unipile/webhook", express.json({ type: () => true, limit: "2mb" }), async (req, res) => {
    const secret = process.env.UNIPILE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ message: "webhook non configuré" });
    if (!memeSecret(req.get("Unipile-Auth"), secret)) {
      // Visible dans les journaux (secret tourné, webhook à recréer) — jamais le secret ni le corps.
      console.warn(`[Reponses] webhook Unipile refusé (401) : en-tête Unipile-Auth ${req.get("Unipile-Auth") ? "différent du secret" : "absent"}`);
      return res.status(401).json({ message: "non autorisé" });
    }
    const evt = normaliser(req.body);
    if (!evt) return res.status(200).json({ ok: true });
    // Traité AVANT de répondre (Unipile attend moins de 30 s) : en cas d'échec ou de délai
    // dépassé, 500 → Unipile renvoie l'événement (le traitement est idempotent).
    const traitement = Promise.resolve().then(() => traiterEvenement(evt, depsDepuisStorage(storage)));
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const delai = new Promise<"delai">((r) => { minuteur = setTimeout(() => r("delai"), reglagesWebhook.delaiMs); });
    try {
      const issue = await Promise.race([traitement.then(() => "ok" as const), delai]);
      if (issue === "delai") {
        console.error(`[Reponses] webhook ${evt.kind} : traitement trop long (compte ${evt.accountId}) — 500, Unipile renverra`);
        traitement.catch((e: any) => console.error(`[Reponses] webhook ${evt.kind} non traité (compte ${evt.accountId}) : ${erreurSure(e)}`));
        return res.status(500).json({ message: "délai dépassé" });
      }
      return res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error(`[Reponses] webhook ${evt.kind} non traité (compte ${evt.accountId}) : ${erreurSure(e)}`);
      return res.status(500).json({ message: "erreur de traitement" });
    } finally {
      clearTimeout(minuteur);
    }
  });
}
