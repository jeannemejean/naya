// La boucle d'outils de l'agent omniscient : un message de l'utilisatrice → appels Claude
// successifs, chaque outil demandé est exécuté côté serveur et son résultat renvoyé au modèle,
// jusqu'à la réponse finale. Bornée : MAX_APPELS_OUTILS outils par message, MAX_TOURS appels
// Claude au total. Un outil inconnu, mal appelé ou en panne rend {erreur} au modèle : jamais
// une 500.
import type Anthropic from "@anthropic-ai/sdk";
import type { ActionFaite, PropositionVue, ReponseAgent } from "@shared/agent";
import { appelerClaudeAvecOutils } from "../claude";
import { construireConsignes } from "./consignes";
import { REGISTRE, outilsPourClaude, validerArgs, type ContexteOutil, type Outil } from "./registre";

export const MAX_APPELS_OUTILS = 8;
// Garde-fou de la boucle elle-même : 8 tours d'outils, le tour qui touche la limite, puis le
// dernier appel sans outils. Au-delà, on coupe même si le modèle insiste.
export const MAX_TOURS = MAX_APPELS_OUTILS + 2;
const HISTORIQUE_MAX = 10;
const REPONSE_VIDE = "Je n'ai pas réussi à formuler de réponse. Tu peux reformuler ?";

// Les données rendues au modèle sont entourées de <donnees source="…">…</donnees>. Toute balise
// `donnees` présente DANS la donnée est neutralisée, pour qu'un texte (réponse de prospect,
// note…) ne puisse pas refermer l'enveloppe et se faire passer pour une consigne.
export function envelopper(source: string, donnee: unknown): string {
  const brut = typeof donnee === "string" ? donnee : JSON.stringify(donnee ?? null);
  const neutralise = brut.replace(/<(\s*\/?\s*)donnees/gi, "&lt;$1donnees");
  const nom = source.replace(/[^a-zA-Z0-9_]/g, "_");
  return `<donnees source="${nom}">${neutralise}</donnees>`;
}

export interface OptionsAgent {
  userId: string;
  message: string;
  historique: { role: "user" | "assistant"; content: string }[];
  contexteSession: string;
  projetActifId?: number;
  fuseau?: string;
}

export interface DepsAgent {
  appeler?: typeof appelerClaudeAvecOutils;
  registre?: Outil[];
  maintenant?: () => Date;
}

// L'historique envoyé au modèle : les derniers échanges, qui commencent par un message de
// l'utilisatrice (exigence de l'API), puis le message du jour.
function construireMessages(historique: OptionsAgent["historique"], message: string): Anthropic.MessageParam[] {
  const recents = historique
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-HISTORIQUE_MAX);
  while (recents.length > 0 && recents[0].role !== "user") recents.shift();
  return [...recents.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: message }];
}

function texteDe(reponse: Anthropic.Message): string {
  return reponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function executerAgent(opts: OptionsAgent, deps: DepsAgent = {}): Promise<ReponseAgent> {
  const appeler = deps.appeler ?? appelerClaudeAvecOutils;
  const registre = deps.registre ?? REGISTRE;
  const ctx: ContexteOutil = {
    userId: opts.userId,
    maintenant: deps.maintenant?.() ?? new Date(),
    fuseau: opts.fuseau ?? "Europe/Paris",
  };

  const system = await construireConsignes(opts.userId, opts.projetActifId, opts.message, opts.contexteSession);
  const tools = outilsPourClaude(registre);
  const messages = construireMessages(opts.historique, opts.message);

  const faites: ActionFaite[] = [];
  const propositions: PropositionVue[] = [];
  const recherches: string[] = [];
  let appelsOutils = 0;
  let sansOutils = false; // dernier appel : les outils restent déclarés mais ne peuvent plus servir

  for (let tour = 1; ; tour++) {
    const reponse = await appeler({
      userId: opts.userId,
      projectId: opts.projetActifId,
      system,
      messages: [...messages], // instantané : la boucle continue d'ajouter à `messages`
      tools,
      ...(sansOutils ? { tool_choice: { type: "none" as const } } : {}),
    });
    messages.push({ role: "assistant", content: reponse.content });

    const demandes = reponse.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (reponse.stop_reason !== "tool_use" || demandes.length === 0 || sansOutils) {
      return { message: texteDe(reponse) || REPONSE_VIDE, faites, propositions, recherches, actions: [] };
    }

    // Tous les résultats d'une réponse repartent dans UN SEUL message (outils en parallèle).
    const resultats: Anthropic.ToolResultBlockParam[] = [];
    let limiteAtteinte = false;
    for (const demande of demandes) {
      if (appelsOutils >= MAX_APPELS_OUTILS) {
        limiteAtteinte = true;
        resultats.push({ type: "tool_result", tool_use_id: demande.id, content: envelopper(demande.name, { erreur: "limite_atteinte" }), is_error: true });
        continue;
      }
      appelsOutils++;
      const { pourModele, erreur } = await executerOutil(registre, ctx, demande, { faites, propositions, recherches });
      resultats.push({
        type: "tool_result",
        tool_use_id: demande.id,
        content: envelopper(demande.name, pourModele),
        ...(erreur ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: resultats });

    // Limite d'outils atteinte, ou boucle trop longue : le prochain appel est le dernier.
    if (limiteAtteinte || tour + 1 >= MAX_TOURS) sansOutils = true;
  }
}

async function executerOutil(
  registre: Outil[],
  ctx: ContexteOutil,
  demande: Anthropic.ToolUseBlock,
  collecte: { faites: ActionFaite[]; propositions: PropositionVue[]; recherches: string[] },
): Promise<{ pourModele: unknown; erreur: boolean }> {
  const o = registre.find((x) => x.nom === demande.name);
  if (!o) return { pourModele: { erreur: "outil_inconnu", outil: demande.name }, erreur: true };
  const invalide = validerArgs(o.schema, demande.input);
  if (invalide) return { pourModele: { erreur: "arguments_invalides", detail: invalide }, erreur: true };
  try {
    const r = await o.executer(ctx, demande.input);
    if (r.recherche) collecte.recherches.push(r.recherche);
    if (r.faite) collecte.faites.push(r.faite);
    if (r.proposition) collecte.propositions.push(r.proposition);
    return { pourModele: r.pourModele, erreur: false };
  } catch (e: any) {
    console.error(`[agent] l'outil ${o.nom} a échoué :`, e?.message ?? e);
    return { pourModele: { erreur: "echec_outil", outil: o.nom }, erreur: true };
  }
}
