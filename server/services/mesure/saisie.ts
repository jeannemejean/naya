/** Validation d'un mois du registre, et suggestion tirée des ventes déclarées. PUR. */
import { CLES_CANAUX } from "./catalogues";

export type ChiffresMois = {
  ca: number | null; caNouveaux: number | null; nouveauxClients: number | null;
  commandes: number | null; coutsVariables: number | null; depenses: Record<string, number>;
};
export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

const PREMIER_MOIS = "2000-01";

export function moisValide(mois: unknown, maintenant = new Date()): mois is string {
  if (typeof mois !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) return false;
  const courant = `${maintenant.getUTCFullYear()}-${String(maintenant.getUTCMonth() + 1).padStart(2, "0")}`;
  return mois >= PREMIER_MOIS && mois <= courant;
}

/**
 * Un nombre saisi ou importé : number, ou texte « 12 500,50 », « 1.200,50 », « 1,200.50 ».
 * undefined = invalide ; null = vide.
 */
export function lireNombre(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[\s  €$]/g, "");
  if (!s) return null;
  const virgule = s.lastIndexOf(",");
  const point = s.lastIndexOf(".");
  if (virgule >= 0 && point >= 0) s = virgule > point ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (/^-?0[,.]\d+$/.test(s)) s = s.replace(",", ".");                       // 0,500 : un « 0 mille » n'existe pas
  else if (/^-?\d{1,3}(,\d{3}){2,}$/.test(s)) s = s.replace(/,/g, "");           // 1,200,000
  else if (/^-?\d{1,3},\d{3}$/.test(s)) return undefined;                        // 1,200 : 1,2 ou 1 200 ? refusé
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");         // 1.200.000
  else if (/^-?\d{1,3}\.\d{3}$/.test(s)) return undefined;                       // 1.200 : idem
  else if (virgule >= 0) s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}

export function validerMois(corps: unknown): Resultat<ChiffresMois> {
  const c = (corps && typeof corps === "object" ? corps : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [champ, entier] of [["ca", false], ["caNouveaux", false], ["nouveauxClients", true], ["commandes", true], ["coutsVariables", false]] as const) {
    const n = lireNombre(c[champ]);
    if (n === undefined || (n !== null && (n < 0 || (entier && !Number.isInteger(n))))) return { ok: false, erreur: `${champ}_invalide` };
    out[champ] = n;
  }
  const depenses: Record<string, number> = {};
  const brut = (c.depenses && typeof c.depenses === "object" ? c.depenses : {}) as Record<string, unknown>;
  for (const cle of CLES_CANAUX) {
    const n = lireNombre(brut[cle]);
    if (n === undefined || (n !== null && n < 0)) return { ok: false, erreur: "depense_invalide" };
    if (n !== null) depenses[cle] = n;
  }
  const v = { ...(out as Omit<ChiffresMois, "depenses">), depenses };
  if (v.ca !== null && v.caNouveaux !== null && v.caNouveaux > v.ca) return { ok: false, erreur: "ca_nouveaux_superieur" };
  const rien = [v.ca, v.caNouveaux, v.nouveauxClients, v.commandes, v.coutsVariables].every((x) => x === null) && !Object.keys(depenses).length;
  if (rien) return { ok: false, erreur: "mois_vide" };
  return { ok: true, valeur: v };
}

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Ventes déclarées dans « Conversions » ce mois-là : proposées pour pré-remplir, jamais écrites seules. */
export function suggestionDepuisConversions(
  conversions: Array<{ convertedAt: Date | string; conversionType: string | null; value: number | null }>, mois: string,
): { ventes: number; ca: number; valeursManquantes: number } | null {
  const ventes = conversions.filter((c) => {
    const d = new Date(c.convertedAt);
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return m === mois && sansAccent(c.conversionType || "") === "vente";
  });
  if (!ventes.length) return null;
  const avecValeur = ventes.filter((v) => typeof v.value === "number" && Number.isFinite(v.value));
  return { ventes: ventes.length, ca: avecValeur.reduce((a, v) => a + (v.value as number), 0), valeursManquantes: ventes.length - avecValeur.length };
}
