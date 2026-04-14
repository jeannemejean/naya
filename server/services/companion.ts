import { callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";

const COMPANION_SYSTEM_ADDON = `
Tu es Naya en mode Companion — l'interface conversationnelle directe.

CAPACITÉS D'ACTION :
Tu peux déclencher des actions concrètes dans l'application. Quand tu veux agir, inclus un bloc JSON d'actions à la fin de ta réponse, délimité exactement ainsi :

<naya-actions>
[{"type": "create_task", "title": "Titre de la tâche", "scheduledDate": "2026-04-01", "projectId": null}]
</naya-actions>

TYPES D'ACTIONS DISPONIBLES :
- create_task: { type, title, scheduledDate?, projectId? }
- create_task_list: { type, title, items: [{title}], linkedDate?, linkedTaskId? }
- create_note: { type, content, projectId? }
- create_reminder: { type, title, datetime }
- complete_task: { type, taskId }
- reschedule_task: { type, taskId, newDate, newTime? }
- reschedule_day: { type, energyLevel?, reason? } — réorganise TOUTES les tâches incomplètes d'aujourd'hui selon l'énergie (utilise quand l'utilisateur dit "je suis épuisé", "allège ma journée", "j'ai peu d'énergie", etc.)
- set_energy: { type, level } — level: "high" | "medium" | "low" | "depleted"
- create_project: { type, name, projectType?, description?, milestones?: [{title, description?}] } — crée un nouveau projet, et optionnellement sa chaîne de jalons en une seule action
- create_milestone_chain: { type, projectId, milestones: [{title, description?, milestoneType?, conditionType?}] }
- confirm_milestone: { type, milestoneId }
- show_project_roadmap: { type, projectId }
- add_project_note: { type, projectId, content } — note stratégique liée à un projet
- reschedule_tasks: { type, fromDate, toDate } — déplace TOUTES les tâches incomplètes d'une date à une autre (ex: "décale toutes mes tâches de demain à jeudi"). Format YYYY-MM-DD.

RÈGLES :
1. Réponds en français naturellement. Les actions sont discrètes — l'utilisateur les voit exécutées, pas le JSON brut.
2. Quand on décrit une séquence avec des dépendances ("j'ai besoin de X pour faire Y", "avant Z il faut A"), c'est une CHAÎNE DE JALONS. Résume-la sous forme numérotée, demande confirmation, puis génère create_milestone_chain.
3. Jamais de tâches pour un jalon bloqué (les jalons locked sont dans le contexte).
4. Pour les dates relatives ("demain", "lundi prochain"), utilise la date actuelle fournie dans le contexte.
5. Si tu crées plusieurs tâches, utilise create_task_list plutôt que plusieurs create_task.
6. Tu peux combiner réponse textuelle ET actions dans le même message.
7. CRITIQUE : pour create_milestone_chain, tu DOIS utiliser le projectId exact fourni dans le contexte (ex: "id: 3"). N'invente JAMAIS un projectId. Si aucun projet ne correspond, utilise create_project à la place (qui crée le projet ET ses jalons en une action).
8. DÉTECTION DE PROJET : quand l'utilisateur mentionne un projet existant (ex: "pour Agence JMD"), utilise son id exact depuis la liste des projets disponibles.
9. CRÉATION AUTOMATIQUE : si l'utilisateur décrit quelque chose qui ressemble à un nouveau projet/initiative (voyage, lancement, événement, client...) et qu'aucun projet existant ne correspond, propose create_project avec une chaîne de jalons pertinente. Pas besoin de demander confirmation pour les projets simples.
`;

export type CompanionAction =
  | { type: "create_task"; title: string; scheduledDate?: string; projectId?: number | null }
  | { type: "create_task_list"; title: string; items: { title: string }[]; linkedDate?: string; linkedTaskId?: number }
  | { type: "create_note"; content: string; projectId?: number | null }
  | { type: "create_reminder"; title: string; datetime: string }
  | { type: "complete_task"; taskId: number }
  | { type: "reschedule_task"; taskId: number; newDate: string; newTime?: string }
  | { type: "reschedule_day"; energyLevel?: string; reason?: string }
  | { type: "set_energy"; level: "high" | "medium" | "low" | "depleted" }
  | { type: "create_project"; name: string; projectType?: string; description?: string; milestones?: { title: string; description?: string }[] }
  | { type: "create_milestone_chain"; projectId: number; milestones: any[] }
  | { type: "confirm_milestone"; milestoneId: number }
  | { type: "show_project_roadmap"; projectId: number }
  | { type: "add_project_note"; projectId: number; content: string }
  | { type: "reschedule_tasks"; fromDate: string; toDate: string };

export interface CompanionRequest {
  message: string;
  context: {
    currentDate: string;
    currentTime: string;
    platform: "web" | "mobile";
    upcomingEvents?: Array<{ title: string; date: string; time?: string; taskId: number }>;
    activeProject?: { id: number; name: string } | null;
    availableProjects?: Array<{ id: number; name: string }>;
    todayTasks?: any[];
    staleTasks?: Array<{ id: number; title: string; learnedAdjustmentCount: number }>;
    recentCaptures?: any[];
    // Enrichissement mobile :
    energyLevel?: string;
    upcomingTasks?: Array<{ title: string; date: string; time?: string; taskId: number }>;
    activeMilestone?: { id: number; title: string; status: string } | null;
    brandDnaSummary?: string | null;
  };
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface CompanionResponse {
  message: string;
  actions?: CompanionAction[];
  suggestions?: string[];
}

export async function processCompanionMessage(
  userId: string,
  request: CompanionRequest
): Promise<CompanionResponse> {
  const { message, context, conversationHistory = [] } = request;

  // Construire le prompt utilisateur enrichi avec le contexte session
  const contextLines: string[] = [
    `Date actuelle : ${context.currentDate} ${context.currentTime}`,
    `Plateforme : ${context.platform}`,
  ];

  if (context.activeProject) {
    contextLines.push(`Projet actif : ${context.activeProject.name} (id: ${context.activeProject.id})`);
  }

  if (context.availableProjects && context.availableProjects.length > 0) {
    const projectList = context.availableProjects
      .map(p => `  - ${p.name} (id: ${p.id})`)
      .join('\n');
    contextLines.push(`Projets disponibles (utilise ces IDs exacts pour create_milestone_chain) :\n${projectList}`);
  }

  if (context.todayTasks && context.todayTasks.length > 0) {
    const taskSummary = context.todayTasks
      .slice(0, 5)
      .map((t: any) => `- [${t.completed ? '✅' : '⬜'}] ${t.title}${t.scheduledTime ? ` à ${t.scheduledTime}` : ''}`)
      .join('\n');
    contextLines.push(`Tâches aujourd'hui :\n${taskSummary}`);
  }

  if (context.staleTasks && context.staleTasks.length > 0) {
    const staleList = context.staleTasks
      .map(t => `- [id:${t.id}] "${t.title}" (reportée ${t.learnedAdjustmentCount}x automatiquement)`)
      .join('\n');
    contextLines.push(`Tâches abandonnées (reportées 3x ou plus, jamais complétées) :\n${staleList}\nSi l'occasion se présente naturellement dans la conversation, propose-lui de les garder, reporter à une date précise, ou supprimer.`);
  }

  if (context.upcomingEvents && context.upcomingEvents.length > 0) {
    const events = context.upcomingEvents
      .slice(0, 3)
      .map(e => `- ${e.title} le ${e.date}${e.time ? ` à ${e.time}` : ''}`)
      .join('\n');
    contextLines.push(`Événements à venir :\n${events}`);
  }

  if (context.energyLevel) {
    contextLines.push(`Énergie actuelle : ${context.energyLevel}`);
  }

  if (context.activeMilestone) {
    contextLines.push(`Jalon actif : "${context.activeMilestone.title}" (id: ${context.activeMilestone.id}, statut: ${context.activeMilestone.status})`);
  }

  if (context.upcomingTasks && context.upcomingTasks.length > 0) {
    const upcoming = context.upcomingTasks
      .slice(0, 10)
      .map(t => `- ${t.title} le ${t.date}${t.time ? ` à ${t.time}` : ''}`)
      .join('\n');
    contextLines.push(`Tâches à venir (7 jours) :\n${upcoming}`);
  }

  if (context.brandDnaSummary) {
    contextLines.push(`Résumé business : ${context.brandDnaSummary}`);
  }

  const enrichedMessage = `[CONTEXTE SESSION]\n${contextLines.join('\n')}\n\n[MESSAGE]\n${message}`;

  // Construire les messages avec l'historique
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...conversationHistory.slice(-10), // Garder les 10 derniers messages
    { role: "user", content: enrichedMessage },
  ];

  // Appel Claude avec contexte complet Naya
  const raw = await callClaudeWithContext({
    userId,
    projectId: context.activeProject?.id ?? null,
    userMessage: messages.map(m => `${m.role === 'user' ? 'User' : 'Naya'}: ${m.content}`).join('\n\n'),
    model: CLAUDE_MODELS.smart,
    max_tokens: 2048,
    additionalSystemContext: COMPANION_SYSTEM_ADDON,
  });

  // Parser les actions du bloc <naya-actions>
  const actions: CompanionAction[] = [];
  let cleanMessage = raw;

  const actionsMatch = raw.match(/<naya-actions>\s*([\s\S]*?)\s*<\/naya-actions>/);
  if (actionsMatch) {
    try {
      const parsed = JSON.parse(actionsMatch[1]);
      if (Array.isArray(parsed)) actions.push(...parsed);
    } catch {
      // JSON invalide — on ignore silencieusement
    }
    cleanMessage = raw.replace(/<naya-actions>[\s\S]*?<\/naya-actions>/g, '').trim();
  }

  // Suggestions contextuelles
  const suggestions = buildSuggestions(context);

  // Persister dans la DB
  await storage.saveCompanionMessage({ userId, role: 'user', content: message, platform: context.platform });
  await storage.saveCompanionMessage({ userId, role: 'assistant', content: cleanMessage, actions: actions.length > 0 ? actions : null, platform: context.platform });

  return { message: cleanMessage, actions: actions.length > 0 ? actions : undefined, suggestions };
}

function buildSuggestions(context: CompanionRequest['context']): string[] {
  const base: string[] = [];
  if (context.staleTasks && context.staleTasks.length > 0) {
    base.push(`J'ai ${context.staleTasks.length} tâche${context.staleTasks.length > 1 ? 's' : ''} abandonnée${context.staleTasks.length > 1 ? 's' : ''} à trier`);
  }
  base.push("Quelles sont mes priorités aujourd'hui ?", "Montre-moi la roadmap du projet");

  if (context.todayTasks && context.todayTasks.filter((t: any) => !t.completed).length > 3) {
    base.unshift("Aide-moi à réduire ma liste de tâches");
  }

  if (context.activeProject) {
    base.push(`Génère des tâches pour ${context.activeProject.name}`);
  }

  return base.slice(0, 4);
}
