// Veille AO : d'un enregistrement BOAMP (open data DILA) ou d'un avis TED à un avis Naya.
// Pur : aucune base, aucun réseau. Les champs factuels sont lus tels quels ; rien n'est déduit.
import { finDeJourParis, lienSur } from "@shared/appels-offres";

export type SourceVeilleAO = "boamp" | "ted";

/** Un avis collecté, avant qualification. `texte` est ce que l'IA lira (données, jamais consignes). */
export interface AvisCollecte {
  source: SourceVeilleAO;
  sourceId: string;
  objet: string;
  acheteur: string | null;
  reference: string;
  procedure: string | null;
  dateLimite: Date | null;
  departement: string | null;
  /** Montant publié dans un champ structuré de l'avis (jamais estimé). */
  montantEstimeHt: string | null;
  lienAvis: string | null;
  lienDce: string | null;
  cpv: string[];
  texte: string;
}

export const TEXTE_MAX = 9000;

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  // \u009c : « œ » mal encodé (cp1252) dans certains titres TED.
  const s = String(v).replace(/\u009c/g, "œ").replace(/\s+/g, " ").trim();
  return s ? s : null;
};

const montantTexte = (v: unknown): string | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
};

export function procedureDepuisLibelle(libelle: unknown): string | null {
  const s = txt(libelle);
  if (!s) return null;
  if (/concours/i.test(s)) return "Concours";
  if (/adapt/i.test(s)) return "MAPA";
  if (/ouvert/i.test(s)) return "Appel d'offres ouvert";
  return "Autre";
}

/** « 6 » → « 06 », « 20A » reste « 20A ». */
const departement = (codes: unknown): string | null => {
  const l = (Array.isArray(codes) ? codes : codes ? [codes] : [])
    .map((c) => String(c).trim()).filter(Boolean)
    .map((c) => (/^\d$/.test(c) ? `0${c}` : c));
  return l.length ? Array.from(new Set(l)).join(", ") : null;
};

// ─── BOAMP ────────────────────────────────────────────────────────────────────

// Clés sans valeur pour l'analyse (identifiants techniques, coordonnées, métadonnées XML).
const CLES_BRUIT = new Set([
  "ID", "IdentificationCode", "CompanyID", "Telephone", "Telefax", "ElectronicMail", "tel", "fax", "mel",
  "StreetName", "PostalZone", "CountrySubentityCode", "UBLVersionID", "CustomizationID", "ContractFolderID",
  "VersionID", "IssueTime", "SubTypeCode", "EndpointID", "WebsiteURI", "NoticeLanguageCode", "RegulatoryDomain",
  "codeIdentificationNational", "adresseMailContact", "nomvoie", "cp", "url", "BuildingNumber", "Department",
  "CityName", "ElectronicOrderUsageIndicator", "ElectronicPaymentUsageIndicator", "AuctionConstraintIndicator",
  "classificationOrganisme", "LotsGroupID", "FundingProgramCode", "NoticeTypeCode", "PartyTypeCode",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Feuille { cle: string; parent: string; valeur: string }

/** Aplati le JSON « donnees » (schémas MAPA, FNSimple ou eForms) en feuilles clé/valeur. */
export function feuilles(n: unknown, cle = "", parent = "", out: Feuille[] = []): Feuille[] {
  if (Array.isArray(n)) { for (const v of n) feuilles(v, cle, parent, out); return out; }
  if (n && typeof n === "object") {
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k.startsWith("@")) continue;
      if (k === "#text") feuilles(v, cle, parent, out);
      else feuilles(v, k, cle, out);
    }
    return out;
  }
  if (typeof n === "string" || typeof n === "number") {
    const nom = cle.split(":").pop() ?? cle;
    out.push({ cle: nom, parent: parent.split(":").pop() ?? parent, valeur: String(n).trim() });
  }
  return out;
}

function lignesLisibles(fs: Feuille[]): string[] {
  const vues = new Set<string>();
  const lignes: string[] = [];
  for (const f of fs) {
    if (CLES_BRUIT.has(f.cle) || UUID.test(f.valeur)) continue;
    // Une clé sans valeur est un drapeau (« variantes: oui », « natureMarche: services »).
    const l = f.valeur ? `${f.cle}: ${f.valeur.replace(/\s+/g, " ")}` : f.parent ? `${f.parent}: ${f.cle}` : "";
    if (!l || vues.has(l)) continue;
    vues.add(l);
    lignes.push(l);
  }
  return lignes;
}

