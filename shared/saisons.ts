// Source unique des saisons : palettes, bornes, motifs, photos. Module pur (ni I/O ni DOM),
// partagé par le serveur (préférence) et le client (rendu) pour qu'ils ne divergent jamais.

export type Saison = "automne" | "hiver" | "printemps" | "ete";

export interface Apparence {
  saison: "auto" | Saison;
  decor: boolean;
}

export const APPARENCE_DEFAUT: Apparence = { saison: "auto", decor: true };

export interface PaletteSaison {
  fond: string;
  touche1: string;
  touche2: string;
  /** Valeur CSS `background` (motif posé sur la carte). */
  motif: string;
  libelle: string;
}

// Couleurs communes à toutes les saisons : le texte reste lisible quelle que soit la palette.
export const COULEURS = {
  encre: "#2F2A22",
  secondaire: "#5E5546",
  ancre: "#2E2A24",
  surAncre: "#F6EFE3",
  carte: "#FFFBF3",
} as const;

// Motifs : touche1 à ~22 % d'opacité sur la carte, comme dans la maquette validée.
// rgba littéral plutôt qu'un calcul : la valeur reste lisible et copiable dans le CSS.
const LIGNE = (rgb: string) => `rgba(${rgb}, 0.22)`;

export const PALETTES: Record<Saison, PaletteSaison> = {
  automne: {
    fond: "#F3EADB", touche1: "#C07A47", touche2: "#D9B98A", libelle: "Automne",
    // carreaux : deux bandes croisées (8px / 10px)
    motif: `repeating-linear-gradient(0deg, transparent 0 8px, ${LIGNE("192, 122, 71")} 8px 10px), `
      + `repeating-linear-gradient(90deg, transparent 0 8px, ${LIGNE("192, 122, 71")} 8px 10px), ${COULEURS.carte}`,
  },
  hiver: {
    fond: "#F1EEE8", touche1: "#5F7189", touche2: "#C9D3DF", libelle: "Hiver",
    // vichy : bandes croisées (9px / 18px)
    motif: `repeating-linear-gradient(0deg, transparent 0 9px, ${LIGNE("95, 113, 137")} 9px 18px), `
      + `repeating-linear-gradient(90deg, transparent 0 9px, ${LIGNE("95, 113, 137")} 9px 18px), ${COULEURS.carte}`,
  },
  printemps: {
    fond: "#F6F0E1", touche1: "#EBD58A", touche2: "#A9B79A", libelle: "Printemps",
    // fine rayure verticale (6px / 9px)
    motif: `repeating-linear-gradient(90deg, transparent 0 6px, ${LIGNE("235, 213, 138")} 6px 9px), ${COULEURS.carte}`,
  },
  ete: {
    fond: "#F7F1E6", touche1: "#7F9CB8", touche2: "#E6D3B3", libelle: "Été",
    // large rayure verticale (12px / 24px)
    motif: `repeating-linear-gradient(90deg, transparent 0 12px, ${LIGNE("127, 156, 184")} 12px 24px), ${COULEURS.carte}`,
  },
};

const FUSEAU_DEFAUT = "Europe/Paris";

// Date locale du fuseau (pas celle de l'instant UTC) : à 00:30 à Paris le 21 déc., c'est déjà l'hiver.
function dateLocale(maintenant: Date, fuseau: string): { annee: number; mois: number; jour: number } {
  const lire = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(maintenant);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { annee: n("year"), mois: n("month"), jour: n("day") };
  };
  try {
    return lire(fuseau);
  } catch {
    // Fuseau inconnu (RangeError) : on ne casse pas l'affichage pour une préférence mal saisie.
    return lire(FUSEAU_DEFAUT);
  }
}

export function saisonDuJour(maintenant: Date, fuseau: string): Saison {
  const { mois, jour } = dateLocale(maintenant, fuseau);
  const md = mois * 100 + jour;
  if (md >= 320 && md <= 620) return "printemps";
  if (md >= 621 && md <= 920) return "ete";
  if (md >= 921 && md <= 1220) return "automne";
  return "hiver"; // 21 déc. → 19 mars
}

export function saisonEffective(apparence: Apparence, maintenant: Date, fuseau: string): Saison {
  return apparence.saison === "auto" ? saisonDuJour(maintenant, fuseau) : apparence.saison;
}

const SAISONS: readonly string[] = ["automne", "hiver", "printemps", "ete"];

// Tolérant : la valeur vient de la base ou du réseau, on ne fait confiance qu'aux champs valides.
export function normaliserApparence(v: unknown): Apparence {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ...APPARENCE_DEFAUT };
  const o = v as Record<string, unknown>;
  const saison = o.saison === "auto" || (typeof o.saison === "string" && SAISONS.includes(o.saison))
    ? (o.saison as Apparence["saison"])
    : APPARENCE_DEFAUT.saison;
  const decor = typeof o.decor === "boolean" ? o.decor : APPARENCE_DEFAUT.decor;
  return { saison, decor };
}

// Chemins publics `/saisons/<saison>/<n>.webp` ; vides tant que les photos ne sont pas livrées.
export const PHOTOS_SAISON: Record<Saison, string[]> = {
  automne: [],
  hiver: [],
  printemps: [],
  ete: [],
};

// Une photo par jour, stable sur la journée locale, qui tourne sur l'année.
export function photoDuJour(saison: Saison, maintenant: Date, fuseau: string): string | null {
  const photos = PHOTOS_SAISON[saison];
  if (photos.length === 0) return null;
  const { annee, mois, jour } = dateLocale(maintenant, fuseau);
  const jourDeLAnnee = Math.round((Date.UTC(annee, mois - 1, jour) - Date.UTC(annee, 0, 1)) / 86_400_000);
  return photos[jourDeLAnnee % photos.length];
}

// WCAG 2.1 : luminance relative puis (L1 + 0,05) / (L2 + 0,05), hex `#RRGGBB`.
function luminance(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

export function rapportContraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (sombre + 0.05);
}
