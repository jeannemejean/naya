/**
 * Import du registre depuis un CSV ou un copier-coller de tableur. PUR.
 * Séparateur détecté sur l'en-tête (tabulation, point-virgule, virgule). Les montants passent
 * par `lireNombre` : « 12 000,50 » et « 1.200,50 » sont compris, rien n'est deviné au-delà.
 */
import { CANAUX } from "./catalogues";
import { lireNombre, moisValide, validerMois, type ChiffresMois } from "./saisie";

const COLONNES: Record<string, string[]> = {
  mois: ["mois", "month", "periode", "period", "date"],
  ca: ["ca", "chiffre_d_affaires", "chiffre_affaires", "ca_total", "revenue", "revenu", "revenus", "sales"],
  caNouveaux: ["ca_nouveaux", "ca_nouveaux_clients", "new_revenue", "revenue_new", "revenue_new_customers"],
  nouveauxClients: ["nouveaux_clients", "new_customers", "nouveaux", "clients_nouveaux"],
  // Pas « ventes » : en français, une colonne « Ventes » contient souvent des euros.
  commandes: ["commandes", "orders", "nb_ventes", "nombre_de_ventes", "nb_commandes", "nombre_de_commandes"],
  coutsVariables: ["couts_variables", "cogs", "couts", "couts_produits"],
};

const norme = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/^["']|["']$/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function colonneDe(entete: string): { champ: string } | { canal: string } | null {
  const n = norme(entete);
  for (const [champ, alias] of Object.entries(COLONNES)) if (alias.includes(n)) return { champ };
  for (const c of CANAUX) if (c.cle === n || c.alias.includes(n)) return { canal: c.cle };
  return null;
}

const nettoyer = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const DATE_COMPLETE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Ordre des dates complètes « a/b/aaaa » de la colonne : jour/mois (FR) ou mois/jour (US).
 * Une valeur > 12 tranche ; sinon la partie constante est le jour (registre daté du 1er) ;
 * sinon la partie qui vaut 01. Impossible à trancher → null (la ligne est refusée).
 */
export function ordreDates(cellules: string[]): "jm" | "mj" | null {
  const d = cellules.map((c) => DATE_COMPLETE.exec(nettoyer(c))).filter((m): m is RegExpExecArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2])] as const);
  if (!d.length) return "jm";
  if (d.some(([a]) => a > 12)) return "jm";
  if (d.some(([, b]) => b > 12)) return "mj";
  const aConstant = d.every(([a]) => a === d[0][0]);
  const bConstant = d.every(([, b]) => b === d[0][1]);
  if (aConstant && !bConstant) return "jm";
  if (bConstant && !aConstant) return "mj";
  if (d.every(([a]) => a === 1) && !d.every(([, b]) => b === 1)) return "jm";
  if (d.every(([, b]) => b === 1) && !d.every(([a]) => a === 1)) return "mj";
  return null;
}

