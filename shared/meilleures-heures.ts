// Meilleures heures pour publier (lot 7, inspiré de Metricool) : une grille jour × heure par
// réseau, en heure de Paris, notée de 0 (personne) à 1 (le meilleur créneau de la semaine).
//
// Deux sources, et l'écran dit toujours laquelle :
//  - « générique » : le consensus d'études publiques (ci-dessous). Naya n'a pas de données
//    d'activité de l'audience (la permission « insights » d'Instagram n'est pas accordée, voir
//    server/services/reception/sources/instagram.ts) ;
//  - « vos données » : l'engagement mesuré des posts publiés de la marque (content_reception,
//    saisi à la main ou importé en CSV), par jour et heure de publication. Il ne compte qu'à
//    partir de SEUIL_POSTS posts mesurés pour ce réseau, et repondère la grille générique
//    (qui reste telle quelle aux créneaux où la marque n'a jamais publié).
//
// Convention : matrice[jour][heure], jour 0 = lundi … 6 = dimanche (ISO), heure 0 … 23 locale.
// PUR : aucune horloge implicite, aucun accès base.
import { instantLocal } from "./autolistes";

export const FUSEAU_MEILLEURES_HEURES = "Europe/Paris";
export const RESEAUX_MEILLEURES_HEURES = ["instagram", "linkedin", "facebook", "tiktok"] as const;
export type ReseauMeilleuresHeures = (typeof RESEAUX_MEILLEURES_HEURES)[number];
export type Matrice = number[][];
export type SourceMeilleuresHeures = "generique" | "mixte" | "donnees";

/** Moins de posts mesurés : la grille reste générique. */
export const SEUIL_POSTS = 15;
/** À partir d'ici, les données de la marque pèsent plus que les études. */
export const SEUIL_DONNEES = 60;
const POIDS_MIXTE = 0.5;
const POIDS_DONNEES = 0.8;

// ── Grilles génériques ───────────────────────────────────────────────────────────────────
//
// Sources (consensus, heure locale de l'audience, ici Paris) :
//  - Sprout Social, « Best Times to Post on Social Media » (éditions 2024 et 2025, 2 milliards
//    d'engagements sur 400 000 profils) ;
//  - Hootsuite, « The best time to post on social media » (2024) ;
//  - Later, « Best Time to Post on Instagram / TikTok » (2024, 11 millions de posts) ;
//  - Buffer, « The Best Time to Post on Social Media » (2024, 1 million de posts LinkedIn).
// Ce qu'elles disent en commun :
//  - LinkedIn : jours de semaine, 8 h – 10 h et la pause de midi ; mardi à jeudi en tête ;
//    le week-end presque vide.
//  - Instagram : en semaine, 11 h – 13 h et 18 h – 21 h ; mercredi en tête ; week-end plus bas
//    et plus tardif (fin de matinée).
//  - Facebook : 9 h – 13 h en semaine (pic vers 13 h), regain en début de soirée ; week-end bas.
//  - TikTok : l'après-midi et le soir (17 h – 22 h), jeudi et vendredi un peu devant ; le
//    week-end reste actif.
// Ce sont des tendances moyennes, pas une mesure de l'audience de la marque : l'écran les
// étiquette « générique ».

type Profil = number[]; // 24 valeurs

/** Profil horaire à partir de quelques points (heure → note) ; ailleurs, `nuit`. */
function profil(points: Record<number, number>, nuit = 0.05): Profil {
  return Array.from({ length: 24 }, (_, h) => points[h] ?? nuit);
}

interface Generique { semaine: Profil; weekend: Profil; jours: [number, number, number, number, number, number, number] }

