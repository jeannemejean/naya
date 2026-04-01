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
- set_energy: { type, level } — level: "high" | "medium" | "low" | "depleted"
- create_milestone_chain: { type, projectId, milestones: [{title, description?, milestoneType?, conditionType?}] }
- confirm_milestone: { type, milestoneId }
- show_project_roadmap: { type, projectId }

RÈGLES :
1. Réponds en français naturellement. Les actions sont discrètes — l'utilisateur les voit exécutées, pas le JSON brut.
2. Quand on décrit une séquence avec des dépendances ("j'ai besoin de X pour faire Y", "avant Z il faut A"), c'est une CHAÎNE DE JALONS. Résume-la sous forme numérotée, demande confirmation, puis génère create_milestone_chain.
3. Jamais de tâches pour un jalon bloqué (les jalons locked sont dans le contexte).
4. Pour les dates relatives ("demain", "lundi prochain"), utilise la date actuelle fournie dans le contexte.
5. Si tu crées plusieurs tâches, utilise create_task_list plutôt que plusieurs create_task.
6. Tu peux combiner réponse textuelle ET actions dans le même message.
`;

export type CompanionAction =
  | { type: "create_task"; title: string; scheduledDate?: string; projectId?: number | null }
  | { type: "create_task_list"; title: string; items: { title: string }[]; linkedDate?: string; linkedTaskId?: number }
  | { type: "create_note"; content: string; projectId?: number | null }
  | { type: "create_reminder"; title: string; datetime: string }
  | { type: "complete_task"; taskId: number }
  | { type: "reschedule_task"; taskId: number; newDate: string; newTime?: string }
  | { type: "set_energy"; level: "high" | "medium" | "low" | "depleted" }
  | { type: "create_milestone_chain"; projectId: number; milestones: any[] }
  | { type: "confirm_milestone"; milestoneId: number }
  | { type: "show_project_roadmap"; projectId: number };

export interface CompanionRequest {
  message: string;
  context: {
    currentDate: string;
    currentTime: string;
    platform: "web" | "mobile";
    upcomingEvents?: Array<{ title: string; date: string; time?: string; taskId: number }>;
    activeProject?: { id: number; name: string } | null;
    todayTasks?: any[];
    recentCaptures?: any[];
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

  if (context.todayTasks && context.todayTasks.length > 0) {
    const taskSummary = context.todayTasks
      .slice(0, 5)
      .map((t: any) => `- [${t.completed ? '✅' : '⬜'}] ${t.title}${t.scheduledTime ? ` à ${t.scheduledTime}` : ''}`)
      .join('\n');
    contextLines.push(`Tâches aujourd'hui :\n${taskSummary}`);
  }

  if (context.upcomingEvents && context.upcomingEvents.length > 0) {
    const events = context.upcomingEvents
      .slice(0, 3)
      .map(e => `- ${e.title} le ${e.date}${e.time ? ` à ${e.time}` : ''}`)
      .join('\n');
    contextLines.push(`Événements à venir :\n${events}`);
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
  const base = ["Quelles sont mes priorités aujourd'hui ?", "Montre-moi la roadmap du projet"];

  if (context.todayTasks && context.todayTasks.filter((t: any) => !t.completed).length > 3) {
    base.unshift("Aide-moi à réduire ma liste de tâches");
  }

  if (context.activeProject) {
    base.push(`Génère des tâches pour ${context.activeProject.name}`);
  }

  return base.slice(0, 4);
}
