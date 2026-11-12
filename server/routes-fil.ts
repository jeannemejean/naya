// Routes du fil conducteur : propositions d'étapes (à la demande, « Refaire », « Ajuster »),
// rattachement des chaînes existantes et gestes de la clôture du vendredi. Toutes réservées à
// l'interrupteur (sinon 404). Valider et annuler passent par les routes de l'agent
// (/api/agent/propositions/:id/*).
import type { Express, NextFunction, Response } from "express";
import { isAuthenticated } from "./auth";
import { isAiBlocked } from "./services/usage";
import { depot } from "./services/agent/depot";
import { annulerProposition, proposerHorsConversation } from "./services/agent/propositions";
import { filActifPour } from "./services/fil/interrupteur";
import { OUTILS_FIL_PROPOSITIONS, objectifDe, proposerEtapesPour, proposerRattachements } from "./services/fil/etapes";
import { etapesActives } from "./services/fil/carte";
import { tacheDeReprise, REPRISE_MIN, REPRISE_MAX } from "./services/fil/oublis";
import { estPourquoiCreux, bornerPourquoi } from "./services/fil/rattachement";
import { construireMatin } from "./services/fil/matin";
import { archiverTache, creerTache, fusionnerActionData, modifierTache } from "./services/taches/ecrire-tache";
import { demandeTrancher, oublierClotureDe, trancher } from "./services/fil/cloture";
import { aujourdhuiParis } from "./services/repack-from";
import { storage } from "./storage";

function reserveAuFil(req: any, res: Response, next: NextFunction) {
  if (!filActifPour(req.userId)) return res.status(404).json({ message: "Not found" });
  next();
}