const GENERIQUES: Record<ReseauMeilleuresHeures, Generique> = {
  linkedin: {
    semaine: profil({ 6: 0.15, 7: 0.45, 8: 0.9, 9: 1, 10: 0.9, 11: 0.7, 12: 0.85, 13: 0.65, 14: 0.55, 15: 0.5, 16: 0.45, 17: 0.5, 18: 0.35, 19: 0.25, 20: 0.2, 21: 0.15, 22: 0.1 }),
    weekend: profil({ 8: 0.2, 9: 0.3, 10: 0.35, 11: 0.35, 12: 0.3, 13: 0.25, 14: 0.2, 15: 0.2, 16: 0.2, 17: 0.2, 18: 0.15, 19: 0.15, 20: 0.15 }),
    jours: [0.85, 1, 1, 0.95, 0.75, 0.3, 0.3],
  },
  instagram: {
    semaine: profil({ 6: 0.2, 7: 0.4, 8: 0.5, 9: 0.55, 10: 0.65, 11: 0.9, 12: 1, 13: 0.9, 14: 0.6, 15: 0.55, 16: 0.6, 17: 0.7, 18: 0.9, 19: 1, 20: 0.95, 21: 0.85, 22: 0.55, 23: 0.3 }, 0.1),
    weekend: profil({ 8: 0.3, 9: 0.5, 10: 0.75, 11: 0.9, 12: 0.9, 13: 0.8, 14: 0.6, 15: 0.55, 16: 0.55, 17: 0.6, 18: 0.7, 19: 0.8, 20: 0.8, 21: 0.7, 22: 0.45, 23: 0.25 }, 0.1),
    jours: [0.9, 0.95, 1, 0.95, 0.85, 0.7, 0.7],
  },
  facebook: {
    semaine: profil({ 7: 0.4, 8: 0.6, 9: 0.85, 10: 0.9, 11: 0.85, 12: 0.9, 13: 1, 14: 0.8, 15: 0.7, 16: 0.6, 17: 0.55, 18: 0.6, 19: 0.7, 20: 0.65, 21: 0.5, 22: 0.3 }),
    weekend: profil({ 8: 0.35, 9: 0.5, 10: 0.65, 11: 0.7, 12: 0.7, 13: 0.65, 14: 0.55, 15: 0.5, 16: 0.5, 17: 0.5, 18: 0.55, 19: 0.6, 20: 0.55, 21: 0.4, 22: 0.25 }),
    jours: [0.9, 0.95, 1, 0.95, 0.85, 0.6, 0.6],
  },
  tiktok: {
    semaine: profil({ 7: 0.35, 8: 0.4, 9: 0.4, 10: 0.45, 11: 0.5, 12: 0.6, 13: 0.55, 14: 0.6, 15: 0.65, 16: 0.7, 17: 0.8, 18: 0.9, 19: 1, 20: 1, 21: 0.95, 22: 0.8, 23: 0.5 }, 0.15),
    weekend: profil({ 9: 0.4, 10: 0.5, 11: 0.6, 12: 0.65, 13: 0.65, 14: 0.65, 15: 0.7, 16: 0.75, 17: 0.8, 18: 0.85, 19: 0.95, 20: 0.95, 21: 0.9, 22: 0.75, 23: 0.5 }, 0.15),
    jours: [0.85, 0.95, 0.95, 1, 1, 0.85, 0.85],
  },
};

/** « Instagram », « instagram » → « instagram » ; un réseau inconnu → null. */
export function reseauMeilleuresHeures(v: unknown): ReseauMeilleuresHeures | null {
  const r = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (RESEAUX_MEILLEURES_HEURES as readonly string[]).includes(r) ? (r as ReseauMeilleuresHeures) : null;
}

/** Ramène toutes les notes entre 0 et 1 (le meilleur créneau vaut 1). Une grille vide reste à 0. */
export function normaliser(m: Matrice): Matrice {
  const max = Math.max(0, ...m.flat().filter(Number.isFinite));
  return m.map((ligne) => ligne.map((v) => (max > 0 && Number.isFinite(v) && v > 0 ? Math.round((v / max) * 1000) / 1000 : 0)));
}

/**
 * La grille générique d'un réseau, normalisée. Un réseau sans étude (ni l'un des quatre) prend
 * la moyenne des quatre.
 */
