/**
 * Sourcing de prospects jusqu'à une cible. PUR (les appels réseau sont injectés).
 *
 * Avant : 4 requêtes, première page Google, pays de sortie Bright Data aléatoire — moins
 * de 10 prospects, et ~0 au deuxième passage (tout était déjà connu). Ici :
 *  - chaque requête est paginée (jusqu'à PAGES_PAR_REQUETE pages, `start=`) ;
 *  - on s'arrête dès que la cible de NOUVEAUX prospects est atteinte ;
 *  - quand les requêtes sont épuisées, on en redemande de nouvelles en passant celles
 *    déjà utilisées (le générateur doit proposer d'autres angles) ;
 *  - un plafond dur d'appels SERP par passage protège le budget Bright Data.
 */
import { extractLinkedInLead, type ExtractedLead, type SerpResult } from "./serp";

/** Plafond dur d'appels SERP facturés par passage de sourcing. */
export const PLAFOND_APPELS_SERP = 30;
/** Pages Google lues par requête (0, 1, 2 → start=0, 10, 20). */
export const PAGES_PAR_REQUETE = 3;
/** Nombre maximal de fois où l'on redemande des requêtes neuves dans un passage. */
const MAX_RENOUVELLEMENTS = 2;

// ─── Marché : gl / hl ─────────────────────────────────────────────────────────

/**
 * Noms de pays (FR + EN) → code ISO. DONNÉE de géographie, pas un ciblage : elle sert
 * seulement à lire « Belgique » ou « United Kingdom » dans les géographies de l'ICP.
 */
