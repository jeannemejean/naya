// Registre des outils de l'agent omniscient : la table UNIQUE, testée, qui classe chaque outil
// en lecture / direct / à valider (spec §5 et §6.3). La boucle (boucle.ts) ne connaît que ce
// registre : ajouter un outil = l'ajouter ici, sans toucher la boucle.
import type Anthropic from "@anthropic-ai/sdk";
import type { ActionFaite, ClasseOutil, PropositionVue } from "@shared/agent";
import { OUTILS_LECTURE } from "./outils/lecture";
import { OUTILS_DIRECTS } from "./outils/directs";
import { OUTILS_A_VALIDER } from "./outils/a-valider";
import { OUTILS_FIL } from "../fil/etapes";

// Ce que l'outil reçoit du serveur. L'utilisatrice vient TOUJOURS de la session
// (req.userId) : jamais d'un argument fourni par le modèle.
export interface ContexteOutil {
  userId: string;
  maintenant: Date;
  fuseau: string;
}

// Ce que rend un outil : ce que le modèle lit, et ce que la réponse montre à l'utilisatrice
// (une recherche faite, une action faite, une proposition à valider).
export type ResultatOutil = {
  pourModele: unknown;
  recherche?: string;
  faite?: ActionFaite;
  proposition?: PropositionVue;
};

export interface Outil {
  nom: string;
  classe: ClasseOutil;
  description: string;
  schema: Anthropic.Tool["input_schema"];
  executer(ctx: ContexteOutil, args: any): Promise<ResultatOutil>;
}

// Table de vérité de la spec §5 : les seuls gestes que l'agent peut faire sans demander.
// Tout autre outil d'action est « à valider ».
export const DIRECTS_AUTORISES: ReadonlySet<string> = new Set([
  "creer_tache", "creer_rappel", "creer_note", "creer_liste",
  "cocher_tache", "decocher_tache", "deplacer_tache",
  "ranger_information", "regler_energie",
]);

// OUTILS_FIL : propositions du fil conducteur (étapes d'un objectif, rattachement d'une chaîne),
// valables 7 jours et refusées hors interrupteur.
export const REGISTRE: Outil[] = [...OUTILS_LECTURE, ...OUTILS_DIRECTS, ...OUTILS_A_VALIDER, ...OUTILS_FIL];

export function outil(nom: string): Outil | undefined {
  return REGISTRE.find((o) => o.nom === nom);
}

// Les outils au format de l'API Claude.
export function outilsPourClaude(registre: Outil[] = REGISTRE): Anthropic.Tool[] {
  return registre.map((o) => ({ name: o.nom, description: o.description, input_schema: o.schema }));
}

// ── Validation des arguments ───────────────────────────────────────────────────────────
// Le modèle peut se tromper d'arguments : on vérifie le schéma (champs requis, types, listes
// de valeurs) avant d'exécuter. Rend null si c'est bon, sinon la raison, renvoyée au modèle.
// Volontairement réduit au sous-ensemble de JSON Schema qu'emploient nos outils.

function verifierValeur(chemin: string, schema: any, valeur: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  const type = schema.type;
  if (type === "string" && typeof valeur !== "string") return `${chemin} doit être un texte`;
  if (type === "integer" && !(typeof valeur === "number" && Number.isInteger(valeur))) return `${chemin} doit être un entier`;
  if (type === "number" && !(typeof valeur === "number" && Number.isFinite(valeur))) return `${chemin} doit être un nombre`;
  if (type === "boolean" && typeof valeur !== "boolean") return `${chemin} doit être vrai ou faux`;
  if (type === "array") {
    if (!Array.isArray(valeur)) return `${chemin} doit être une liste`;
    for (let i = 0; i < valeur.length; i++) {
      const e = verifierValeur(`${chemin}[${i}]`, schema.items, valeur[i]);
      if (e) return e;
    }
  }
  if (type === "object") {
    const e = verifierObjet(chemin, schema, valeur);
    if (e) return e;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(valeur)) {
    return `${chemin} doit valoir l'une de : ${schema.enum.join(", ")}`;
  }
  return null;
}

function verifierObjet(chemin: string, schema: any, valeur: unknown): string | null {
  if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return `${chemin || "les arguments"} doivent être un objet`;
  const obj = valeur as Record<string, unknown>;
  for (const requis of schema.required ?? []) {
    if (obj[requis] === undefined || obj[requis] === null) return `${chemin ? `${chemin}.` : ""}${requis} est requis`;
  }
  for (const [cle, sous] of Object.entries(schema.properties ?? {})) {
    if (obj[cle] === undefined || obj[cle] === null) continue;
    const e = verifierValeur(chemin ? `${chemin}.${cle}` : cle, sous, obj[cle]);
    if (e) return e;
  }
  return null;
}

export function validerArgs(schema: Anthropic.Tool["input_schema"], args: unknown): string | null {
  return verifierObjet("", schema, args);
}