export function matriceGenerique(reseau: string | null | undefined): Matrice {
  const r = reseauMeilleuresHeures(reseau);
  const de = (g: Generique): Matrice => g.jours.map((k, j) => (j >= 5 ? g.weekend : g.semaine).map((v) => v * k));
  if (r) return normaliser(de(GENERIQUES[r]));
  const toutes = RESEAUX_MEILLEURES_HEURES.map((x) => de(GENERIQUES[x]));
  return normaliser(toutes[0].map((ligne, j) => ligne.map((_, h) => toutes.reduce((s, m) => s + m[j][h], 0) / toutes.length)));
}

// ── Données de la marque ─────────────────────────────────────────────────────────────────

export interface MesurePost {
  publieLe: Date | string;
  saves?: number | null;
  shares?: number | null;
  comments?: number | null;
  reach?: number | null;
}

/**
 * Taux d'engagement d'un post : (enregistrements + partages + commentaires) / portée. Sans
 * portée, pas de taux (null) : deux comptes de tailles différentes ne se comparent qu'en taux.
 */
export function engagementDuPost(m: MesurePost): number | null {
  const reach = Number(m.reach);
  if (!Number.isFinite(reach) || reach <= 0) return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return (n(m.saves) + n(m.shares) + n(m.comments)) / reach;
}

