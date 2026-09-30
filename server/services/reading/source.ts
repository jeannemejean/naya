import { serpSearch } from "../serp";
import type { CandidatBrut } from "./triage";

// Plafond dur, par utilisateur et par jour. Le coût SERP est négligeable (~0,0014 €/requête) :
// ce plafond borne le BRUIT et le temps d'exécution, pas la dépense.
export const MAX_REQUETES_SERP_PAR_JOUR = 24;

const UNITES: Array<[RegExp, number]> = [
  [/(\d+)\s*(minute|min)/i, 1 / (24 * 60)],
  // Le `s?` sur les formes longues gère le pluriel (« 3 heures », « 3 hours ») — sans lui,
  // le `\b` final ne matche jamais après un « s », et toute date en heures rend null : les
  // articles les plus frais de la journée seraient silencieusement écartés par l'étage 1.
  // Le `\b` reste nécessaire : sans lui, l'alternative `h` seule mordrait sur un mot comme
  // « 2 hommes ». Les deux protections sont donc requises ensemble, pas l'une sans l'autre.
  [/(\d+)\s*(heures?|hours?|hrs?|h)\b/i, 1 / 24],
  [/(\d+)\s*(jour|day)/i, 1],
  [/(\d+)\s*(semaine|week)/i, 7],
  [/(\d+)\s*(mois|month)/i, 30],
  [/(\d+)\s*(an|année|year)/i, 365],
];

/**
 * Google Actualités donne « il y a 2 jours », pas une date ISO. Sans cette lecture,
 * tous les candidats seraient sans date — donc tous écartés par l'étage 1.
 * Une date incomprise rend null : on préfère perdre un article que d'en dater un faux.
 */
export function parseDateRelative(raw: string | undefined, today: Date): Date | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) {
    const d = new Date(iso);
    return d.getTime() > today.getTime() ? null : d;
  }

  for (const [re, jours] of UNITES) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n)) return null;
      const d = new Date(today.getTime() - n * jours * 24 * 3600 * 1000);
      // Un nombre démesuré (ex. « il y a 999999999999999999999999999999 jours ») fait
      // déborder la multiplication vers ±Infinity : new Date(±Infinity) est une Invalid
      // Date — un objet TRUTHY dont getTime() vaut NaN. À l'étage 1 du tri, ni
      // `!publishedAt` ni `NaN < limite` ne l'écarteraient seuls : elle se comporterait
      // comme une date fraîche, l'inverse de la règle. On la traite comme incomprise.
      return Number.isFinite(d.getTime()) ? d : null;
    }
  }

  if (/aujourd'hui|today/i.test(s)) return new Date(today);
  if (/hier|yesterday/i.test(s)) return new Date(today.getTime() - 24 * 3600 * 1000);
  return null;
}

/**
 * Exécute les requêtes de veille et rend des candidats bruts, projet par projet.
 * Best-effort : une requête qui échoue est sautée, jamais propagée.
 */
export async function sourcerCandidats(input: {
  userId: string;
  today: Date;
  parProjet: Array<{ projectId: number; requetes: string[] }>;
}): Promise<CandidatBrut[]> {
  const out: CandidatBrut[] = [];

  // Aplati en une seule file (projet, requête) : si le plafond tombe en cours de route,
  // on sait exactement combien de requêtes et quels projets n'ont pas été servis —
  // une limite silencieuse se relirait plus tard comme « on a tout couvert ».
  const file: Array<{ projectId: number; requete: string }> = [];
  for (const { projectId, requetes } of input.parProjet) {
    for (const requete of requetes) file.push({ projectId, requete });
  }

  for (let i = 0; i < file.length; i++) {
    if (i >= MAX_REQUETES_SERP_PAR_JOUR) {
      const restantes = file.slice(i);
      const projetsRestants = Array.from(new Set(restantes.map((r) => r.projectId)));
      console.info(
        `[Lecture] plafond de ${MAX_REQUETES_SERP_PAR_JOUR} requêtes SERP atteint — sourcing interrompu : ` +
          `${restantes.length} requête(s) non exécutée(s), projet(s) concerné(s) [${projetsRestants.join(", ")}]`,
      );
      break;
    }

    const { projectId, requete } = file[i];
    try {
      // pays/langue épinglés : sans eux, Bright Data sort par un pays aléatoire
      // (Germany, Croatia, Peru… mesuré) et un appel sur trois ne rend RIEN.
      const res = await serpSearch(requete, input.userId, { vertical: "news", freshness: "week", pays: "fr", langue: "fr" });
      for (const r of res) {
        out.push({
          url: r.link,
          title: r.title,
          source: r.source ?? null,
          publishedAt: parseDateRelative(r.publishedAtRaw, input.today),
          projectId,
        });
      }
    } catch (err: any) {
      console.error(`[Lecture] requête « ${requete} » échouée:`, err?.message);
    }
  }
  return out;
}
