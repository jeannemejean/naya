// Route du companion, servie par l'agent omniscient (boucle d'outils côté serveur).
// Web (NayaCompanion.tsx) et mobile ((tabs)/companion.tsx) appellent tous deux
// POST /api/companion/chat. Le contexte de session est enrichi comme avant (projets,
// tâches abandonnées, à venir, jalon actif, résumé business, énergie du jour).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { isAiBlocked } from "./services/usage";
import { executerAgent } from "./services/agent/boucle";
import { annulerAction } from "./services/agent/journal";
import { annulerProposition, validerProposition } from "./services/agent/propositions";
import { blocSession, dateDansFuseau, fuseauUtilisatrice } from "./services/agent/consignes";
import { buildSuggestions } from "./services/companion";
import { extractToMemory } from "./services/memory/extract";
import { resolveSubjectBrand } from "./services/memory/brand-resolve";

type Tour = { role: "user" | "assistant"; content: string };

// Historique envoyé par le client : on ne garde que des tours bien formés.
function historiquePropre(brut: unknown): Tour[] {
  if (!Array.isArray(brut)) return [];
  return brut.filter((m: any): m is Tour =>
    !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "");
}

function decalerJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function registerAgentRoutes(app: Express): void {
  // Annuler une action directe de l'agent (bouton « Annuler », 24 h). L'utilisatrice vient de
  // la session : l'action d'une autre est « introuvable ». 409 + raison si c'est impossible.
  app.post("/api/agent/actions/:id/annuler", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(409).json({ message: "introuvable" });
      const r = await annulerAction(userId, id, new Date());
      if (!r.ok) return res.status(409).json({ message: r.raison });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Annulation d'action de l'agent :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de l'annulation" });
    }
  });

  // Propositions à valider (spec §6.3). « Valider » exécute après avoir revérifié l'heure et
  // l'empreinte ; « Annuler » la ferme. « Ajuster » = l'utilisatrice répond dans le fil (le
  // client annule d'abord la proposition affichée). 409 + raison si c'est impossible.
  app.post("/api/agent/propositions/:id/valider", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(409).json({ message: "introuvable" });
      const prefs = await storage.getUserPreferences(userId).catch(() => null);
      const r = await validerProposition(userId, id, new Date(), { fuseau: fuseauUtilisatrice((prefs as any)?.timezone) });
      if (!r.ok) return res.status(409).json({ message: r.raison });
      res.json({ reussis: r.reussis, echecs: r.echecs });
    } catch (error: any) {
      console.error("Validation de proposition de l'agent :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de la validation" });
    }
  });

  app.post("/api/agent/propositions/:id/annuler", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(409).json({ message: "introuvable" });
      const r = await annulerProposition(userId, id);
      if (!r.ok) return res.status(409).json({ message: r.raison });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Annulation de proposition de l'agent :", error?.message || error);
      res.status(500).json({ message: "Erreur lors de l'annulation" });
    }
  });

  app.post("/api/companion/chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.userId;
      const { message, context, conversationHistory } = req.body ?? {};

      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "message requis" });
      }
      if (await isAiBlocked(userId)) return res.status(429).json({ message: "ai_monthly_limit_reached" });

      const clientContext = (context && typeof context === "object") ? context : {};
      const historique = historiquePropre(conversationHistory);
      const plateforme = clientContext.platform === "mobile" ? "mobile" : "web";

      const [userProjects, prefs, brandDna] = await Promise.all([
        storage.getProjects(userId),
        storage.getUserPreferences(userId).catch(() => null),
        storage.getBrandDna(userId).catch(() => null),
      ]);
      const maintenant = new Date();
      const fuseau = fuseauUtilisatrice((prefs as any)?.timezone);
      const aujourdHui = dateDansFuseau(maintenant, fuseau);

      // Tâches abandonnées (reportées 3 fois ou plus) et tâches des 7 prochains jours.
      const [recentTasks, upcomingRawTasks] = await Promise.all([
        storage.getTasksInRange(userId, decalerJours(aujourdHui, -14), aujourdHui).catch(() => []),
        storage.getTasksInRange(userId, aujourdHui, decalerJours(aujourdHui, 7)).catch(() => []),
      ]);
      const staleTasks = (recentTasks as any[])
        .filter((t) => !t.completed && (t.learnedAdjustmentCount || 0) >= 3)
        .map((t) => ({ id: t.id, title: t.title, learnedAdjustmentCount: t.learnedAdjustmentCount as number }))
        .slice(0, 8);
      const upcomingTasks = (upcomingRawTasks as any[])
        .filter((t) => !t.completed && String(t.scheduledDate).slice(0, 10) > aujourdHui)
        .slice(0, 10)
        .map((t) => ({ title: t.title, date: String(t.scheduledDate).slice(0, 10), time: t.scheduledTime || undefined, taskId: t.id }));

      // Projet actif : celui envoyé par le client, SEULEMENT s'il appartient à l'utilisatrice
      // (buildNayaContext lit objectifs et stratégie par projectId). Sinon, aucun projet actif :
      // ni repli sur un projet arbitraire, ni id étranger qui passerait jusqu'aux requêtes.
      const idClient = Number(clientContext.activeProject?.id);
      const projetActif = Number.isInteger(idClient)
        ? (userProjects as any[]).find((p) => p.id === idClient) ?? null
        : null;
      const activeProjectId: number | undefined = projetActif?.id ?? undefined;
      let jalonActif: { id: number; title: string; status: string } | null = null;
      if (activeProjectId) {
        const milestones = await storage.getMilestones(activeProjectId, userId).catch(() => []);
        const found = (milestones as any[]).find((m) => m.status === "active" || m.status === "unlocked");
        if (found) jalonActif = { id: found.id, title: found.title, status: found.status };
      }

      const contexteSession = blocSession({
        maintenant,
        fuseau,
        plateforme,
        projetActif: projetActif ? { id: projetActif.id, name: projetActif.name } : null,
        projetsDisponibles: (userProjects as any[]).slice(0, 15).map((p) => ({ id: p.id, name: p.name, type: p.type })),
        energie: (prefs as any)?.currentEnergyLevel ?? null,
        energieMiseAJourLe: (prefs as any)?.energyUpdatedDate ?? null,
        jalonActif,
        tachesDuJour: Array.isArray(clientContext.todayTasks) ? clientContext.todayTasks : undefined,
        tachesAbandonnees: staleTasks,
        tachesAVenir: upcomingTasks,
        evenementsAVenir: Array.isArray(clientContext.upcomingEvents) ? clientContext.upcomingEvents : undefined,
        resumeBusiness: (brandDna as any)?.nayaIntelligenceSummary || null,
      });

      const reponse = await executerAgent({
        userId,
        message,
        historique,
        contexteSession,
        projetActifId: activeProjectId,
        fuseau,
      });
      const suggestions = buildSuggestions({
        staleTasks,
        todayTasks: clientContext.todayTasks,
        activeProject: projetActif ? { id: projetActif.id, name: projetActif.name } : null,
      });

      // Persistance (non bloquante pour la réponse : une table absente ne casse pas le chat).
      try {
        await storage.saveCompanionMessage({ userId, role: "user", content: message, platform: plateforme });
        await storage.saveCompanionMessage({
          userId, role: "assistant", content: reponse.message, platform: plateforme,
          actions: { faites: reponse.faites, propositions: reponse.propositions, recherches: reponse.recherches },
        });
      } catch (dbErr) {
        console.warn("saveCompanionMessage ignoré :", dbErr);
      }

      res.json({ ...reponse, suggestions, actions: [] });

      // Mémoire (best-effort) : extraire de ce tour de conversation. La marque-sujet est la
      // marque NOMMÉE dans la conversation (message + historique), pas le projet actif.
      const convoText = [...historique.map((m) => m.content), message].join("\n");
      const subject = resolveSubjectBrand(convoText, (userProjects as any[]).map((p) => ({ id: p.id, name: p.name })));
      console.info(`[brand-routing] companion active=${activeProjectId ?? "null"} subject=${subject.projectId ?? "null"} matched=[${subject.matched.join(", ")}] ambiguous=${subject.ambiguous}`);
      extractToMemory({
        userId,
        projectId: activeProjectId ?? null,
        subjectProjectId: subject.projectId,
        sourceText: `Utilisateur : ${message}\nNaya : ${reponse.message}`,
        sourceType: "companion",
      }).catch(() => {});
    } catch (error: any) {
      console.error("Companion chat error:", error?.message || error);
      if (!res.headersSent) res.status(500).json({ message: "Erreur du Companion" });
    }
  });
}
