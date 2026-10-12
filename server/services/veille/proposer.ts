/**
 * « Naya propose ma liste » : la marque, ses concurrents, les recherches « voix du client »,
 * les mots-clés et les questions à poser aux IA, dérivés du projet de l'utilisatrice (jamais
 * d'un playbook commun). Ancrée sur de vrais résultats Google quand Bright Data est branché.
 * Tout arrive en `propose` : rien n'est relevé tant que l'utilisatrice n'a pas choisi.
 */
import type { VeilleItem, InsertVeilleItem } from "@shared/schema";
import type { SerpOptions, SerpResult } from "../serp";
import type { ResultatPassage } from "../routines/types";
import { lireProposition, fusionnerPropositions, PLAFONDS } from "./items";
import { PAYS_DEFAUT, LANGUE_DEFAUT } from "./types";

export interface DepsProposer {
  storage: {
    getProject(id: number, userId: string): Promise<any>;
    getVeilleItems(userId: string, projectId: number): Promise<VeilleItem[]>;
    createVeilleItems(rows: InsertVeilleItem[]): Promise<VeilleItem[]>;
  };
  garde(userId: string): Promise<ResultatPassage | null>;
  serpConfigure(): boolean;
  chercher(userId: string, requete: string, opts: SerpOptions): Promise<SerpResult[]>;
  /** Appel IA avec le contexte complet du projet. */
  ia(userId: string, projectId: number, prompt: string): Promise<string>;
}

export type ResultatProposition =
  | { statut: "ok"; crees: VeilleItem[] }
  | { statut: "introuvable" }
  | { statut: "refus"; raison: string }
  | { statut: "vide" };

function consigne(ancrage: string): string {
  return `Prépare la liste de veille de ce projet, comme le ferait une stratège d'acquisition.

${ancrage ? `Résultats Google réels (pour t'ancrer, ne cite pas de concurrent que tu ne connais pas vraiment) :\n${ancrage}\n\n` : ""}Réponds en JSON strict, sans commentaire :
{
  "marque": { "nom": "nom de la marque du projet", "site": "domaine si tu le connais, sinon omets", "variantes": ["autres façons de l'écrire"] },
  "concurrents": [{ "nom": "...", "site": "domaine si connu", "instagram": "compte si connu" }],
  "requetes_voc": ["requêtes Google pour trouver ce que disent les clients de ce marché : site:reddit.com …, site:trustpilot.com …, forums, avis"],
  "mots_cles": ["ce qu'un client tape dans Google pour trouver ce genre d'offre"],
  "prompts_geo": ["questions qu'un client poserait à ChatGPT pour choisir, SANS nommer la marque"]
}

Règles :
- Au plus ${PLAFONDS.concurrent} concurrents, ${PLAFONDS.requete_voc} requêtes voix du client, ${Math.min(10, PLAFONDS.mot_cle)} mots-clés, ${PLAFONDS.prompt_geo} questions.
- Concurrents réels et directs (même offre, même clientèle), pas des géants hors de portée. Aucun site ni compte inventé : omets le champ si tu n'es pas sûre.
- Requêtes et questions dans la langue des clients du projet, précises (le problème, la catégorie, le lieu s'il compte).`;
}

export async function proposerListe(userId: string, projectId: number, deps: DepsProposer): Promise<ResultatProposition> {
  const projet = await deps.storage.getProject(projectId, userId);
  if (!projet) return { statut: "introuvable" };
  const refus = await deps.garde(userId);
  if (refus) return { statut: "refus", raison: refus.resume };

  // Ancrage : deux recherches réelles (le nom du projet, sa catégorie). Une panne n'empêche rien.
  const lignes: string[] = [];
  if (deps.serpConfigure()) {
    const requetes = [`"${projet.name}"`, projet.category ? `${projet.category} marques` : null].filter(Boolean) as string[];
    for (const q of requetes) {
      try {
        const res = await deps.chercher(userId, q, { pays: PAYS_DEFAUT, langue: LANGUE_DEFAUT });
        for (const r of res.slice(0, 8)) lignes.push(`- ${r.title} — ${r.link}`);
      } catch (e: any) {
        console.warn(`[veille] ancrage de la proposition : ${e?.message || e}`);
      }
    }
  }

  const proposition = lireProposition(await deps.ia(userId, projectId, consigne(lignes.join("\n"))));
  const existants = await deps.storage.getVeilleItems(userId, projectId);
  const rows = fusionnerPropositions(existants, proposition);
  const rien = !proposition.marque && [proposition.concurrents, proposition.requetes_voc, proposition.mots_cles, proposition.prompts_geo].every((x) => x.length === 0);
  if (rien) return { statut: "vide" };
  const crees = await deps.storage.createVeilleItems(rows.map((r) => ({ ...r, userId, projectId })) as InsertVeilleItem[]);
  return { statut: "ok", crees };
}
