// Types partagés entre le serveur et le client pour l'agent omniscient.
export type ClasseOutil = "lecture" | "direct" | "a_valider";
export interface ActionFaite { actionId: number; resume: string; annulableJusqua: string /* ISO */ }
export interface Changement { libelle: string; avant: string | null; apres: string | null }
export interface PropositionVue { id: number; resume: string; changements: Changement[]; expireA: string /* ISO */ }
export interface ReponseAgent {
  message: string;
  faites: ActionFaite[];
  propositions: PropositionVue[];
  recherches: string[];
  suggestions?: string[];
  actions?: [];
}
