// server/services/rapports/donnees.ts — les chiffres d'un rapport client, pour un mois. PUR,
// sans IA : ils sont figés à la préparation et c'est d'eux seuls que la rédaction parle. Une
// rubrique sans donnée est absente (null), jamais remplie de zéros.
import { indicateurs, evolutions, type Indicateurs, type LigneMesure } from "../mesure/calculs";
import { plateformeDe } from "@shared/programmation";

/** Mois (YYYY-MM) d'un instant, à Paris : un post du 1er à 0 h 30 compte pour le 1er. */
export function moisDe(instant: Date | string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(new Date(instant));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

const SUIVIS = ["ca", "nouveaux_clients", "depense_totale", "mer", "cac", "panier_moyen"] as const;
const EN_DISCUSSION = new Set(["in_discussion", "proposal_sent", "signed"]);

export interface EntreesRapport {
  mesures: LigneMesure[];
  contenus: Array<{ id: number; title: string; platform: string; publishedAt: Date | string | null }>;
  scores: Array<{ contentId: number; score: number }>;
  messages: Array<{ sentAt: Date | string | null }>;
  leads: Array<{ stage?: string | null }>;
  constats: Array<{ titre: string; createdAt: Date | string | null; statut?: string | null }>;
}

export interface DonneesRapport {
  mois: string;
  chiffres: { indicateurs: Indicateurs; evolutions: Partial<Record<(typeof SUIVIS)[number], number | null>> } | null;
  contenus: { total: number; parPlateforme: Record<string, number>; meilleurs: Array<{ titre: string; plateforme: string; date: string; score: number }> } | null;
  prospection: { envoyes: number; enDiscussion: number } | null;
  veille: string[] | null;
  vide: boolean;
}

export function donneesRapport(e: EntreesRapport, mois: string): DonneesRapport {
  const ligne = e.mesures.find((l) => l.mois === mois);
  let chiffres: DonneesRapport["chiffres"] = null;
  if (ligne) {
    const evo: Record<string, number | null> = {};
    for (const k of SUIVIS) evo[k] = evolutions(e.mesures.map((l) => ({ mois: l.mois, valeur: indicateurs(l)[k] })), mois).precedent;
    chiffres = { indicateurs: indicateurs(ligne), evolutions: evo };
  }

  const publies = e.contenus.filter((c) => c.publishedAt && moisDe(c.publishedAt) === mois);
  let contenus: DonneesRapport["contenus"] = null;
  if (publies.length) {
    const parPlateforme: Record<string, number> = {};
    for (const c of publies) { const p = plateformeDe(c.platform); parPlateforme[p] = (parPlateforme[p] ?? 0) + 1; }
    const score = new Map(e.scores.map((s) => [s.contentId, s.score]));
    const meilleurs = publies
      .filter((c) => score.has(c.id))
      .sort((a, b) => score.get(b.id)! - score.get(a.id)!)
      .slice(0, 3)
      .map((c) => ({ titre: c.title, plateforme: plateformeDe(c.platform), date: new Date(c.publishedAt!).toISOString().slice(0, 10), score: score.get(c.id)! }));
    contenus = { total: publies.length, parPlateforme, meilleurs };
  }

  const envoyes = e.messages.filter((m) => m.sentAt && moisDe(m.sentAt) === mois).length;
  const enDiscussion = e.leads.filter((l) => EN_DISCUSSION.has(l.stage ?? "")).length;
  const prospection = envoyes || enDiscussion ? { envoyes, enDiscussion } : null;

  const titres = e.constats
    .filter((c) => c.createdAt && moisDe(c.createdAt) === mois && c.statut !== "ecarte")
    .slice(0, 5)
    .map((c) => c.titre);
  const veille = titres.length ? titres : null;

  return { mois, chiffres, contenus, prospection, veille, vide: !chiffres && !contenus && !prospection && !veille };
}
