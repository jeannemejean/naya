/**
 * « Revenez vers moi en septembre » : lit, dans le texte NOUVEAU d'une réponse de prospect, une
 * demande d'être recontacté plus tard, et la résout en une date concrète (AAAA-MM-JJ) dans le
 * fuseau de l'utilisatrice, sur un de ses jours travaillés.
 *
 * Déterministe, sans IA (le tri des réponses à l'ingestion n'en utilise pas : on ne crée pas
 * d'appel pour ça). Deux conditions, sur la même phrase (ou la voisine) :
 *  1. une INTENTION de reprise (« revenez vers moi », « on se reparle », « pas avant »,
 *     « get back to me », « circle back »…) ;
 *  2. une EXPRESSION DE TEMPS lisible (« début 2027 », « en septembre », « dans 3 mois »,
 *     « après les fêtes », « à la rentrée », « le 15 janvier », « Q1 », « next year »…).
 *
 * Dans le doute, rien : expression vague (« dans quelques mois », « avant septembre »), deux
 * dates différentes, date passée, au-delà de 3 ans, ou mois en cours déjà entamé (« en
 * novembre » dit le 9 novembre) → null. Ce n'est qu'une proposition : mieux vaut se taire que
 * proposer une mauvaise date. Pure.
 */

export interface OptionsRelance {
  /** Instant de la réponse du prospect : les expressions relatives partent de là. */
  reference: Date;
  /** Fuseau IANA de l'utilisatrice. */
  fuseau: string;
  /** Jours travaillés (« mon », « tue »… comme parseWorkDays). */
  joursTravail: Set<string>;
}

export interface RelanceDetectee {
  /** Date de relance (AAAA-MM-JJ), jour travaillé, strictement après la réponse. */
  date: string;
  /** La phrase du prospect qui demande la reprise (pour la citer dans la relance). */
  extrait: string;
}

type Ymd = { y: number; m: number; d: number };
type Lecture = Ymd | "ambigu";
type Position = "debut" | "mi" | "fin" | null;

const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Au-delà de 3 ans, ce n'est plus une relance. */
export const HORIZON_JOURS = 3 * 366;

// ─── Calendrier (dates civiles, calculées en UTC pour éviter tout décalage) ─────────

const versDate = (x: Ymd) => new Date(Date.UTC(x.y, x.m, x.d));
const depuisDate = (d: Date): Ymd => ({ y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() });
const iso = (x: Ymd) => versDate(x).toISOString().slice(0, 10);
const plusJours = (x: Ymd, n: number) => depuisDate(new Date(Date.UTC(x.y, x.m, x.d + n)));
function plusMois(x: Ymd, n: number): Ymd {
  const cible = new Date(Date.UTC(x.y, x.m + n, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: cible.getUTCFullYear(), m: cible.getUTCMonth(), d: Math.min(x.d, dernier) };
}
const avant = (a: Ymd, b: Ymd) => versDate(a).getTime() < versDate(b).getTime();

/** Jour civil d'un instant dans un fuseau (repli UTC si le fuseau est invalide). */
export function jourDans(instant: Date, fuseau: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(instant);
  }
}
function ymdDe(isoJour: string): Ymd {
  const [y, m, d] = isoJour.split("-").map(Number);
  return { y, m: m - 1, d };
}

/** Jours fériés partout : jamais une relance le 1er janvier ni le 25 décembre. */
const ferie = (x: Ymd) => (x.m === 0 && x.d === 1) || (x.m === 11 && x.d === 25);

/** Premier jour travaillé à partir de `x` (inclus), ou null sans jour travaillé. */
export function premierJourTravaille(x: Ymd | string, joursTravail: Set<string>): string | null {
  let j = typeof x === "string" ? ymdDe(x) : x;
  for (let i = 0; i < 14; i++) {
    if (joursTravail.has(JOURS[versDate(j).getUTCDay()]) && !ferie(j)) return iso(j);
    j = plusJours(j, 1);
  }
  return null;
}

/** Jour `jour` du mois `mois`, à sa prochaine occurrence après `ref` ; mois en cours déjà passé → ambigu. */
function prochainMois(ref: Ymd, mois: number, jour: number, an: number | null): Lecture | null {
  if (an != null) return { y: an, m: mois, d: jour };
  if (mois > ref.m) return { y: ref.y, m: mois, d: jour };
  if (mois < ref.m) return { y: ref.y + 1, m: mois, d: jour };
  return jour > ref.d ? { y: ref.y, m: mois, d: jour } : "ambigu";
}

