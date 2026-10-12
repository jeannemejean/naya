/**
 * GEO : la marque est-elle citée dans la réponse d'une IA, à quelle position, à côté de qui,
 * sur la base de quelles sources. PUR — aucun appel IA : on lit le texte et les citations.
 */
import { domaineDe, memeDomaine, positionNom } from "./texte";
import type { ConstatBrut } from "./types";

export interface Entite { nom: string; variantes?: string[]; domaine?: string | null }
export interface ReponseIA { texte: string; citations: string[] }
export interface AnalyseGeo {
  citee: boolean;
  citeeDansSources: boolean;
  /** Rang de la marque parmi les entités citées (ordre de première mention) ; null si absente du texte. */
  position: number | null;
  concurrentsCites: string[];
  sources: string[];
}

/** Première mention d'une entité dans le texte (nom ou variante de 3 caractères et plus). */
function premiereMention(texte: string, e: Entite): number {
  const noms = [e.nom, ...(e.variantes || [])].filter((n) => (n || "").trim().length >= 3);
  const pos = noms.map((n) => positionNom(texte, n)).filter((i) => i >= 0);
  return pos.length ? Math.min(...pos) : -1;
}

export function analyserReponse(r: ReponseIA, marque: Entite, concurrents: Entite[]): AnalyseGeo {
  const sources: string[] = [];
  for (const c of r.citations || []) {
    const d = domaineDe(c);
    if (d && !sources.includes(d)) sources.push(d);
  }
  const posMarque = premiereMention(r.texte || "", marque);
  const citeeDansSources = !!marque.domaine && sources.some((d) => memeDomaine(d, marque.domaine!));
  const mentions = concurrents
    .map((c) => ({ nom: c.nom, i: premiereMention(r.texte || "", c) }))
    .filter((m) => m.i >= 0);
  const toutes = [...mentions.map((m) => m.i), ...(posMarque >= 0 ? [posMarque] : [])].sort((a, b) => a - b);
  return {
    citee: posMarque >= 0 || citeeDansSources,
    citeeDansSources,
    position: posMarque >= 0 ? toutes.indexOf(posMarque) + 1 : null,
    concurrentsCites: mentions.sort((a, b) => a.i - b.i).map((m) => m.nom),
    sources,
  };
}

const NOM_MOTEUR: Record<string, string> = { openai: "ChatGPT", perplexity: "Perplexity" };
export const nomMoteur = (m: string) => NOM_MOTEUR[m] || m;

/**
 * Ce qui a changé pour un même prompt et un même moteur, d'un passage à l'autre. Une liste
 * modifiée n'est pas un changement du marché : la marque reconfigurée (`marqueComparable`
 * faux) et les concurrents ajoutés depuis (absents de `concurrentsAvant`) repartent d'un
 * point de départ.
 */
export function comparerGeo(
  prec: AnalyseGeo | null, cur: AnalyseGeo, prompt: string, moteur: string,
  opts: { marqueComparable?: boolean; concurrentsAvant?: string[] } = {},
): ConstatBrut[] {
  if (!prec) return [];
  const marqueComparable = opts.marqueComparable !== false;
  const ia = nomMoteur(moteur);
  const out: ConstatBrut[] = [];
  if (marqueComparable && !prec.citee && cur.citee) {
    out.push({ type: "citation_geo", titre: `${ia} te cite désormais`, texte: `À la question « ${prompt} », ${ia} cite maintenant ta marque${cur.position ? ` (position ${cur.position})` : ""}.` });
  } else if (marqueComparable && prec.citee && !cur.citee) {
    out.push({ type: "citation_geo", titre: `${ia} ne te cite plus`, texte: `À la question « ${prompt} », ${ia} ne cite plus ta marque.` });
  }
  const nouveaux = cur.concurrentsCites.filter((c) =>
    !prec.concurrentsCites.includes(c) && (!opts.concurrentsAvant || opts.concurrentsAvant.includes(c)));
  if (nouveaux.length) {
    out.push({ type: "citation_geo", titre: `Nouveau concurrent cité par ${ia}`, texte: `À la question « ${prompt} », ${ia} cite désormais ${nouveaux.join(", ")}.` });
  }
  return out;
}

/** Domaines cités dans les réponses où un concurrent apparaît et pas la marque : les sources à travailler. */
export function sourcesATravailler(analyses: AnalyseGeo[]): Array<{ domaine: string; n: number }> {
  const n = new Map<string, number>();
  for (const a of analyses) {
    if (a.citee || a.concurrentsCites.length === 0) continue;
    for (const d of a.sources) n.set(d, (n.get(d) || 0) + 1);
  }
  return Array.from(n, ([domaine, k]) => ({ domaine, n: k }))
    .sort((a, b) => b.n - a.n || a.domaine.localeCompare(b.domaine))
    .slice(0, 5);
}

export function bilanGeo(analyses: AnalyseGeo[]): { citees: number; total: number } {
  return { citees: analyses.filter((a) => a.citee).length, total: analyses.length };
}
