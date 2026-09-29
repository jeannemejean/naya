import { canonicalizeUrl, hashUrl, normalizeTitle } from "./url";

// ── Constantes de politique. Aucune n'est un réglage utilisateur. ──────────────
export const FRAICHEUR_JOURS = 7;
export const SEUIL_RETENTION = 0.7;
export const MAX_FICHES = 3;
export const MAX_PAR_PROJET = 2;

// Agrégateurs et fermes de contenu : ils republient sans rien ajouter, et leurs URLs
// ne mènent pas à la source. Liste volontairement courte — à étendre sur constat, pas
// par précaution.
export const DOMAINES_EXCLUS = [
  "news.google.com",
  "msn.com",
  "flipboard.com",
  "medium.com",
  "pinterest.com",
  "quora.com",
];

export interface CandidatBrut {
  url: string;
  title: string;
  source?: string | null;
  publishedAt: Date | null;
  projectId: number;
}

export interface Candidat {
  url: string;          // URL canonique
  urlHash: string;
  title: string;
  source: string | null;
  publishedAt: Date;
  projectId: number;
}

/**
 * Étage 1 du tri : déterministe, pur, sans modèle. Il élimine ce qu'aucun jugement
 * ne rattraperait — le vieux, le déjà-vu, l'agrégateur, le doublon — AVANT de payer
 * le moindre appel. Un candidat sans date est écarté : une date inconnue n'est pas
 * une date fraîche, et une fiche sur un article de 2019 détruit la confiance.
 */
export function etage1(bruts: CandidatBrut[], opts: { today: Date; urlHashDejaVus: Set<string> }): Candidat[] {
  const limite = opts.today.getTime() - FRAICHEUR_JOURS * 24 * 3600 * 1000;
  const hashDuLot = new Set<string>();
  const titresDuLot = new Set<string>();
  const out: Candidat[] = [];

  for (const b of bruts) {
    if (!b.publishedAt || b.publishedAt.getTime() < limite) continue;

    const canonique = canonicalizeUrl(b.url);
    if (!canonique) continue;

    const hote = new URL(canonique).hostname;
    if (DOMAINES_EXCLUS.some((d) => hote === d || hote.endsWith(`.${d}`))) continue;

    const h = hashUrl(canonique);
    if (opts.urlHashDejaVus.has(h) || hashDuLot.has(h)) continue;

    const titre = normalizeTitle(b.title);
    // Un titre qui se normalise en chaîne vide est indiscernable d'un doublon,
    // mais c'est un candidat invalide : reading_cards.title est NOT NULL.
    if (!titre) continue;
    // Un titre déjà vu dans ce lot est un doublon : on garde le premier arrivé.
    if (titresDuLot.has(titre)) continue;

    hashDuLot.add(h);
    titresDuLot.add(titre);
    out.push({
      url: canonique,
      urlHash: h,
      title: b.title,
      source: b.source ?? null,
      publishedAt: b.publishedAt,
      projectId: b.projectId,
    });
  }

  return out;
}
