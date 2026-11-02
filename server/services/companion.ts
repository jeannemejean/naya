// Companion : ce qui reste de l'ancien module après le passage à l'agent omniscient
// (services/agent/). La conversation passe par la boucle d'outils (routes-agent.ts) ;
// l'ancien protocole texte <naya-actions> et processCompanionMessage sont retirés.
// Restent le contexte de session envoyé par les clients et les suggestions contextuelles.

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

export function buildSuggestions(context: Pick<CompanionRequest['context'], 'staleTasks' | 'todayTasks' | 'activeProject'>): string[] {
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