const JOUR_DE_POSITION: Record<string, number> = { debut: 1, mi: 15, fin: 20 };
const MOIS_DE_POSITION_ANNEE: Record<string, number> = { debut: 0, mi: 6, fin: 11 };

function position(mot: string | undefined): Position {
  if (!mot) return null;
  if (/^(debut|early|beginning|the beginning|courant)/.test(mot)) return "debut";
  if (/^(mi|milieu|mid|the middle|middle)/.test(mot)) return "mi";
  if (/^(fin|late|end|the end)/.test(mot)) return "fin";
  return null;
}

// ─── Vocabulaire (texte normalisé : minuscules, sans accents, apostrophes droites) ──

export function normaliser(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’‘`]/g, "'").replace(/[  ]/g, " ");
}

const NOMS_MOIS: Array<[string, number]> = [
  ["janvier", 0], ["january", 0], ["janv", 0], ["jan", 0],
  ["fevrier", 1], ["february", 1], ["fevr", 1], ["fev", 1], ["feb", 1],
  ["mars", 2], ["march", 2],
  ["avril", 3], ["april", 3], ["avr", 3], ["apr", 3],
  ["mai", 4], ["may", 4],
  ["juin", 5], ["june", 5], ["jun", 5],
  ["juillet", 6], ["july", 6], ["juil", 6], ["jul", 6],
  ["aout", 7], ["august", 7], ["aug", 7],
  ["septembre", 8], ["september", 8], ["sept", 8], ["sep", 8],
  ["octobre", 9], ["october", 9], ["oct", 9],
  ["novembre", 10], ["november", 10], ["nov", 10],
  ["decembre", 11], ["december", 11], ["dec", 11],
];
const MOIS = `(${NOMS_MOIS.map(([n]) => n).sort((a, b) => b.length - a.length).join("|")})\\.?`;
const moisDe = (mot: string) => NOMS_MOIS.find(([n]) => n === mot.replace(/\.$/, ""))?.[1] ?? null;
/** « sept mois », « mai » verbe… : un mois suivi d'une unité de durée n'est pas un mois. */
const PAS_UNE_DUREE = "(?!\\s+(?:mois|semaines?|jours?|ans|annees?|months?|weeks?|days?|years?)\\b)";

const QUALIF = "(debut|mi|milieu|fin|courant|early|mid|late|end of|beginning of|the beginning of|the end of|the middle of|middle of)";

const NOMBRES: Record<string, number> = {
  un: 1, une: 1, a: 1, an: 1, one: 1, deux: 2, two: 2, "a couple of": 2, "couple of": 2, trois: 3, three: 3,
  quatre: 4, four: 4, cinq: 5, five: 5, six: 6, sept: 7, seven: 7, huit: 8, eight: 8, neuf: 9, nine: 9,
  dix: 10, ten: 10, onze: 11, eleven: 11, douze: 12, twelve: 12, quinze: 15, fifteen: 15, dix_huit: 18, eighteen: 18,
};
const VAGUES = /^(quelques|plusieurs|a few|few|several|some|certains)$/;

/** Intention de reprise (texte normalisé). */
const INTENTION = new RegExp([
  // FR
  "\\brevenez\\b", "\\breviens\\b", "\\brevenir\\b", "recontact", "re-contact", "reprendre contact", "reprenez contact",
  "reprends contact", "\\brelanc", "\\brappel(?:ez|er|le|lons)\\b", "\\breparl", "\\breecri", "\\bfaire (?:un )?point",
  "refaire (?:un )?point", "pas avant", "pas le (?:bon )?moment", "trop tot", "\\bplutot\\b", "d'ici la\\b",
  "a ce moment-?la", "\\bon verra\\b", "\\breessay", "\\bretent", "en reparler", "reprendre (?:la |cette )?discussion",
  "\\breporter\\b", "\\brepousser\\b", "\\bse parler\\b", "on se (?:parle|redit|recontacte|rappelle|tient au courant)",
  "\\bechanger (?:a|de) nouveau", "\\bre-?echanger",
  // EN
  "get back", "reach out", "circle back", "follow up", "follow-up", "touch base", "\\breconnect", "ping me",
  "check back", "check in", "talk (?:again|then|later)", "speak (?:again|then|later)", "\\brevisit",
  "not (?:the right|a good) time", "not now", "not before", "not until", "come back", "try (?:me|us|again)",
  "reach back", "connect (?:again|later)", "let'?s talk", "hold off", "contact (?:me|us) (?:again|later|in|after|around|early|next)",
].join("|"));

/** Mots qui, juste avant un mois ou une année, en font un repère de reprise. */
const CONTEXTE = /(?:^|[\s,(])(en|in|pour|for|from|des|des le|after|apres|vers|around|by|plutot|rather|d'ici|partir de|partir d'|mois de|mois d'|courant|starting|until|till|avant|before|au|a)\s*$/;
const AVANT_SEUL = /(?:^|[\s,(])(avant|before|until|till)\s*$/;
const AVANT_NIE = /(?:pas|not|plus|jamais)\s+(?:avant|before|until|till)\s*$/;

/**
 * Lecture du contexte qui précède un mois ou une année : repère valable, « avant » seul
 * (ambigu : « avant septembre » ne dit pas quand), ou rien.
 */
function contexteAvant(texte: string, index: number): "ok" | "ambigu" | null {
  const avantTexte = texte.slice(Math.max(0, index - 30), index);
  if (AVANT_SEUL.test(avantTexte) && !AVANT_NIE.test(avantTexte)) return "ambigu";
  return CONTEXTE.test(avantTexte) ? "ok" : null;
}

/** « après le 15 janvier », « after the 15th » juste avant une date précise. */
const APRES_LE = /(?:^|\s)(?:apres|after)\s+(?:le\s+|the\s+)?$/;
/** Le passage est en anglais (mots anglais, aucun mot français courant). */
function texteAnglais(t: string): boolean {
  return /\b(the|you|me|us|please|after|around|back|out|at|let'?s|would|could|will|reach|get)\b/.test(t)
    && !/\b(le|la|les|vous|moi|nous|apres|vers|dans|je|on|de|du|des|en|au|pas)\b/.test(t);
}

interface Trouvaille { debut: number; fin: number; lecture: Lecture }

/** Toutes les expressions de temps d'un passage (normalisé), sans recouvrement. */
function expressions(t: string, ref: Ymd): Trouvaille[] {
  const out: Trouvaille[] = [];
  const libre = (a: number, b: number) => !out.some((x) => a < x.fin && b > x.debut);
  const ajoute = (re: RegExp, lire: (m: RegExpExecArray) => Lecture | null) => {
    for (const m of Array.from(t.matchAll(re)) as RegExpExecArray[]) {
      const a = m.index!, b = a + m[0].length;
      if (!libre(a, b)) continue;
      const l = lire(m);
      if (l) out.push({ debut: a, fin: b, lecture: l });
    }
  };
  const an = (s?: string) => (s ? Number(s) : null);

  // 1. Dates précises : « le 15 janvier (2027) », « January 15th(, 2027) », « 15th of January », « 15/01(/2027) ».
  const jourPrecis = (jour: number, mois: number | null, annee: number | null, index: number): Lecture | null => {
    if (mois == null || mois < 0 || mois > 11 || jour < 1 || jour > 31) return null;
    const x = { y: annee ?? ref.y, m: mois, d: jour };
    if (depuisDate(versDate(x)).d !== jour) return null;
    const date = annee != null || avant(ref, x) ? x : { ...x, y: ref.y + 1 };
    // « après le 15 janvier » : à partir du lendemain.
    return APRES_LE.test(t.slice(Math.max(0, index - 20), index)) ? plusJours(date, 1) : date;
  };
  ajoute(new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)?\\s+(?:of\\s+)?${MOIS}(?:\\s+(20\\d{2}))?\\b`, "g"),
    (m) => jourPrecis(Number(m[1]), moisDe(m[2]), an(m[3]), m.index!));
  ajoute(new RegExp(`\\b${MOIS}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d{2}))?`, "g"),
    (m) => jourPrecis(Number(m[2]), moisDe(m[1]), an(m[3]), m.index!));
  // Numérique « 15/02 » : ordre français jour/mois, et SEULEMENT quand il est sûr — jamais une
  // fraction de durée (« dans 2/3 semaines »), jamais un texte anglais (« after 1/15 » est
  // mois/jour), jamais deux nombres ≤ 12 (« 05/02 » : 5 février ou 2 mai ?).
  ajoute(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?(?![\d/])/g, (m) => {
    const apres = t.slice(m.index! + m[0].length);
    if (/^\s*(?:jours?|semaines?|mois|ans?|annees?|days?|weeks?|months?|years?)\b/.test(apres)) return "ambigu";
    if (texteAnglais(t)) return "ambigu";
    const a = Number(m[1]), b = Number(m[2]);
    if (a <= 12 && b <= 12) return "ambigu";
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return jourPrecis(a, b - 1, y, m.index!);
  });

  // 2. Durées : « dans 3 mois », « d'ici six semaines », « in two weeks », « within a year ».
  const nombres = Object.keys(NOMBRES).map((k) => k.replace("_", "-")).sort((a, b) => b.length - a.length).join("|");
  ajoute(new RegExp(`\\b(?:dans|d'ici|sous|in|within)\\s+(?:(\\d{1,3})|(${nombres}|quelques|plusieurs|a few|few|several|some))\\s+(jours?|semaines?|mois|ans?|annees?|days?|weeks?|months?|years?)(?:'? time)?\\b`, "g"),
    (m) => {
      const mot = m[2];
      if (mot && VAGUES.test(mot)) return "ambigu";
      const n = m[1] ? Number(m[1]) : NOMBRES[(mot ?? "").replace("-", "_")];
      if (!n) return null;
      const u = m[3];
      if (/^(jour|day)/.test(u)) return plusJours(ref, n);
      if (/^(semaine|week)/.test(u)) return plusJours(ref, 7 * n);
      if (/^(mois|month)/.test(u)) return plusMois(ref, n);
      return plusMois(ref, 12 * n);
    });

  // 3. « l'année prochaine », « début de l'année prochaine », « early next year ».
  ajoute(new RegExp(`(?:${QUALIF}[\\s-]+(?:de\\s+|d')?)?(?:l'annee prochaine|annee prochaine|l'an prochain|next year|the following year)`, "g"),
    (m) => ({ y: ref.y + 1, m: MOIS_DE_POSITION_ANNEE[position(m[1]) ?? "debut"], d: 1 }));
  // « début d'année », « fin de l'année », « end of the year » (sans année : la prochaine occurrence).
  ajoute(new RegExp(`${QUALIF}[\\s-]+(?:d'annee|de l'annee|of the year|of year|the year|year)\\b(?!\\s+(?:20\\d{2}|prochaine))`, "g"),
    (m) => prochainMois(ref, MOIS_DE_POSITION_ANNEE[position(m[1]) ?? "debut"], 1, null));
  ajoute(/\b(?:la semaine prochaine|next week)\b/g, () => plusJours(ref, ((8 - versDate(ref).getUTCDay()) % 7) || 7));
  ajoute(/\b(?:le mois prochain|next month)\b/g, () => ({ ...plusMois({ ...ref, d: 1 }, 1), d: 1 }));

  // 4. Trimestres : « T1 2027 », « Q2 », « premier trimestre », « next quarter ».
  const trimestre = (q: number, annee: number | null): Lecture => {
    const x = { y: annee ?? ref.y, m: (q - 1) * 3, d: 1 };
    if (annee != null || avant(ref, x)) return x;
    // « Q4 » dit en plein quatrième trimestre : celui-ci (déjà entamé) ou l'an prochain ?
    if (Math.floor(ref.m / 3) === q - 1) return "ambigu";
    return { ...x, y: ref.y + 1 };
  };
  ajoute(/\b(?:le |au )?(?:trimestre prochain|prochain trimestre|next quarter)\b/g,
    () => trimestre(((Math.floor(ref.m / 3) + 1) % 4) + 1, Math.floor(ref.m / 3) === 3 ? ref.y + 1 : ref.y));
  ajoute(/\b[tq]([1-4])\b(?:\s+(20\d{2}))?/g, (m) => trimestre(Number(m[1]), an(m[2])));
  ajoute(/\b(premier|1er|deuxieme|2e|second|troisieme|3e|quatrieme|4e|dernier|first|third|fourth|last)\s+(?:trimestre|quarter)\b(?:\s+(?:de\s+|of\s+)?(20\d{2}))?/g, (m) => {
    const q = /^(premier|1er|first)/.test(m[1]) ? 1 : /^(deuxieme|2e|second)/.test(m[1]) ? 2 : /^(troisieme|3e|third)/.test(m[1]) ? 3 : 4;
    return trimestre(q, an(m[2]));
  });

  // 5. Périodes de l'année.
  const periode = (mois: number, jour = 1): Lecture | null => prochainMois(ref, mois, jour, null);
  ajoute(/\b(?:apres|after)\s+(?:les fetes|noel|le nouvel an|the holidays|christmas|new year'?s?|the new year|les vacances de noel|les vacances de fin d'annee)\b|\b(?:in|into) the new year\b|\bau nouvel an\b/g,
    () => periode(0, 1));
  ajoute(/\b(?:a la |la |de la |apres la |des la )?rentree\b|\b(?:apres|after)\s+(?:l'ete|the summer|summer|les vacances d'ete|les grandes vacances)\b|\bfin de l'ete\b|\bend of (?:the )?summer\b/g,
    () => periode(8, 1));
  ajoute(/\b(?:apres|after)\s+(?:les vacances|the holidays|vacation|the break)\b|\bau retour des vacances\b/g, () => {
    if (ref.m >= 4 && ref.m <= 7) return periode(8, 1);
    return "ambigu";
  });
  // Préfixe obligatoire : « a été » (participe) n'est jamais une saison.
  ajoute(/(?:\b(?:au|ce|cet|en|in|in the|this|next|le)\s+|\bl')(printemps|spring|ete|summer|automne|fall|autumn)(?: prochain)?\b/g, (m) => {
    const mot = m[1];
    const mois = /printemps|spring/.test(mot) ? 3 : /ete|summer/.test(mot) ? 6 : 9;
    return periode(mois, 1);
  });

  // 6. Mois : « en septembre », « début septembre », « mi-janvier 2027 », « septembre prochain », « late March ».
  ajoute(new RegExp(`(?:${QUALIF}[\\s-]+(?:de\\s+|d'|of\\s+)?)?\\b${MOIS}${PAS_UNE_DUREE}(?:\\s+(prochain|next|20\\d{2}))?\\b`, "g"), (m) => {
    const mois = moisDe(m[2]);
    if (mois == null) return null;
    const pos = position(m[1]);
    const suffixe = m[3];
    if (!pos && !suffixe) {
      const c = contexteAvant(t, m.index!);
      if (c !== "ok") return c === "ambigu" ? "ambigu" : null;
    }
    const jour = pos ? JOUR_DE_POSITION[pos] : 1;
    return prochainMois(ref, mois, jour, suffixe && /^20/.test(suffixe) ? Number(suffixe) : null);
  });

  // 7. Années : « début 2027 », « en 2027 », « courant 2027 », « fin 2027 », « early 2027 ».
  ajoute(new RegExp(`(?:${QUALIF}[\\s-]+(?:de\\s+l'annee\\s+|d'annee\\s+|of\\s+)?)?\\b(20\\d{2})\\b`, "g"), (m) => {
    const pos = position(m[1]);
    if (!pos) {
      const c = contexteAvant(t, m.index!);
      if (c !== "ok") return c === "ambigu" ? "ambigu" : null;
    }
    return { y: Number(m[2]), m: MOIS_DE_POSITION_ANNEE[pos ?? "debut"], d: 1 };
  });

  return out;
}

