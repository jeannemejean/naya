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
  commandes: ["commandes", "ventes", "orders", "nb_ventes", "nombre_de_ventes", "nb_commandes"],
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

/** « 2026-09 », « 2026-09-01 », « 09/2026 », « 9/2026 », « 01/09/2026 » → « 2026-09 ». */
function lireMois(v: string): string | null {
  const s = v.trim().replace(/^["']|["']$/g, "");
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return null;
}

export type ResultatImport = {
  lignes: Array<{ mois: string; valeur: ChiffresMois }>;
  erreurs: Array<{ ligne: number; message: string }>;
  inconnues: string[];
};

export function lireImport(texte: string, maintenant = new Date()): ResultatImport {
  const lignesBrutes = texte.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lignesBrutes.length) return { lignes: [], erreurs: [{ ligne: 1, message: "vide" }], inconnues: [] };
  const entete = lignesBrutes[0];
  const sep = entete.includes("\t") ? "\t" : entete.includes(";") ? ";" : ",";
  const colonnes = entete.split(sep).map(colonneDe);
  const inconnues = entete.split(sep).filter((_, i) => !colonnes[i]).map((s) => s.trim()).filter(Boolean);
  const iMois = colonnes.findIndex((c) => c && "champ" in c && c.champ === "mois");
  if (iMois < 0) return { lignes: [], erreurs: [{ ligne: 1, message: "colonne_mois_absente" }], inconnues };

  const out: ResultatImport = { lignes: [], erreurs: [], inconnues };
  const vus = new Set<string>();
  lignesBrutes.slice(1).forEach((brute, i) => {
    const ligne = i + 2;
    const cellules = brute.split(sep);
    const mois = lireMois(cellules[iMois] || "");
    if (!mois || !moisValide(mois, maintenant)) { out.erreurs.push({ ligne, message: "mois_invalide" }); return; }
    if (vus.has(mois)) { out.erreurs.push({ ligne, message: "mois_en_double" }); return; }
    const corps: Record<string, unknown> = { depenses: {} as Record<string, number> };
    for (let j = 0; j < colonnes.length; j++) {
      const col = colonnes[j];
      if (!col || j === iMois) continue;
      const cellule = (cellules[j] ?? "").trim().replace(/^["']|["']$/g, "");
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
    out.lignes.push({ mois, valeur: v.valeur });
  });
  return out;
}
