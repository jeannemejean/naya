/**
 * Service de génération de plan d'action depuis un objectif — Naya
 *
 * Logique : Objectif → Plan IA → Tâches actionnables typées
 * Chaque tâche a un taskType qui détermine l'action côté web/mobile :
 *   - linkedin_message   → message rédigé, bouton "Copier & marquer envoyé"
 *   - post_publish       → contenu rédigé, bouton "Publier"
 *   - canva_task         → brief pour Canva, bouton "Ouvrir Canva"
 *   - outreach_action    → action de prospection (enrichir, envoyer)
 *   - generic            → tâche standard avec checkbox
 */

import { callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";
import { imposerLangueDuCompte, langueDuCompte } from "./garde-langue";
import { consignesGenerateur } from "./consignes-generateur";

export interface GeneratedTask {
  title: string;
  description?: string;
  taskType: "generic" | "linkedin_message" | "post_publish" | "canva_task" | "call" | "email" | "outreach_action";
  actionData?: {
    message?: string;
    postContent?: string;
    canvaBrief?: string;
    externalUrl?: string;
    platform?: string;
    leadName?: string;
    subject?: string;
  };
  estimatedDuration?: number; // minutes
  taskEnergyType?: "deep_work" | "creative" | "admin" | "social" | "logistics" | "execution";
  scheduledDate?: string; // YYYY-MM-DD suggestion
  priority?: number;
  type?: string;
  category?: string;
}

export async function generateGoalTasks(
  userId: string,
  goalId: number
): Promise<GeneratedTask[]> {

  // 1. Charger l'objectif
  const goal = await storage.getProjectGoal(goalId);
  if (!goal) throw new Error("Goal not found");

  // 2. Charger le projet + Brand DNA
  const brandDna = await storage.getBrandDna(userId);
  const project = await storage.getProject(goal.projectId, userId);

  const businessName = brandDna?.businessName || "L'agence";
  const founderName = (brandDna as any)?.founderName || (brandDna as any)?.contactName || "Fondateur";
  const offers = (brandDna as any)?.offers || brandDna?.uniquePositioning || "";
  const audience = (brandDna as any)?.primaryAudience || brandDna?.targetAudience || "";

  // 3. Calculer la date cible
  const dueDate = goal.dueDate ? new Date(goal.dueDate).toISOString().slice(0, 10) : null;
  const today = new Date().toISOString().slice(0, 10);
  const langue = await langueDuCompte(userId);

  const prompt = `Tu es Naya, un OS IA pour entrepreneurs. Tu dois générer un plan d'action concret et actionnable pour atteindre l'objectif suivant.

OBJECTIF :
Titre : ${goal.title}
Description : ${goal.description || "Aucune"}
Type : ${goal.goalType}
Valeur cible : ${goal.targetValue || "Non précisé"}
Date limite : ${dueDate || "Pas de deadline"}
Mode de succès : ${goal.successMode}

CONTEXTE BUSINESS :
Business : ${businessName}
Fondateur : ${founderName}
Offres : ${offers}
Audience : ${audience}
Projet : ${project?.name || ""}

RÈGLES DE GÉNÉRATION :
1. Génère entre 6 et 12 tâches concrètes qui permettent d'atteindre l'objectif.
2. Pour chaque tâche, choisis le bon taskType parmi :
   - "email" : si la tâche consiste à envoyer un email à un client, un partenaire ou un fournisseur déjà en relation (inclure objet dans actionData.subject, contenu dans actionData.message)
   - "call" : si la tâche est un appel avec un client ou un partenaire existant
   - "generic" : pour toutes les autres tâches (offre, tarifs, process de vente, livraison client, réunion, analyse, configuration, etc.)

3. Le contenu (posts, carrousels, visuels, newsletters) et la prospection (identifier des prospects, messages, relances) ne font PAS partie de ce plan : ils viennent du calendrier éditorial et du pipeline de prospection. Pour un objectif de type "signer X clients", concentre-toi sur ce qui les fait signer une fois en contact :
   - clarifier et chiffrer l'offre, préparer la proposition commerciale et le devis type
   - préparer les appels découverte (trame, objections, cas clients)
   - organiser l'onboarding et la livraison des clients signés

4. Chaque tâche doit être IMMÉDIATEMENT EXÉCUTABLE (pas "définir la stratégie", mais "Chiffrer les 3 formules de [offre] et fixer le prix plancher").

5. Pour les emails : les rédiger complètement, prêts à copier-coller.

6. Suggère une date de réalisation (scheduledDate) pour chaque tâche en commençant dès aujourd'hui (${today}), réparties sur les prochaines semaines selon la deadline ${dueDate || "(à définir)"}.

Réponds UNIQUEMENT en JSON avec ce format :
{
  "tasks": [
    {
      "title": "Titre court et actionnable",
      "description": "Contexte/détail optionnel",
      "taskType": "email|call|generic",
      "actionData": {
        "message": "Texte rédigé si email",
        "subject": "Objet si email",
        "externalUrl": "Lien externe si pertinent"
      },
      "estimatedDuration": 30,
      "taskEnergyType": "deep_work|creative|admin|social|logistics|execution",
      "scheduledDate": "YYYY-MM-DD",
      "priority": 1,
      "type": "admin|planning|execution",
      "category": "conversion|trust|engagement|planning"
    }
  ]
}

${consignesGenerateur(langue)}`;

  const raw = await callClaudeWithContext({
    userId,
    projectId: goal.projectId ?? null,
    userMessage: prompt,
    model: CLAUDE_MODELS.smart,
    max_tokens: 3000,
    temperature: 0.4,
  });

  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    const parsed = JSON.parse(json);
    const tasks: GeneratedTask[] = parsed.tasks || [];
    // Garde de sortie : titres et descriptions dans la langue du compte.
    await imposerLangueDuCompte(tasks as any[], userId);
    return tasks;
  } catch {
    return [];
  }
}