const PAYS_PAR_NOM: Array<[RegExp, string]> = [
  [/\bfrance\b/i, "fr"],
  [/\bbelgi(que|um)\b/i, "be"],
  [/\b(suisse|switzerland)\b/i, "ch"],
  [/\bluxemb(o|ou)rg\b/i, "lu"],
  [/\b(canada|qu[ée]bec)\b/i, "ca"],
  [/\b(royaume[- ]uni|united kingdom|uk|angleterre|england)\b/i, "gb"],
  [/\b(irlande|ireland)\b/i, "ie"],
  [/\b([ée]tats[- ]unis|united states|usa)\b/i, "us"],
  [/\b(allemagne|germany|deutschland)\b/i, "de"],
  [/\b(espagne|spain|espa[ñn]a)\b/i, "es"],
  [/\b(italie|italy|italia)\b/i, "it"],
  [/\b(pays[- ]bas|netherlands|nederland)\b/i, "nl"],
  [/\bportugal\b/i, "pt"],
  [/\b(maroc|morocco)\b/i, "ma"],
  [/\b(tunisie|tunisia)\b/i, "tn"],
  [/\b(s[ée]n[ée]gal)\b/i, "sn"],
  [/\b(c[ôo]te d'ivoire|ivory coast)\b/i, "ci"],
];

/** Pays par défaut d'une langue de compte — dernier recours, pour ne JAMAIS laisser Bright Data tirer un pays au hasard. */
const PAYS_PAR_LANGUE: Record<string, string> = { fr: "fr", en: "us" };

export interface IndicesMarche {
  /** Code ISO alpha-2 proposé par les critères (generateLeadCriteria). */
  searchCountry?: string | null;
  /** Langue de recherche proposée par les critères (ISO 639-1). */
  searchLanguage?: string | null;
  /** Géographies de l'ICP (texte libre). */
  geographies?: string[] | null;
  /** Langue du compte (shared/language.ts). */
  langueCompte?: string | null;
}

/**
 * gl/hl à épingler sur chaque appel SERP. Ordre : pays explicite des critères → pays lu
 * dans les géographies de l'ICP → pays de la langue du compte. Jamais vide : sans gl/hl,
 * Bright Data sort d'un pays aléatoire et les résultats deviennent non déterministes.
 */
export function marcheDeRecherche(indices: IndicesMarche): { pays: string; langue: string } {
  const langueCompte = /^[a-z]{2}$/i.test(indices.langueCompte || "") ? indices.langueCompte!.toLowerCase() : "fr";
  const langue = /^[a-z]{2}$/i.test(indices.searchLanguage || "") ? indices.searchLanguage!.toLowerCase() : langueCompte;

  let pays: string | null = null;
  if (/^[a-z]{2}$/i.test((indices.searchCountry || "").trim())) pays = indices.searchCountry!.trim().toLowerCase();
  if (!pays) {
    for (const g of indices.geographies || []) {
      const trouve = PAYS_PAR_NOM.find(([re]) => re.test(g));
      if (trouve) { pays = trouve[1]; break; }
    }
  }
  if (!pays) pays = PAYS_PAR_LANGUE[langue] ?? PAYS_PAR_LANGUE[langueCompte] ?? "fr";
  return { pays, langue };
}

// ─── Requêtes ────────────────────────────────────────────────────────────────

/**
 * Ramène une requête à la syntaxe Google X-ray. Une requête booléenne Sales Navigator
 * (`AND`, `NOT`) envoyée telle quelle à Google rend ~0 résultat : `AND` est implicite
 * chez Google et `NOT` doit s'écrire `-terme`. Sans `site:linkedin.com/in`, on ne
 * récupère pas de profils.
 */
export function normaliserRequeteGoogle(q: string): string | null {
  let s = (q || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  s = s.replace(/\s+AND\s+/g, " ");
  s = s.replace(/\bNOT\s+("[^"]*"|\([^)]*\)|\S+)/g, "-$1");
  if (!/site:\s*([a-z]{2}\.)?linkedin\.com\/in/i.test(s)) s = `site:linkedin.com/in ${s}`;
  return s.replace(/\s+/g, " ").trim();
}

function cleRequete(q: string): string {
  return q.replace(/\s+/g, " ").trim().toLowerCase();
}

// ─── Boucle ──────────────────────────────────────────────────────────────────

export interface EntreeSourcing {
  requetes: string[];
  /** Nombre de NOUVEAUX prospects recherchés. */
  cible: number;
  /** Un appel SERP facturé : requête + numéro de page (0 = première). */
  search: (requete: string, page: number) => Promise<SerpResult[]>;
  /** URL LinkedIn déjà présente chez l'utilisatrice (clé normalisée en minuscules). */
  estConnu: (urlNormalisee: string) => boolean;
  /** Fournit des requêtes NEUVES, sachant celles déjà utilisées. Liste vide = épuisé. */
  nouvellesRequetes?: (dejaUtilisees: string[]) => Promise<string[]>;
  /** Appelé à chaque appel SERP facturé (journal d'usage). */
  surAppel?: (requete: string, page: number) => void | Promise<void>;
  plafondAppels?: number;
  pagesParRequete?: number;
}

export interface ResultatSourcing {
  leads: ExtractedLead[];
  appels: number;
  requetesUtilisees: string[];
  dejaConnus: number;
  cibleAtteinte: boolean;
  /** Toutes les requêtes disponibles ont été parcourues avant d'atteindre la cible ou le plafond. */
  epuise: boolean;
}

export async function sourcerJusquaCible(e: EntreeSourcing): Promise<ResultatSourcing> {
  const plafond = e.plafondAppels ?? PLAFOND_APPELS_SERP;
  const pages = e.pagesParRequete ?? PAGES_PAR_REQUETE;
  const vues = new Set<string>();
  const leads: ExtractedLead[] = [];
  const requetesUtilisees: string[] = [];
  const clesUtilisees = new Set<string>();
  let appels = 0;
  let dejaConnus = 0;
  let renouvellements = 0;

  const file: string[] = [];
  const ajouter = (qs: string[]) => {
    let n = 0;
    for (const q of qs) {
      const t = (q || "").trim();
      if (!t) continue;
      const k = cleRequete(t);
      if (clesUtilisees.has(k) || file.some((f) => cleRequete(f) === k)) continue;
      file.push(t);
      n++;
    }
    return n;
  };
  ajouter(e.requetes);

  const cibleAtteinte = () => leads.length >= e.cible;
  const plafondAtteint = () => appels >= plafond;

  while (!cibleAtteinte() && !plafondAtteint()) {
    if (file.length === 0) {
      if (!e.nouvellesRequetes || renouvellements >= MAX_RENOUVELLEMENTS) break;
      renouvellements++;
      const neuves = await e.nouvellesRequetes([...requetesUtilisees]).catch(() => [] as string[]);
      if (ajouter(neuves) === 0) break;
      continue;
    }
    const q = file.shift()!;
    clesUtilisees.add(cleRequete(q));
    requetesUtilisees.push(q);

    for (let page = 0; page < pages; page++) {
      if (cibleAtteinte() || plafondAtteint()) break;
      appels++;
      await e.surAppel?.(q, page);
      const resultats = await e.search(q, page).catch(() => [] as SerpResult[]);
      let profils = 0;
      for (const r of resultats) {
        const lead = extractLinkedInLead(r);
        if (!lead) continue;
        profils++;
        const cle = lead.linkedinUrl.toLowerCase().replace(/\/+$/, "");
        if (vues.has(cle)) continue;
        vues.add(cle);
        if (e.estConnu(cle)) { dejaConnus++; continue; }
        leads.push(lead);
        if (cibleAtteinte()) break;
      }
      // Une page sans aucun profil : Google n'a plus rien pour cette requête.
      if (profils === 0) break;
    }
  }

  return {
    leads: leads.slice(0, Math.max(0, e.cible)),
    appels,
    requetesUtilisees,
    dejaConnus,
    cibleAtteinte: cibleAtteinte(),
    epuise: !cibleAtteinte() && !plafondAtteint(),
  };
}
