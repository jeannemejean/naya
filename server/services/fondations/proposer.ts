/**
 * « Naya propose mes fondations » : offre d'entrée, motivations (avec leur ligne de matrice
 * créative), arbre de KPI et plan d'acquisition, dérivés de CE projet (jamais d'un playbook
 * commun). Tout arrive en `propose` ; une section validée n'est remplacée que si elle est
 * explicitement redemandée.
 */
import type { Fondations, InsertFondations, ProjectProof } from "@shared/schema";
import type { ResultatPassage } from "../routines/types";
import {
  SECTIONS, BRIQUES, FORMATS_CREATIFS, ETAGES_KPI, FREQUENCES_KPI, MATURITES, STATUTS_BRIQUE, PLAFONDS, type Section,
} from "./catalogues";
import { validerSection, lireProposition, statutsDe } from "./sections";

export interface DepsProposer {
  storage: {
    getProject(id: number, userId: string): Promise<any>;
    getFondations(userId: string, projectId: number): Promise<Fondations | undefined>;
    upsertFondations(userId: string, projectId: number, patch: Partial<InsertFondations>): Promise<Fondations>;
    getProjectProofs(userId: string, projectId: number, status?: string): Promise<ProjectProof[]>;
  };
  garde(userId: string): Promise<ResultatPassage | null>;
  /** Appel IA avec le contexte complet du projet. */
  ia(userId: string, projectId: number, prompt: string): Promise<string>;
}

export type ResultatProposition =
  | { statut: "ok"; fondations: Fondations }
  | { statut: "introuvable" }
  | { statut: "refus"; raison: string }
  | { statut: "rien" }
  | { statut: "vide" };

const FORMATS_JSON: Record<Section, string> = {
  offre: `"offre": { "nom": "...", "description": "ce que reçoit le client", "prix": "si pertinent", "pourquoi": "pourquoi un inconnu passe à l'achat avec un risque perçu faible", "existe": true si elle est déjà dans l'offre actuelle, sinon false }`,
  motivations: `"motivations": [{ "nom": "raison d'acheter, en 2 à 4 mots", "description": "...", "angle": "l'angle créatif en une phrase", "accroches": ["les premières secondes / la première ligne"], "preuves": ["preuves réelles uniquement"], "objections": ["ce qui retient d'acheter"], "formats": [${FORMATS_CREATIFS.map((f) => `"${f}"`).join(", ")}] }]`,
  kpis: `"kpis": [{ "nom": "...", "etage": ${ETAGES_KPI.map((e) => `"${e}"`).join(" | ")}, "definition": "comment le calculer", "frequence": ${FREQUENCES_KPI.map((e) => `"${e}"`).join(" | ")}, "cible": "si une cible chiffrée est connue" }]`,
  plan: `"plan": { "maturite": ${MATURITES.map((m) => `"${m}"`).join(" | ")}, "resume": "2 phrases", "briques": [{ "cle": "...", "statut": ${STATUTS_BRIQUE.map((s) => `"${s}"`).join(" | ")}, "raison": "pourquoi pour CE business", "action": "première action concrète si maintenant" }] }`,
};

function consigne(sections: Section[], valides: string, preuves: string): string {
  return `Pose les fondations d'acquisition de ce projet, comme une stratège qui connaît ce business (dossier « Acquisition 360 », étape 0).

Sections à produire : ${sections.join(", ")}.
${valides ? `\nDéjà validé par l'utilisatrice (à respecter, ne pas refaire) :\n${valides}\n` : ""}${preuves ? `\nPreuves réelles du projet (les seules que tu peux citer) :\n${preuves}\n` : ""}
Réponds en JSON strict, sans commentaire, avec seulement les sections demandées :
{
${sections.map((s) => `  ${FORMATS_JSON[s]}`).join(",\n")}
}

Règles :
- Sur-mesure : déduis tout de CE projet. Une artiste, un consultant, une boutique n'ont pas les mêmes leviers. Pas de MER ni de SEA plaqués sur un business qui n'a pas de budget publicitaire.
- Offre d'entrée : elle n'a pas à être rentable seule, elle recrute des clients qui reviendront (coffret découverte, essai, diagnostic offert, petit format…).
- Motivations : 3 à ${PLAFONDS.motivations} raisons d'acheter distinctes (pas des tranches d'âge). Au plus ${PLAFONDS.liste} accroches, preuves et objections, ${PLAFONDS.formats} formats.
- KPI : au plus ${PLAFONDS.kpis}, répartis par étage (business = ce que regarde la dirigeante chaque mois ; système ; canal ; créa), seulement ceux qu'elle peut réellement mesurer.
- Plan : une entrée pour chaque brique de cette liste, avec son statut :
${BRIQUES.map((b) => `  - ${b.cle} : ${b.libelle}`).join("\n")}
- N'invente ni chiffre, ni preuve, ni client. Écris dans la langue du projet.`;
}

function resumeValide(f: Fondations | undefined, statuts: Record<Section, string>): string {
  if (!f) return "";
  return SECTIONS.filter((s) => statuts[s] === "valide" && (f as any)[s])
    .map((s) => `- ${s} : ${JSON.stringify((f as any)[s]).slice(0, 1500)}`).join("\n");
}

function lignePreuve(p: ProjectProof): string {
  const qui = p.citable ? p.clientLabel : "un client";
  return `- ${qui} : ${p.whatWasDone}${p.result ? ` → ${p.result}` : ""}`;
}

export async function proposerFondations(
  userId: string, projectId: number, demandees: Section[] | undefined, deps: DepsProposer,
): Promise<ResultatProposition> {
  const projet = await deps.storage.getProject(projectId, userId);
  if (!projet) return { statut: "introuvable" };
  const existant = await deps.storage.getFondations(userId, projectId);
  const statuts = statutsDe(existant);
  const sections = demandees?.length
    ? SECTIONS.filter((s) => demandees.includes(s))
    : SECTIONS.filter((s) => statuts[s] !== "valide");
  if (!sections.length) return { statut: "rien" };

  const refus = await deps.garde(userId);
  if (refus) return { statut: "refus", raison: refus.resume };

  const preuves = (await deps.storage.getProjectProofs(userId, projectId, "validated")).slice(0, 15).map(lignePreuve).join("\n");
  const brut = lireProposition(await deps.ia(userId, projectId, consigne(sections, resumeValide(existant, statuts), preuves)));

  const patch: Partial<InsertFondations> = {};
  const nouveaux = { ...statuts };
  for (const s of sections) {
    const v = validerSection(s, brut[s]);
    if (!v.ok) continue;
    (patch as any)[s] = v.valeur;
    nouveaux[s] = "propose";
  }
  if (!Object.keys(patch).length) return { statut: "vide" };
  const fondations = await deps.storage.upsertFondations(userId, projectId, { ...patch, statuts: nouveaux });
  return { statut: "ok", fondations };
}
