// server/services/rapports/donnees.ts — les chiffres d'un rapport client, pour un mois. PUR,
// sans IA : ils sont figés à la préparation et c'est d'eux seuls que la rédaction parle. Une
// rubrique sans donnée est absente (null), jamais remplie de zéros.
import { indicateurs, evolutions, type Indicateurs, type LigneMesure } from "../mesure/calculs";
import { plateformeDe } from "@shared/programmation";
import { wallClockToInstant } from "../../utils/timezone";

/** Début et fin (exclue) d'un mois à Paris, en instants : les lectures se bornent à ce mois-là. */
export function bornesMois(mois: string): { debut: Date; fin: Date } {
  const [a, m] = mois.split("-").map(Number);
  const suivant = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return {
    debut: wallClockToInstant("Europe/Paris", `${mois}-01`, "00:00"),
    fin: wallClockToInstant("Europe/Paris", `${suivant}-01`, "00:00"),
  };
}

/** Jour (YYYY-MM-DD) d'un instant, à Paris. */
export function jourDe(instant: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(instant));
}

/** Mois (YYYY-MM) d'un instant, à Paris : un post du 1er à 0 h 30 compte pour le 1er. */
export function moisDe(instant: Date | string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(new Date(instant));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

/** Les seuls indicateurs qui sortent vers le client (jamais la marge ni les coûts variables). */
export const SUIVIS = ["ca", "nouveaux_clients", "depense_totale", "mer", "cac", "panier_moyen"] as const;
type Suivi = (typeof SUIVIS)[number];

export interface EntreesRapport {
  mesures: LigneMesure[];
  contenus: Array<{ id: number; title: string; platform: string; publishedAt: Date | string | null }>;
  scores: Array<{ contentId: number; score: number }>;
  messages: Array<{ leadId?: number | null; sentAt: Date | string | null; responseReceived?: boolean | null; responseDate?: Date | string | null }>;
  constats: Array<{ titre: string; createdAt: Date | string | null; statut?: string | null }>;
}

export interface DonneesRapport {
  mois: string;
  chiffres: { indicateurs: Record<Suivi, number | null>; evolutions: Partial<Record<Suivi, number | null>> } | null;
  contenus: { total: number; parPlateforme: Record<string, number>; meilleurs: Array<{ titre: string; plateforme: string; date: string }> } | null;
  prospection: { envoyes: number; reponses: number } | null;
  veille: string[] | null;
  vide: boolean;
}

export function donneesRapport(e: EntreesRapport, mois: string): DonneesRapport {
  const ligne = e.mesures.find((l) => l.mois === mois);
  let chiffres: DonneesRapport["chiffres"] = null;
  if (ligne) {
    const evo: Record<string, number | null> = {};
    for (const k of SUIVIS) evo[k] = evolutions(e.mesures.map((l) => ({ mois: l.mois, valeur: indicateurs(l)[k] })), mois).precedent;
    const tous: Indicateurs = indicateurs(ligne);
    const montres = {} as Record<Suivi, number | null>;
    for (const k of SUIVIS) montres[k] = tous[k];
    chiffres = { indicateurs: montres, evolutions: evo };
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
      .map((c) => ({ titre: c.title, plateforme: plateformeDe(c.platform), date: jourDe(c.publishedAt!) }));
    contenus = { total: publies.length, parPlateforme, meilleurs };
  }

  // Activité DU MOIS seulement : messages envoyés, et prospects distincts qui ont répondu.
  const envoyes = e.messages.filter((m) => m.sentAt && moisDe(m.sentAt) === mois).length;
  const reponses = new Set(e.messages
    .filter((m) => m.responseReceived && m.responseDate && moisDe(m.responseDate) === mois)
    .map((m) => m.leadId ?? m)).size;
  const prospection = envoyes || reponses ? { envoyes, reponses } : null;

  const titres = e.constats
    .filter((c) => c.createdAt && moisDe(c.createdAt) === mois && c.statut !== "ecarte")
    .slice(0, 5)
    .map((c) => c.titre);
  const veille = titres.length ? titres : null;

  return { mois, chiffres, contenus, prospection, veille, vide: !chiffres && !contenus && !prospection && !veille };
}