const CLES_CPV = /^(ItemClassificationCode|classPrincipale|classSupplementaire|cpv|codeCPV)$/i;
const CLES_DCE = ["URI", "urlDocConsul", "urlProfilAch", "urlProfilAcheteur", "adresseProfilAcheteur", "urlDCE"];

export type EnregistrementBoamp = Record<string, unknown>;

export function mapperBoamp(r: EnregistrementBoamp): AvisCollecte | null {
  const sourceId = txt(r.idweb);
  const objet = txt(r.objet);
  if (!sourceId || !objet) return null;
  let donnees: unknown = null;
  try { donnees = typeof r.donnees === "string" ? JSON.parse(r.donnees) : r.donnees ?? null; } catch { donnees = null; }
  const fs = donnees ? feuilles(donnees) : [];
  const cpv = Array.from(new Set(fs.filter((f) => CLES_CPV.test(f.cle) && /^\d{8}$/.test(f.valeur)).map((f) => f.valeur)));
  const dce = CLES_DCE.map((k) => fs.find((f) => f.cle === k && lienSur(f.valeur))?.valeur).find(Boolean) ?? null;
  const montant = montantTexte(fs.find((f) => f.cle === "EstimatedOverallContractAmount")?.valeur);
  const d = txt(r.datelimitereponse);
  const dateLimite = d ? new Date(d) : null;
  const acheteur = txt(r.nomacheteur);
  const procedure = procedureDepuisLibelle(r.procedure_libelle);
  const dep = departement(r.code_departement);
  const entete = [
    `Objet : ${objet}`,
    acheteur && `Acheteur : ${acheteur}`,
    procedure && `Procédure : ${txt(r.procedure_libelle)}`,
    txt(r.famille_libelle) && `Famille : ${txt(r.famille_libelle)}`,
    dateLimite && `Date limite de réponse : ${d}`,
    dep && `Départements : ${dep}`,
    cpv.length ? `CPV : ${cpv.join(", ")}` : null,
    Array.isArray(r.descripteur_libelle) && r.descripteur_libelle.length ? `Descripteurs BOAMP : ${r.descripteur_libelle.join(", ")}` : null,
  ].filter(Boolean) as string[];
  const texte = [...entete, "", ...lignesLisibles(fs)].join("\n").slice(0, TEXTE_MAX);
  return {
    source: "boamp",
    sourceId,
    objet,
    acheteur,
    reference: `BOAMP ${sourceId}`,
    procedure,
    dateLimite: dateLimite && !Number.isNaN(dateLimite.getTime()) ? dateLimite : null,
    departement: dep,
    montantEstimeHt: montant,
    lienAvis: lienSur(r.url_avis) ?? `https://www.boamp.fr/pages/avis/?q=idweb:${encodeURIComponent(sourceId)}`,
    lienDce: dce ? lienSur(dce) : null,
    cpv,
    texte,
  };
}

// ─── TED ──────────────────────────────────────────────────────────────────────

export type AvisTed = Record<string, any>;

/** Champ multilingue TED ({fra: "..."} ou {fra: ["..."]}) : le français, sinon la première langue. */
function multilingue(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const choisi = o.fra ?? o[Object.keys(o)[0]];
    return Array.isArray(choisi) ? choisi.map(String) : choisi ? [String(choisi)] : [];
  }
  return [];
}

const tableau = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

