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

import { callClaude, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";

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
   - "linkedin_message" : si la tâche consiste à envoyer un message de prospection sur LinkedIn (inclure le message rédigé dans actionData.message, nom du prospect dans actionData.leadName, platform: "linkedin")
   - "post_publish" : si la tâche consiste à publier un post/contenu (inclure le contenu rédigé dans actionData.postContent, la plateforme dans actionData.platform: "linkedin"|"instagram"|"newsletter")
   - "canva_task" : si la tâche consiste à créer un visuel (inclure le brief détaillé dans actionData.canvaBrief, lien Canva dans actionData.externalUrl: "https://www.canva.com/design/new")
   - "email" : si la tâche consiste à envoyer un email (inclure objet dans actionData.subject, contenu dans actionData.message)
   - "outreach_action" : si la tâche est liée à la prospection (identifier prospects, créer campagne, enrichir leads)
   - "generic" : pour toutes les autres tâches (réunion, analyse, configuration, etc.)

3. Pour les objectifs de type "signer X clients" :
   - Inclure des tâches de contenu (2-3 posts LinkedIn de prospection indirecte)
   - Inclure des tâches de prospection outreach (identifier prospects, créer campagne, enrichir)
   - Inclure des tâches de contact direct (messages LinkedIn, emails)
   - Inclure des tâches de suivi (relances, appels de découverte)
   - Un visuel Canva si pertinent (bannière LinkedIn, carousel)

4. Chaque tâche doit être IMMÉDIATEMENT EXÉCUTABLE depuis l'application (pas de "définir la stratégie", mais "Envoyer ce message LinkedIn à [nom]").

5. Pour les messages et contenus : les rédiger complètement, prêts à copier-coller.

6. Suggère une date de réalisation (scheduledDate) pour chaque tâche en commençant dès aujourd'hui (${today}), réparties sur les prochaines semaines selon la deadline ${dueDate || "(à définir)"}.

Réponds UNIQUEMENT en JSON avec ce format :
{
  "tasks": [
    {
      "title": "Titre court et actionnable",
      "description": "Contexte/détail optionnel",
      "taskType": "linkedin_message|post_publish|canva_task|email|outreach_action|generic",
      "actionData": {
        "message": "Texte rédigé si linkedin_message ou email",
        "postContent": "Contenu complet si post_publish",
        "canvaBrief": "Brief détaillé si canva_task",
        "subject": "Objet si email",
        "externalUrl": "URL si canva ou lien externe",
        "platform": "linkedin|instagram|newsletter si pertinent",
        "leadName": "Nom du prospect si linkedin_message"
      },
      "estimatedDuration": 30,
      "taskEnergyType": "deep_work|creative|admin|social|logistics|execution",
      "scheduledDate": "YYYY-MM-DD",
      "priority": 1,
      "type": "outreach|content|admin|planning",
      "category": "conversion|trust|engagement|planning"
    }
  ]
}`;

  const raw = await callClaude({
    model: CLAUDE_MODELS.smart,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3000,
    temperature: 0.4,
  });

  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    const parsed = JSON.parse(json);
    return parsed.tasks || [];
  } catch {
    return [];
  }
}