const idValide = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function registerFilRoutes(app: Express): void {
  // Le matin du fil (tâches clés, oubliés, journée allégée, non rattachées) pour l'écran : lu
  // à part du brief, jamais de génération du texte du brief. Le plafond IA des reprises
  // (matin.ts) s'applique comme au brief.
  app.get("/api/fil/matin", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const now = new Date();
      res.json(await construireMatin(req.userId, aujourdhuiParis(now), now));
    } catch (error: any) {
      console.error("Matin du fil :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la lecture du matin" });
    }
  });

  // Propositions ouvertes du fil, avec l'objectif concerné (titre) pour l'affichage.
  app.get("/api/fil/propositions", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const liste = await depot.propositionsEnAttente(userId, OUTILS_FIL_PROPOSITIONS, new Date());
      const sortie = await Promise.all(liste.map(async (p) => {
        const objectifId = idValide((p.arguments as any)?.objectifId);
        const objectif = objectifId ? (await objectifDe(userId, objectifId))?.objectif : null;
        return {
          id: p.id, outil: p.outil, arguments: p.arguments, changements: p.changements, expireA: p.expireA,
          objectif: objectif ? { id: objectif.id, titre: objectif.title, projetId: objectif.projectId } : null,
        };
      }));
      res.json(sortie);
    } catch (error: any) {
      console.error("Propositions du fil :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la lecture des propositions" });
    }
  });

  // À la demande, et « Refaire » avec `remplace` : la proposition en attente que la nouvelle
  // remplace. Elle n'est annulée qu'une fois la nouvelle créée : plafond IA, génération ratée
  // ou autre échec, l'ancienne reste intacte et Jeanne peut toujours la valider.
  app.post("/api/fil/objectifs/:id/proposer-etapes", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = idValide(req.params.id);
      if (!id || !(await objectifDe(userId, id))) return res.status(404).json({ message: "introuvable" });
      let ancienneId: number | undefined;
      if (req.body?.remplace !== undefined) {
        const rid = idValide(req.body.remplace);
        const ancienne = rid ? await depot.getProposition(rid, userId) : undefined;
        if (!ancienne || ancienne.outil !== "proposer_etapes" || Number((ancienne.arguments as any)?.objectifId) !== id) {
          return res.status(404).json({ message: "introuvable" });
        }
        if (ancienne.statut !== "en_attente") return res.status(409).json({ message: "deja_traitee" });
        ancienneId = ancienne.id;
      }
      if (await isAiBlocked(userId)) return res.status(429).json({ message: "ai_monthly_limit_reached" });
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : undefined;
      const r = ancienneId === undefined
        ? await proposerEtapesPour(userId, id, new Date(), note)
        : await proposerEtapesPour(userId, id, new Date(), note, { ignorer: ancienneId });
      if ("erreur" in r) return res.status(409).json({ message: r.erreur });
      if (ancienneId !== undefined) {
        const a = await annulerProposition(userId, ancienneId);
        if (!a.ok) {
          // L'ancienne a été validée ou annulée entre-temps : on retire la nouvelle.
          await annulerProposition(userId, r.id);
          return res.status(409).json({ message: a.raison });
        }
      }
      res.json(r);
    } catch (error: any) {
      console.error("Proposition d'étapes :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la proposition d'étapes" });
    }
  });

  // « Ajuster » : la liste éditée par Jeanne remplace l'ancienne proposition, sans IA. La
  // nouvelle est créée d'abord : refusée (2 étapes, ordre…), l'ancienne reste intacte.
  app.post("/api/fil/propositions/:id/ajuster", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = idValide(req.params.id);
      const ancienne = id ? await depot.getProposition(id, userId) : undefined;
      if (!ancienne || ancienne.outil !== "proposer_etapes") return res.status(404).json({ message: "introuvable" });
      if (ancienne.statut !== "en_attente") return res.status(409).json({ message: "deja_traitee" });
      const objectifId = (ancienne.arguments as any)?.objectifId;
      const nouvelle = await proposerHorsConversation(userId, "proposer_etapes", { objectifId, etapes: req.body?.etapes }, new Date());
      if ("erreur" in nouvelle) return res.status(400).json({ message: nouvelle.erreur });
      const a = await annulerProposition(userId, ancienne.id);
      if (!a.ok) {
        // L'ancienne a été validée ou annulée entre-temps : on retire la nouvelle.
        await annulerProposition(userId, nouvelle.id);
        return res.status(409).json({ message: a.raison });
      }
      res.json(nouvelle);
    } catch (error: any) {
      console.error("Ajustement d'étapes :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de l'ajustement" });
    }
  });

  // Objectif oublié → « Reprendre » : une tâche courte (15 à 30 min) posée aujourd'hui, rattachée
  // à l'objectif et à son étape en cours (jamais une étape verrouillée), avec son pourquoi. La
  // reprise déjà affichée au matin (titre + pourquoi) est créée telle quelle ; sinon, un appel
  // rapide la propose.
  app.post("/api/fil/objectifs/:id/reprendre", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = idValide(req.params.id);
      const o = id ? await objectifDe(userId, id) : undefined;
      if (!id || !o) return res.status(404).json({ message: "introuvable" });
      if (o.objectif.status !== "active") return res.status(409).json({ message: "objectif_inactif" });

      const titreRecu = typeof req.body?.titre === "string" ? req.body.titre.trim().slice(0, 200) : "";
      const pourquoiRecu = typeof req.body?.pourquoi === "string" ? bornerPourquoi(req.body.pourquoi) : "";
      let reprise: { titre: string; pourquoi: string; duree?: number } | null =
        titreRecu && !estPourquoiCreux(pourquoiRecu) ? { titre: titreRecu, pourquoi: pourquoiRecu } : null;
      if (!reprise) {
        if (await isAiBlocked(userId)) return res.status(429).json({ message: "ai_monthly_limit_reached" });
        reprise = await tacheDeReprise(userId, id);
        if (!reprise) return res.status(409).json({ message: "generation_impossible" });
      }

      const etape = etapesActives([...o.etapes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))[0];
      const brut = req.body?.clientToday;
      const date = typeof brut === "string" && /^\d{4}-\d{2}-\d{2}$/.test(brut) ? brut : aujourdhuiParis();
      const duree = Math.min(REPRISE_MAX, Math.max(REPRISE_MIN, Math.round(reprise.duree ?? 20)));
      const r = await creerTache(userId, {
        title: reprise.titre,
        pourquoi: reprise.pourquoi,
        type: "planning",
        category: "planning",
        priority: 2,
        estimatedDuration: duree,
        scheduledDate: date,
        projectId: o.objectif.projectId,
        goalId: o.objectif.id,
        milestoneId: etape?.id ?? null,
        source: "fil_reprise",
        completed: false,
      });
      if (!r.ok) return res.status(r.status).json({ message: r.message });
      await storage.fixOverlappingTasks(userId, date).catch((e: any) =>
        console.error("[fil] reprise, retassage :", e?.message));
      res.json(r.tache);
    } catch (error: any) {
      console.error("Reprise d'un objectif :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la reprise" });
    }
  });

  // Clôture du vendredi : le geste de Jeanne sur une tâche ouverte depuis plus de 7 jours. `faire`
  // la met aujourd'hui, `deplacer` à la date donnée (aujourd'hui ou plus tard), `abandonner`
  // l'archive (jamais supprimée). Naya ne tranche jamais seule : rien d'autre n'appelle ceci.
  app.post("/api/fil/trancher", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const corps = demandeTrancher.safeParse(req.body ?? {});
      if (!corps.success) return res.status(400).json({ message: "demande_invalide" });
      const r = await trancher(userId, corps.data, new Date(), {
        async lireTache(u, id) {
          const t = await storage.getTask(id);
          return t && t.userId === u ? t : undefined;
        },
        modifierTache,
        archiverTache,
        async marquerTranchee(u, id, semaine) {
          const m = await fusionnerActionData(u, id, "cloture", { tranchee: semaine });
          if (!m.ok) throw new Error(m.message);
        },
      });
      if (!r.ok) return res.status(r.status).json({ message: r.message });
      oublierClotureDe(userId);
      res.json(r.tache);
    } catch (error: any) {
      console.error("Trancher une tâche :", error?.message || error);
      res.status(500).json({ message: "Erreur lors du geste" });
    }
  });

  app.post("/api/fil/rattachements", isAuthenticated, reserveAuFil, async (req: any, res) => {
    try {
      res.json(await proposerRattachements(req.userId, new Date()));
    } catch (error: any) {
      console.error("Rattachement des chaînes :", error?.message || error);
      res.status(500).json({ message: "Erreur lors du rattachement" });
    }
  });
}