/** « 2026-12-09+02:00 » (+ « 16:00:00+02:00 ») → instant ; sans heure : 23 h 59 à Paris. */
export function instantTed(date: string, heure?: string | null): Date | null {
  const m = date.match(/^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return null;
  if (heure) {
    const h = heure.match(/^(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?$/);
    if (h) {
      const d = new Date(`${m[1]}T${h[1]}${h[2] ?? m[2] ?? "Z"}`);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return finDeJourParis(m[1]);
}

export function mapperTed(n: AvisTed): AvisCollecte | null {
  const sourceId = txt(n["publication-number"]);
  const titre = multilingue(n["title-proc"])[0] ?? multilingue(n["notice-title"])[0]?.split(" – ").slice(2).join(" – ");
  const objet = txt(titre);
  if (!sourceId || !objet) return null;
  const dates = tableau(n["deadline-receipt-tender-date-lot"]);
  const heures = tableau(n["deadline-receipt-tender-time-lot"]);
  const demandes = tableau(n["deadline-receipt-request-date-lot"]);
  const instants = (dates.length ? dates.map((d, i) => instantTed(d, heures[i])) : demandes.map((d) => instantTed(d)))
    .filter((d): d is Date => !!d);
  const dateLimite = instants.length ? new Date(Math.min(...instants.map((d) => d.getTime()))) : null;
  const acheteur = txt(multilingue(n["buyer-name"])[0]);
  const cpv = Array.from(new Set(tableau(n["classification-cpv"]).filter((c) => /^\d{8}$/.test(c))));
  const montant = (txt(n["estimated-value-cur-proc"]) ?? "EUR") === "EUR" ? montantTexte(n["estimated-value-proc"]) : null;
  const procedure = n["notice-type"] === "cn-desg" ? "Concours" : n["procedure-type"] === "open" ? "Appel d'offres ouvert" : txt(n["procedure-type"]) ? "Autre" : null;
  const noms = multilingue(n["award-criterion-name-lot"]);
  const poids = tableau(n["award-criterion-number-lot"]);
  const types = tableau(n["award-criterion-type-lot"]);
  const criteres = Array.from(new Set(noms.map((nom, i) => `${nom}${poids[i] ? ` (${poids[i]})` : ""}${types[i] ? ` [${types[i]}]` : ""}`)));
  const selection = Array.from(new Set(multilingue(n["selection-criterion-description-lot"])));
  const durees = (Array.isArray(n["contract-duration-period-lot"]) ? n["contract-duration-period-lot"] : [])
    .map((d: any) => (d?.value ? `${d.value} ${d.unit ?? ""}`.trim() : "")).filter(Boolean);
  const texte = [
    `Objet : ${objet}`,
    acheteur && `Acheteur : ${acheteur}`,
    `Avis TED ${sourceId}, type ${txt(n["notice-type"]) ?? "?"}, procédure ${txt(n["procedure-type"]) ?? "non précisée"}`,
    dateLimite && `Date limite de réponse : ${dateLimite.toISOString()}`,
    cpv.length && `CPV : ${cpv.join(", ")}`,
    tableau(n["place-of-performance-subdiv-lot"]).length && `Lieu (NUTS) : ${Array.from(new Set(tableau(n["place-of-performance-subdiv-lot"]))).join(", ")}`,
    txt(n["estimated-value-proc"]) && `Valeur estimée : ${n["estimated-value-proc"]} ${txt(n["estimated-value-cur-proc"]) ?? ""}`,
    tableau(n["estimated-value-lot"]).length && `Valeur estimée par lot : ${tableau(n["estimated-value-lot"]).join(", ")}`,
    durees.length && `Durée : ${Array.from(new Set(durees)).join(", ")}`,
    multilingue(n["description-proc"]).length && `Description : ${multilingue(n["description-proc"]).join(" ")}`,
    multilingue(n["description-lot"]).length && `Lots : ${Array.from(new Set(multilingue(n["description-lot"]))).join(" | ")}`,
    criteres.length && `Critères d'attribution : ${criteres.join(" ; ")}`,
    selection.length && `Critères de sélection : ${selection.join(" ; ")}`,
  ].filter(Boolean).join("\n").slice(0, TEXTE_MAX);
  const html = lienSur(n.links?.html?.FRA);
  return {
    source: "ted",
    sourceId,
    objet,
    acheteur,
    reference: `TED ${sourceId}`,
    procedure,
    dateLimite,
    departement: null,
    montantEstimeHt: montant,
    lienAvis: html ?? `https://ted.europa.eu/fr/notice/-/detail/${encodeURIComponent(sourceId)}`,
    lienDce: tableau(n["document-url-lot"]).map(lienSur).find(Boolean) ?? null,
    cpv,
    texte,
  };
}
