// server/services/rapports/rediger.ts — préparer le brouillon du rapport d'un mois pour un
// projet client. Les chiffres viennent du calcul (donnees.ts) ; l'IA n'écrit que les textes,
// au client, en le vouvoyant, au nom de l'agence. Un rapport publié n'est jamais réécrit.
import type { RapportClient } from "@shared/schema";
import type { ResultatPassage } from "../routines/types";
import { porteeDe } from "../connexions/portee";
import { libelleMois } from "../mesure/calculs";
import { euros } from "../mesure/bilan";
import { donneesRapport, type DonneesRapport, type EntreesRapport } from "./donnees";

export interface Sections { synthese: string; realise: string; resultats: string; prochainesEtapes: string }
export const CLES_SECTIONS: Array<keyof Sections> = ["synthese", "realise", "resultats", "prochainesEtapes"];
const MAX_SECTION = 2000;

export interface DepsRapport {
  getProject(id: number, userId: string): Promise<any>;
  getRapport(userId: string, projectId: number, mois: string): Promise<RapportClient | undefined>;
  lireEntrees(userId: string, projectId: number, mois: string): Promise<EntreesRapport>;
  nomAgence(userId: string): Promise<string>;
  garde(userId: string): Promise<ResultatPassage | null>;
  /** Appel IA en mode tiers (aucune note privée de l'utilisatrice). */
  ia(userId: string, projectId: number, prompt: string): Promise<string>;
  enregistrer(userId: string, projectId: number, mois: string, v: { donnees: DonneesRapport; sections: Sections }): Promise<RapportClient | undefined>;
}

export type ResultatPreparation =
  | { statut: "ok"; rapport: RapportClient }
  | { statut: "introuvable" | "projet_perso" | "deja_publie" | "rien" | "illisible" }
  | { statut: "refus"; raison: ResultatPassage };

/** Les quatre textes, ou null si la sortie est illisible ou incomplète. */
export function lireSections(brut: string): Sections | null {
  const m = brut.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const s = {} as Sections;
    for (const k of CLES_SECTIONS) {
      if (typeof o?.[k] !== "string" || !o[k].trim()) return null;
      s[k] = o[k].trim().slice(0, MAX_SECTION);
    }
    return s;
  } catch {
    return null;
  }
}

const pct = (x: number | null | undefined) => (x == null ? "" : ` (${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)} % sur le mois précédent)`);

/** Les données du mois en lignes lisibles pour la rédaction. */
export function lignesDonnees(d: DonneesRapport): string {
  const l: string[] = [];
  if (d.chiffres) {
    const i = d.chiffres.indicateurs, e = d.chiffres.evolutions;
    if (i.ca != null) l.push(`Chiffre d'affaires : ${euros(i.ca)}${pct(e.ca)}`);
    if (i.nouveaux_clients != null) l.push(`Nouveaux clients : ${i.nouveaux_clients}${pct(e.nouveaux_clients)}`);
    if (i.depense_totale != null) l.push(`Dépense marketing : ${euros(i.depense_totale)}${pct(e.depense_totale)}`);
    if (i.mer != null) l.push(`MER (CA ÷ dépense marketing) : ${i.mer.toFixed(1)}${pct(e.mer)}`);
    if (i.cac != null) l.push(`Coût d'un nouveau client : ${euros(i.cac)}${pct(e.cac)}`);
    if (i.panier_moyen != null) l.push(`Panier moyen : ${euros(i.panier_moyen)}${pct(e.panier_moyen)}`);
  }
  if (d.contenus) {
    l.push(`Contenus publiés : ${d.contenus.total} (${Object.entries(d.contenus.parPlateforme).map(([p, n]) => `${p} ${n}`).join(", ")})`);
    for (const c of d.contenus.meilleurs) l.push(`- Contenu qui a le mieux fonctionné : « ${c.titre} » (${c.plateforme}, ${c.date})`);
  }
  if (d.prospection) l.push(`Prospection : ${d.prospection.envoyes} messages envoyés dans le mois, ${d.prospection.reponses} prospects ont répondu`);
  if (d.veille) for (const v of d.veille) l.push(`- Fait marquant de la veille : ${v}`);
  return l.join("\n");
}

function consigne(client: string, agence: string, mois: string, d: DonneesRapport): string {
  return `Rédige le rapport mensuel de ${libelleMois(mois)} que l'agence « ${agence} » envoie à son client « ${client} ».

Données du mois (calculées, exactes) :
${lignesDonnees(d)}

Règles :
- Tu écris AU CLIENT, au nom de l'agence : vouvoie-le. Ton professionnel, chaleureux, sans jargon interne.
- Ne mentionne jamais Naya, ni d'outil, ni de note interne.
- Chaque chiffre cité vient des données ci-dessus. N'en invente aucun ; si une rubrique manque, n'en parle pas.
- Aucune promesse de résultat.

Réponds UNIQUEMENT en JSON, quatre textes courts (600 caractères au plus chacun) :
{"synthese": "l'essentiel du mois en deux ou trois phrases",
 "realise": "ce qui a été fait ce mois-ci",
 "resultats": "les résultats, chiffres à l'appui",
 "prochainesEtapes": "ce que nous ferons le mois prochain, et pourquoi"}`;
}

export async function preparerRapport(userId: string, projectId: number, mois: string, deps: DepsRapport): Promise<ResultatPreparation> {
  const projet = await deps.getProject(projectId, userId);
  if (!projet) return { statut: "introuvable" };
  if (porteeDe(projet) == null) return { statut: "projet_perso" };
  if ((await deps.getRapport(userId, projectId, mois))?.statut === "publie") return { statut: "deja_publie" };

  const donnees = donneesRapport(await deps.lireEntrees(userId, projectId, mois), mois);
  if (donnees.vide) return { statut: "rien" };

  const refus = await deps.garde(userId);
  if (refus) return { statut: "refus", raison: refus };

  const client = projet.clientName || projet.name;
  const sections = lireSections(await deps.ia(userId, projectId, consigne(client, await deps.nomAgence(userId), mois, donnees)));
  if (!sections) return { statut: "illisible" };
  const rapport = await deps.enregistrer(userId, projectId, mois, { donnees, sections });
  if (!rapport) return { statut: "deja_publie" };
  return { statut: "ok", rapport };
}
