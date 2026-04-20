import { storage } from "../storage";
import { computeGoalUrgencyScore, formatGoalsWithUrgency } from "./goal-urgency";
import { formatBehaviorPatternsForContext } from "./behavior-patterns";

/**
 * Build complete Naya context for AI calls.
 * Injected into EVERY AI call via callClaudeWithContext().
 */
export async function buildNayaContext(
  userId: string,
  projectId?: number | null
): Promise<string> {
  const sections: string[] = [];

  try {
    const [
      globalBrandDna,
      user,
      project,
      activeGoals,
      stratProfile,
      targetPersonas,
      userPersona,
      recentMemories,
      energyPrefs,
      projectMilestonesList,
    ] = await Promise.all([
      storage.getBrandDna(userId),
      storage.getUser(userId),
      projectId ? storage.getProject(projectId, userId) : null,
      projectId ? storage.getActiveGoalsForProject(projectId) : [],
      projectId ? storage.getProjectStrategyProfile(projectId) : null,
      projectId ? storage.getTargetPersonas(userId, projectId) : [],
      storage.getLatestPersonaAnalysis(userId, 'user'),
      getRecentMemories(userId, 5),
      storage.getUserPreferences(userId),
      projectId ? storage.getMilestones(projectId, userId).catch(() => []) : [],
    ]);

    // Load goal progress for all active goals
    const goalProgressMap: Record<number, { completed: number; total: number }> = {};
    if (activeGoals.length > 0) {
      await Promise.all(
        activeGoals.map(async (g) => {
          goalProgressMap[g.id] = await storage.getGoalProgress(g.id).catch(() => ({ completed: 0, total: 0 }));
        })
      );
    }

    // Project-specific Brand DNA takes priority over global
    let brandDna = globalBrandDna;
    if (projectId) {
      const projectSpecificDna = await storage.getBrandDnaForProject(userId, projectId).catch(() => null);
      if (projectSpecificDna) brandDna = projectSpecificDna;
    }

    // Section 1 : Identité business
    if (brandDna) {
      sections.push(`## Identité business
Nom : ${brandDna.businessName || 'Non renseigné'}
Type : ${brandDna.businessType || 'Non renseigné'}
Description : ${brandDna.businessModel || 'Non renseigné'}
Positionnement unique : ${brandDna.uniquePositioning || 'Non renseigné'}
Audience principale : ${brandDna.targetAudience || 'Non renseigné'}
Douleur principale : ${brandDna.corePainPoint || 'Non renseigné'}
Aspiration audience : ${brandDna.audienceAspiration || 'Non renseigné'}
Urgence revenue : ${brandDna.revenueUrgency || 'Non renseigné'}
Plateforme prioritaire : ${brandDna.platformPriority || 'Non renseigné'}
Style de communication : ${brandDna.communicationStyle || 'Non renseigné'}
Offres : ${(brandDna as any).offers || 'Non renseigné'}
Fourchette tarifaire : ${(brandDna as any).priceRange || 'Non renseigné'}
Priorité business active : ${(brandDna as any).activeBusinessPriority || 'Non renseigné'}
Stade actuel : ${(brandDna as any).currentBusinessStage || 'Non renseigné'}
Résumé intelligence Naya : ${(brandDna as any).nayaIntelligenceSummary || 'Pas encore généré'}`);
    }

    // Section 2 : Projet actif
    if (project) {
      const topGoal = activeGoals[0];
      sections.push(`## Projet actif : ${project.name}
Type : ${project.type} | Intent : ${project.monetizationIntent}
Niveau de priorité : ${project.priorityLevel}
Stade actuel : ${stratProfile?.currentStage || 'Non renseigné'}
Objectif actif : ${topGoal?.title || 'Aucun'}
Mode de succès : ${topGoal?.successMode || 'Non renseigné'}
Audience (projet) : ${stratProfile?.targetAudience || 'Non renseigné'}
Positionnement (projet) : ${stratProfile?.uniquePositioning || 'Non renseigné'}
Mode opératoire : ${stratProfile?.operatingMode || 'Non renseigné'}`);
    }

    // Section 2b : Objectifs actifs avec score d'urgence dynamique
    if (activeGoals.length > 0) {
      const goalsWithProgress = activeGoals.map(g => ({
        ...g,
        completedTasks: goalProgressMap[g.id]?.completed ?? 0,
        totalTasks: goalProgressMap[g.id]?.total ?? 0,
      }));

      // Trier par urgence décroissante
      const sortedGoals = [...goalsWithProgress].sort(
        (a, b) => computeGoalUrgencyScore(b) - computeGoalUrgencyScore(a),
      );

      sections.push(`## Objectifs actifs (triés par urgence)\n${formatGoalsWithUrgency(sortedGoals)}\n\nInstruction absolue : génère des tâches proportionnellement aux scores d'urgence. Un objectif 🚨 CRITIQUE doit représenter au moins 50% des tâches générées aujourd'hui.`);
    }

    // Section 3 : Jalons du projet (règle absolue : jamais de tâches pour un jalon locked)
    if (projectMilestonesList && projectMilestonesList.length > 0) {
      const active = projectMilestonesList.filter((m: any) => ['unlocked', 'active', 'completed'].includes(m.status));
      const locked = projectMilestonesList.filter((m: any) => m.status === 'locked');
      const lines: string[] = [];
      if (active.length > 0) {
        lines.push(`Jalons actifs/débloqués (tu PEUX générer des tâches pour ces jalons) :\n${active.map((m: any) => `- ✅ ${m.title}`).join('\n')}`);
      }
      if (locked.length > 0) {
        lines.push(`Jalons BLOQUÉS (tu NE DOIS PAS générer de tâches pour ces jalons) :\n${locked.map((m: any) => `- 🔒 ${m.title} (bloqué — condition non remplie)`).join('\n')}`);
      }
      if (lines.length > 0) {
        sections.push(`## Jalons du projet\n${lines.join('\n\n')}`);
      }
    }

    // Section 4 : Archétype utilisateur
    if (userPersona?.analysisResult) {
      const ar = userPersona.analysisResult as any;
      sections.push(`## Archétype utilisateur
Persona : ${ar.personaName || 'Non détecté'}
Style de décision : ${ar.decisionStyle || 'Non renseigné'}
Style de sortie préféré : ${ar.outputStyleGuidelines || 'Non renseigné'}
Traits comportementaux : ${ar.behaviorTraits?.join(', ') || 'Non renseigné'}`);
    }

    // Section 5 : Persona cible (audience)
    if (targetPersonas.length > 0) {
      const tp = targetPersonas[0];
      sections.push(`## Persona cible : ${tp.name}
Secteur : ${tp.industry || 'Non renseigné'}
Poste : ${tp.jobTitle || 'Non renseigné'}
Motivations : ${(tp.motivations || []).join(', ')}
Frustrations : ${(tp.frustrations || []).join(', ')}
Déclencheurs de décision : ${(tp.decisionTriggers || []).join(', ')}
Leviers de persuasion : ${(tp.persuasionDrivers || []).join(', ')}`);
    }

    // Section 6 : État fondateur aujourd'hui
    if (energyPrefs) {
      sections.push(`## État fondateur aujourd'hui
Niveau d'énergie : ${energyPrefs.currentEnergyLevel || 'high'}
Contexte émotionnel : ${energyPrefs.currentEmotionalContext || 'Aucun'}
Mis à jour le : ${energyPrefs.energyUpdatedDate || 'Non renseigné'}`);
    }

    // Section 6b : Patterns comportementaux (si disponibles)
    const bp = (energyPrefs as any)?.behaviorPatterns;
    if (bp) {
      const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      sections.push(formatBehaviorPatternsForContext(bp, todayName));
    }

    // Section 7 : Mémoire business récente
    if (recentMemories && recentMemories.length > 0) {
      const memText = recentMemories
        .map((m: any) => `- [${m.type || 'mémoire'}] ${m.content}`)
        .join('\n');
      sections.push(`## Mémoire business récente\n${memText}`);
    }

    if (sections.length === 0) {
      return "## Contexte\nPas de Brand DNA ni de projet configuré. L'utilisateur est probablement en onboarding.";
    }

    return sections.join('\n\n');
  } catch (error) {
    console.error('Erreur buildNayaContext:', error);
    return "## Contexte\nErreur lors du chargement du contexte. Réponse avec informations limitées.";
  }
}

async function getRecentMemories(userId: string, limit: number = 5): Promise<any[]> {
  try {
    if (typeof (storage as any).getBusinessMemories === 'function') {
      return await (storage as any).getBusinessMemories(userId, { limit, archived: false });
    }
    return [];
  } catch {
    return [];
  }
}
