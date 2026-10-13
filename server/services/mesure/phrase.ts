// Mesure en une phrase : « septembre : 12 000 €, 20 nouveaux clients, 2 000 € de pub Meta ».
// Naya (IA) en tire des champs ; ici, les règles PURES : lire sa sortie sans rien inventer, et
// compléter le mois en n'écrivant que les chiffres dits (jamais d'effacement d'un champ tu).
import { CLES_CANAUX } from "./catalogues";
import { moisPrecedent } from "./calculs";
import { lireNombre, moisValide, validerMois, type ChiffresMois, type Resultat } from "./saisie";
import { fusionnerImport } from "./import";

const CHAMPS = ["ca", "caNouveaux", "nouveauxClients", "commandes", "coutsVariables"] as const;

/** Le mois complété : seuls les champs et canaux présents dans `dits` changent. */
export function completerMois(existant: Partial<ChiffresMois> | undefined, dits: Record<string, unknown>): Resultat<ChiffresMois> {
  const v = validerMois(dits);
  if (!v.ok) return v;
  // « Présent » = une valeur réellement lue. Un champ envoyé vide (null, "", espaces) n'est
  // PAS présent : il n'efface jamais le chiffre déjà saisi.
  const presentes = {
    champs: CHAMPS.filter((c) => v.valeur[c] !== null),
    canaux: Object.keys(v.valeur.depenses),
  };
  const fusion = fusionnerImport(existant, v.valeur, presentes);
  if (fusion.ca !== null && fusion.caNouveaux !== null && fusion.caNouveaux > fusion.ca) return { ok: false, erreur: "ca_nouveaux_superieur" };
  return { ok: true, valeur: fusion };
}

export type PhraseLue = { ok: true; mois: string; champs: Record<string, unknown> } | { ok: false; erreur: "rien_compris" | "mois_invalide" };

/** La sortie de l'IA (JSON) → mois et champs compris. Un chiffre absent reste absent. */
export function lirePhrase(brut: string, maintenant = new Date()): PhraseLue {
  const m = brut.match(/\{[\s\S]*\}/);
  let o: any;
  try { o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
  if (!o || typeof o !== "object") return { ok: false, erreur: "rien_compris" };
  // Le mois en cours à Paris (pas en UTC : juste après minuit le 1er, c'est déjà le nouveau mois).
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(maintenant);
  const courant = `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
  const mois = o.mois == null || o.mois === "" ? moisPrecedent(courant) : o.mois;
  if (!moisValide(mois, maintenant)) return { ok: false, erreur: "mois_invalide" };
  const champs: Record<string, unknown> = {};
  for (const c of CHAMPS) {
    if (o[c] == null) continue;
    const n = lireNombre(o[c]);
    // Mêmes règles que l'enregistrement : un nombre de clients ou de ventes est entier.
    const entier = c === "nouveauxClients" || c === "commandes";
    if (typeof n === "number" && n >= 0 && (!entier || Number.isInteger(n))) champs[c] = n;
  }
  const depenses: Record<string, number> = {};
  for (const [canal, v] of Object.entries(o.depenses && typeof o.depenses === "object" ? o.depenses : {})) {
    if (!(CLES_CANAUX as readonly string[]).includes(canal)) continue;
    const n = lireNombre(v);
    if (typeof n === "number" && n >= 0) depenses[canal] = n;
  }
  if (Object.keys(depenses).length) champs.depenses = depenses;
  if (!Object.keys(champs).length) return { ok: false, erreur: "rien_compris" };
  return { ok: true, mois, champs };
}