/** « 2026-09 », « 2026-09-01 », « 09/2026 », « 9/2026 », « 01/09/2026 » (selon `ordre`) → « 2026-09 ». */
function lireMois(v: string, ordre: "jm" | "mj" | null): string | null | "ambigu" {
  const s = nettoyer(v);
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = DATE_COMPLETE.exec(s);
  if (m) {
    if (!ordre) return "ambigu";
    return `${m[3]}-${(ordre === "jm" ? m[2] : m[1]).padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Les colonnes présentes dans le fichier : un import partiel ne touche qu'elles. */
export type Presentes = { champs: string[]; canaux: string[] };

/** Découpe une ligne CSV en respectant les guillemets (`""` = guillemet échappé). */
function decouper(ligne: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let dedans = false;
  for (let i = 0; i < ligne.length; i++) {
    const ch = ligne[i];
    if (dedans) {
      if (ch === '"' && ligne[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') dedans = false;
      else cur += ch;
    } else if (ch === '"') dedans = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Fusionne une ligne importée avec le mois existant : les colonnes absentes du fichier gardent leur valeur. */
export function fusionnerImport(existant: Partial<ChiffresMois> | undefined, importe: ChiffresMois, presentes: Presentes): ChiffresMois {
  if (!existant) return importe;
  const out: any = { depenses: { ...((existant.depenses as Record<string, number>) || {}) } };
  for (const champ of ["ca", "caNouveaux", "nouveauxClients", "commandes", "coutsVariables"] as const) {
    out[champ] = presentes.champs.includes(champ) ? importe[champ] : (existant[champ] ?? null);
  }
  for (const canal of presentes.canaux) {
    if (canal in importe.depenses) out.depenses[canal] = importe.depenses[canal];
    else delete out.depenses[canal];
  }
  return out;
}

export type ResultatImport = {
  lignes: Array<{ mois: string; valeur: ChiffresMois; presentes: Presentes }>;
  erreurs: Array<{ ligne: number; message: string }>;
  inconnues: string[];
};

export function lireImport(texte: string, maintenant = new Date()): ResultatImport {
  const lignesBrutes = texte.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lignesBrutes.length) return { lignes: [], erreurs: [{ ligne: 1, message: "vide" }], inconnues: [] };
  const entete = lignesBrutes[0];
  const sep = entete.includes("\t") ? "\t" : entete.includes(";") ? ";" : ",";
  const titres = decouper(entete, sep);
  const colonnes = titres.map(colonneDe);
  const inconnues = titres.filter((_, i) => !colonnes[i]).map((s) => s.trim()).filter(Boolean);
  const presentes: Presentes = {
    champs: [...new Set(colonnes.flatMap((c) => (c && "champ" in c && c.champ !== "mois" ? [c.champ] : [])))],
    canaux: [...new Set(colonnes.flatMap((c) => (c && "canal" in c ? [c.canal] : [])))],
  };
  const iMois = colonnes.findIndex((c) => c && "champ" in c && c.champ === "mois");
  if (iMois < 0) return { lignes: [], erreurs: [{ ligne: 1, message: "colonne_mois_absente" }], inconnues };

  const out: ResultatImport = { lignes: [], erreurs: [], inconnues };
  const vus = new Set<string>();
  const ordre = ordreDates(lignesBrutes.slice(1).map((l) => decouper(l, sep)[iMois] || ""));
  lignesBrutes.slice(1).forEach((brute, i) => {
    const ligne = i + 2;
    const cellules = decouper(brute, sep);
    // Une cellule de plus que l'en-tête (séparateur non protégé) décalerait les montants : refusé.
    if (cellules.length > colonnes.length && cellules.slice(colonnes.length).some((c) => c.trim())) {
      out.erreurs.push({ ligne, message: "colonnes_incoherentes" }); return;
    }
    const mois = lireMois(cellules[iMois] || "", ordre);
    if (mois === "ambigu") { out.erreurs.push({ ligne, message: "date_ambigue" }); return; }
    if (!mois || !moisValide(mois, maintenant)) { out.erreurs.push({ ligne, message: "mois_invalide" }); return; }
    if (vus.has(mois)) { out.erreurs.push({ ligne, message: "mois_en_double" }); return; }
    const corps: Record<string, unknown> = { depenses: {} as Record<string, number> };
    for (let j = 0; j < colonnes.length; j++) {
      const col = colonnes[j];
      if (!col || j === iMois) continue;
      const cellule = (cellules[j] ?? "").trim();
      if ("canal" in col) {
        const n = lireNombre(cellule);
        if (n === undefined) { corps.invalide = true; continue; }
        if (n !== null) (corps.depenses as Record<string, number>)[col.canal] = ((corps.depenses as Record<string, number>)[col.canal] ?? 0) + n;
      } else corps[col.champ] = cellule;
    }
    if (corps.invalide) { out.erreurs.push({ ligne, message: "valeur_invalide" }); return; }
    const v = validerMois(corps);
    if (!v.ok) { out.erreurs.push({ ligne, message: v.erreur.endsWith("_invalide") ? "valeur_invalide" : v.erreur }); return; }
    vus.add(mois);
    out.lignes.push({ mois, valeur: v.valeur, presentes });
  });
  return out;
}