/** Découpe en phrases (fin de phrase ou retour à la ligne), en gardant le texte d'origine. */
function phrases(texte: string): string[] {
  return texte.split(/(?<=[.!?…])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Date de relance demandée par le prospect, ou null. `texte` doit être le texte NOUVEAU de la
 * réponse (texteNouveau) : une date citée de notre propre email ne compte jamais.
 */
export function detecterRelance(texte: string, o: OptionsRelance): RelanceDetectee | null {
  const ps = phrases(texte ?? "");
  const ref = ymdDe(jourDans(o.reference, o.fuseau));
  const lectures: Lecture[] = [];
  let extrait: string | null = null;

  for (let i = 0; i < ps.length; i++) {
    if (!INTENTION.test(normaliser(ps[i]))) continue;
    // La phrase de l'intention d'abord, puis la suivante, puis la précédente.
    for (const j of [i, i + 1, i - 1]) {
      if (j < 0 || j >= ps.length) continue;
      const trouvees = expressions(normaliser(ps[j]), ref);
      if (!trouvees.length) continue;
      lectures.push(...trouvees.map((x) => x.lecture));
      extrait ??= j === i ? ps[i] : `${ps[Math.min(i, j)]} ${ps[Math.max(i, j)]}`;
      break;
    }
  }
  if (!lectures.length || lectures.includes("ambigu")) return null;
  const dates = Array.from(new Set((lectures as Ymd[]).map(iso)));
  if (dates.length !== 1) return null; // deux dates différentes : on ne choisit pas

  const date = premierJourTravaille(dates[0], o.joursTravail);
  if (!date) return null;
  const refIso = iso(ref);
  if (date <= refIso) return null;
  const ecart = (versDate(ymdDe(date)).getTime() - versDate(ref).getTime()) / 86_400_000;
  if (ecart > HORIZON_JOURS) return null;
  // Une seule ligne : la phrase est citée telle quelle (comme DONNÉE) dans la rédaction.
  return { date, extrait: (extrait ?? "").replace(/\s+/g, " ").trim().slice(0, 240) };
}
