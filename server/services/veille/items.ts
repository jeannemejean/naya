/** La liste suivie de la veille : validation, propositions de Naya, dédoublonnage. PUR. */
import type { VeilleItem } from "@shared/schema";
import { parseJsonObject } from "../prospection/textes";
import { normaliser } from "./texte";
import {
  TYPES_ITEM, STATUTS_ITEM, KIND_CONCURRENTS, KIND_VOIX_CLIENT, KIND_SERP, KIND_GEO,
  type TypeItem, type KindVeille,
} from "./types";

/** Nombre maximal d'éléments par type et par projet (hors écartés). */
export const PLAFONDS: Record<TypeItem, number> = {
  marque: 1, concurrent: 5, requete_voc: 6, mot_cle: 15, prompt_geo: 8,
};

export function kindDuType(type: string): KindVeille | null {
  switch (type) {
    case "concurrent": return KIND_CONCURRENTS;
    case "requete_voc": return KIND_VOIX_CLIENT;
    case "mot_cle": return KIND_SERP;
    case "prompt_geo": return KIND_GEO;
    default: return null;
  }
}

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Valeur nettoyée : seuls site, instagram et variantes sont gardés. */
export function nettoyerValeur(v: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!v || typeof v !== "object") return out;
  const site = texte(v.site, 200);
  if (site) out.site = site;
  const instagram = texte(v.instagram, 200);
  if (instagram) out.instagram = instagram;
  if (Array.isArray(v.variantes)) {
    const vs = v.variantes.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 80)).slice(0, 6);
    if (vs.length) out.variantes = vs;
  }
  return out;
}

type Champs = { type?: TypeItem; libelle?: string; valeur?: Record<string, unknown>; statut?: string };
export type Validation = { ok: true; valeur: Champs } | { ok: false; erreur: string };

export function validerItem(body: any, opts: { partiel?: boolean } = {}): Validation {
  const b = body ?? {};
  const v: Champs = {};
  if (!opts.partiel) {
    if (!TYPES_ITEM.includes(b.type)) return { ok: false, erreur: "type_invalide" };
    v.type = b.type;
  }
  if ("libelle" in b || !opts.partiel) {
    const l = texte(b.libelle, 300);
    if (!l) return { ok: false, erreur: "libelle_requis" };
    v.libelle = l;
  }
  if ("valeur" in b) v.valeur = nettoyerValeur(b.valeur);
  if ("statut" in b) {
    if (!STATUTS_ITEM.includes(b.statut)) return { ok: false, erreur: "statut_invalide" };
    v.statut = b.statut;
  }
  return { ok: true, valeur: v };
}

export interface ElementPropose { libelle: string; valeur?: Record<string, unknown> }
export interface Proposition {
  marque: ElementPropose | null;
  concurrents: ElementPropose[];
  requetes_voc: ElementPropose[];
  mots_cles: ElementPropose[];
  prompts_geo: ElementPropose[];
}

const listeTextes = (xs: unknown): ElementPropose[] =>
  (Array.isArray(xs) ? xs : []).map((x) => texte(x, 300)).filter(Boolean).map((libelle) => ({ libelle }));

/** Réponse de l'IA → proposition. Tolérante : toute forme inattendue donne une liste vide. */
export function lireProposition(raw: string): Proposition {
  const o = parseJsonObject(raw || "");
  const m = o?.marque && typeof o.marque === "object" ? o.marque : null;
  const nomMarque = texte(m?.nom, 160);
  return {
    marque: nomMarque ? { libelle: nomMarque, valeur: nettoyerValeur(m) } : null,
    concurrents: (Array.isArray(o?.concurrents) ? o.concurrents : [])
      .map((c: any) => ({ libelle: texte(c?.nom, 160), valeur: nettoyerValeur(c) }))
      .filter((c: ElementPropose) => c.libelle),
    requetes_voc: listeTextes(o?.requetes_voc),
    mots_cles: listeTextes(o?.mots_cles),
    prompts_geo: listeTextes(o?.prompts_geo),
  };
}

const cle = (type: string, libelle: string) => `${type}|${normaliser(libelle)}`;

/**
 * Propositions → lignes à créer (statut `propose`). Un élément déjà présent, même écarté,
 * n'est jamais reproposé ; les plafonds tiennent compte de l'existant non écarté.
 */
export function fusionnerPropositions(existants: VeilleItem[], p: Proposition) {
  const vus = new Set(existants.map((e) => cle(e.type, e.libelle)));
  const actifs = (type: string) => existants.filter((e) => e.type === type && e.statut !== "ecarte").length;
  const out: Array<{ type: TypeItem; libelle: string; valeur: Record<string, unknown> | null; statut: "propose"; source: "naya" }> = [];
  const groupes: Array<[TypeItem, ElementPropose[]]> = [
    ["marque", p.marque ? [p.marque] : []],
    ["concurrent", p.concurrents],
    ["requete_voc", p.requetes_voc],
    ["mot_cle", p.mots_cles],
    ["prompt_geo", p.prompts_geo],
  ];
  for (const [type, xs] of groupes) {
    let place = PLAFONDS[type] - actifs(type);
    for (const x of xs) {
      if (place <= 0) break;
      const k = cle(type, x.libelle);
      if (!normaliser(x.libelle) || vus.has(k)) continue;
      vus.add(k);
      out.push({ type, libelle: x.libelle, valeur: x.valeur && Object.keys(x.valeur).length ? x.valeur : null, statut: "propose", source: "naya" });
      place--;
    }
  }
  return out;
}

/** Les éléments suivis d'un type, dans la limite du plafond. */
export function suivis(items: VeilleItem[], type: TypeItem): VeilleItem[] {
  return items.filter((i) => i.type === type && i.statut === "suivi").slice(0, PLAFONDS[type]);
}