const formatsJourHeure = new Map<string, Intl.DateTimeFormat>();
/** Jour ISO (0 = lundi) et heure locale d'un instant dans un fuseau. */
export function jourHeureLocal(instant: Date, fuseau = FUSEAU_MEILLEURES_HEURES): { jour: number; heure: number; date: string } {
  let f = formatsJourHeure.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" });
    formatsJourHeure.set(fuseau, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const jour = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return { jour, heure: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
}

/**
 * Engagement moyen par (jour, heure de publication). Cellule sans post : null. `n` = posts
 * retenus (publiés, avec une portée).
 */
export function matriceDonnees(mesures: MesurePost[], fuseau = FUSEAU_MEILLEURES_HEURES): { moyennes: Array<Array<number | null>>; n: number } {
  const somme = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const nombre = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let n = 0;
  for (const m of mesures) {
    const e = engagementDuPost(m);
    const d = new Date(m.publieLe);
    if (e === null || isNaN(d.getTime())) continue;
    const { jour, heure } = jourHeureLocal(d, fuseau);
    if (jour < 0) continue;
    somme[jour][heure] += e;
    nombre[jour][heure] += 1;
    n++;
  }
  return { moyennes: somme.map((l, j) => l.map((s, h) => (nombre[j][h] ? s / nombre[j][h] : null))), n };
}

/** Le poids des données de la marque selon le nombre de posts mesurés, et la source affichée. */
export function poidsDonnees(n: number): { poids: number; source: SourceMeilleuresHeures } {
  if (n < SEUIL_POSTS) return { poids: 0, source: "generique" };
  if (n < SEUIL_DONNEES) return { poids: POIDS_MIXTE, source: "mixte" };
  return { poids: POIDS_DONNEES, source: "donnees" };
}

/**
 * La grille affichée : la générique, repondérée par les données de la marque au-delà du seuil.
 * Pour chaque cellule où la marque a publié, r = engagement moyen de la cellule / engagement
 * moyen de la marque (1 = dans sa moyenne, plafonné à 3) ; une cellule sans post garde r = 1
 * (aucune preuve, on suit les études). Note = générique × (1 + poids × (r − 1)).
 * Pourquoi relatif : 15 posts tous publiés le mardi à 16 h ne disent pas que 16 h bat 9 h ; ils
 * ne disent quelque chose qu'en comparant des créneaux de la marque entre eux.
 */
export function melanger(generique: Matrice, donnees: { moyennes: Array<Array<number | null>>; n: number }): { matrice: Matrice; source: SourceMeilleuresHeures; n: number } {
  const { poids, source } = poidsDonnees(donnees.n);
  if (poids === 0) return { matrice: normaliser(generique), source, n: donnees.n };
  const valeurs = donnees.moyennes.flat().filter((v): v is number => v !== null);
  const moyenne = valeurs.length ? valeurs.reduce((a, b) => a + b, 0) / valeurs.length : 0;
  const matrice = generique.map((ligne, j) => ligne.map((g, h) => {
    const v = donnees.moyennes[j]?.[h];
    if (v === null || v === undefined || moyenne <= 0) return g;
    const r = Math.min(3, v / moyenne);
    return g * (1 + poids * (r - 1));
  }));
  return { matrice: normaliser(matrice), source, n: donnees.n };
}

/** Toute la chaîne : générique du réseau + mesures de la marque. */
export function meilleuresHeures(reseau: string, mesures: MesurePost[], fuseau = FUSEAU_MEILLEURES_HEURES) {
  return melanger(matriceGenerique(reseau), matriceDonnees(mesures, fuseau));
}

// ── Créneaux ─────────────────────────────────────────────────────────────────────────────

export interface Creneau { instant: Date; jour: number; heure: number; score: number }

/**
 * Les `n` meilleurs créneaux (à l'heure pile) des `jours` prochains jours, un seul par jour,
 * au moins `margeMinutes` après `maintenant`. Heure de Paris, heure d'été comprise : une heure
 * qui n'existe pas ce jour-là (02:00 le jour du passage à l'heure d'été) n'est jamais proposée.
 * À note égale, le plus proche d'abord.
 */
export function meilleursCreneaux(
  matrice: Matrice,
  maintenant: Date,
  { n = 3, jours = 7, margeMinutes = 30, fuseau = FUSEAU_MEILLEURES_HEURES }: { n?: number; jours?: number; margeMinutes?: number; fuseau?: string } = {},
): Creneau[] {
  const debut = jourHeureLocal(maintenant, fuseau).date;
  const [y, m, d] = debut.split("-").map(Number);
  const limite = maintenant.getTime() + margeMinutes * 60_000;
  const candidats: Creneau[] = [];
  for (let k = 0; k < jours; k++) {
    const jour = new Date(Date.UTC(y, m - 1, d + k));
    for (let h = 0; h < 24; h++) {
      const instant = instantLocal(jour.getUTCFullYear(), jour.getUTCMonth() + 1, jour.getUTCDate(), h, 0, fuseau);
      const lu = jourHeureLocal(instant, fuseau);
      // Heure sautée (passage à l'heure d'été) : l'instant retombe sur une autre heure.
      if (lu.heure !== h || lu.date !== jour.toISOString().slice(0, 10)) continue;
      if (instant.getTime() < limite) continue;
      candidats.push({ instant, jour: lu.jour, heure: h, score: matrice[lu.jour]?.[h] ?? 0 });
    }
  }
  candidats.sort((a, b) => b.score - a.score || a.instant.getTime() - b.instant.getTime());
  const pris: Creneau[] = [];
  const joursPris = new Set<string>();
  for (const c of candidats) {
    if (pris.length >= n) break;
    const cle = jourHeureLocal(c.instant, fuseau).date;
    if (joursPris.has(cle)) continue;
    joursPris.add(cle);
    pris.push(c);
  }
  return pris.sort((a, b) => a.instant.getTime() - b.instant.getTime());
}

/**
 * Les meilleures heures d'un jour (0 = lundi) dans la plage de travail [debut, fin[ (heures
 * entières), de la meilleure à la moins bonne, espacées d'au moins `ecart` heures. Sert au
 * placement automatique des posts : le k-ième post du jour prend la k-ième heure (en boucle).
 * Plage vide : [debut].
 */
export function heuresDuJour(matrice: Matrice, jour: number, { debut = 9, fin = 18, ecart = 2 }: { debut?: number; fin?: number; ecart?: number } = {}): number[] {
  const plage: number[] = [];
  for (let h = Math.max(0, debut); h < Math.min(24, fin); h++) plage.push(h);
  if (plage.length === 0) return [Math.min(23, Math.max(0, debut))];
  const triees = [...plage].sort((a, b) => (matrice[jour]?.[b] ?? 0) - (matrice[jour]?.[a] ?? 0) || a - b);
  const choisies: number[] = [];
  for (const h of triees) if (choisies.every((c) => Math.abs(c - h) >= ecart)) choisies.push(h);
  return choisies;
}
