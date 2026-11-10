// Appels d'offres — valeurs autorisées et passage d'une ligne Notion à une ligne Naya.
// Pur : aucune base, aucun réseau. Partagé entre le serveur, le script d'import et la page.

export const STATUTS_AO = [
  "repere", "premier_jet_pret", "en_redaction", "depose", "gagne", "perdu", "ecarte",
] as const;
export type StatutAO = (typeof STATUTS_AO)[number];

export const SCORES_AO = ["fort", "moyen", "faible"] as const;
export type ScoreAO = (typeof SCORES_AO)[number];

export const PROCEDURES_AO = ["MAPA", "Appel d'offres ouvert", "Concours", "Autre"] as const;
export const OFFRES_JMD = ["IN SITU", "IN LINEA", "IN SCENA"] as const;

export const estStatutAO = (v: unknown): v is StatutAO =>
  typeof v === "string" && (STATUTS_AO as readonly string[]).includes(v);

/** Retire emojis, accents et ponctuation de tête : « 🔥 Fort » → « fort », « ⏭ Écarté » → « ecarte ». */
const normaliser = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();

const STATUTS_PAR_LIBELLE: Record<string, StatutAO> = {
  "repere": "repere",
  "premier jet pret": "premier_jet_pret",
  "en redaction": "en_redaction",
  "depose": "depose",
  "gagne": "gagne",
  "perdu": "perdu",
  "ecarte": "ecarte",
};

export function statutDepuisNotion(v: unknown): StatutAO {
  if (typeof v !== "string") return "repere";
  return STATUTS_PAR_LIBELLE[normaliser(v)] ?? "repere";
}

export function scoreDepuisNotion(v: unknown): ScoreAO | null {
  if (typeof v !== "string") return null;
  const n = normaliser(v);
  return (SCORES_AO as readonly string[]).includes(n) ? (n as ScoreAO) : null;
}

export function procedureDepuisNotion(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return (PROCEDURES_AO as readonly string[]).includes(v) ? v : "Autre";
}

/** Multi-select : la requête SQL Notion le rend en texte JSON (« ["IN SCENA","IN SITU"] »). */
export function offresDepuisNotion(v: unknown): string[] {
  let brut: unknown = v;
  if (typeof v === "string") {
    try { brut = JSON.parse(v); } catch { brut = v.split(","); }
  }
  if (!Array.isArray(brut)) return [];
  const vues = brut.map((x) => String(x).trim().toUpperCase())
    .filter((x) => (OFFRES_JMD as readonly string[]).includes(x));
  // Ordre fixe, sans doublon : IN SITU, IN LINEA, IN SCENA.
  return OFFRES_JMD.filter((o) => vues.includes(o));
}

/**
 * Date Notion (« 2026-11-09 09:00:00Z » ou « 2026-11-09 »). Une date sans heure devient midi UTC
 * ce jour-là : elle reste le bon jour à Paris, et le décompte « dans N jours » ne bouge pas.
 */
export function instantDepuisNotion(debut: unknown, avecHeure: unknown): Date | null {
  if (typeof debut !== "string" || !debut.trim()) return null;
  const s = debut.trim();
  const jourSeul = /^\d{4}-\d{2}-\d{2}$/.test(s) || avecHeure === 0;
  const iso = jourSeul ? `${s.slice(0, 10)}T12:00:00Z` : s.replace(" ", "T");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function jourDepuisNotion(debut: unknown): string | null {
  if (typeof debut !== "string") return null;
  const m = debut.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const texte = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const montant = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
};

/** Ligne telle que l'export Notion la donne (colonnes de la requête SQL du data source). */
export type LigneNotionAO = Record<string, unknown>;

/** Ce que l'import écrit : tout sauf userId / id / horodatages. */
export interface AppelOffresImporte {
  objet: string;
  acheteur: string | null;
  reference: string | null;
  procedure: string | null;
  dateLimite: Date | null;
  dateReperage: string | null;
  departement: string | null;
  montantEstimeHt: string | null;
  scoreAdequation: ScoreAO | null;
  offresJmd: string[];
  statut: StatutAO;
  criteresPonderation: string | null;
  piecesExigees: string | null;
  bloquants: string | null;
  notes: string | null;
  lienAvis: string | null;
  lienDce: string | null;
  premierJet: string | null;
  source: "notion_import";
  sourceId: string;
}

/** Id stable de la page Notion : la colonne `id`, sinon les 32 caractères hexa de son URL. */
export function idPageNotion(ligne: LigneNotionAO): string | null {
  const id = texte(ligne.id);
  if (id) return id.replace(/-/g, "").toLowerCase();
  const url = texte(ligne.url);
  const m = url?.match(/([0-9a-f]{32})(?:\?|$)/i);
  return m ? m[1].toLowerCase() : null;
}

/** null si la ligne est inexploitable (ni objet, ni id de page). */
export function mapperLigneNotion(ligne: LigneNotionAO): AppelOffresImporte | null {
  const objet = texte(ligne["Objet"]);
  const sourceId = idPageNotion(ligne);
  if (!objet || !sourceId) return null;
  return {
    objet,
    acheteur: texte(ligne["Acheteur"]),
    reference: texte(ligne["Référence"]),
    procedure: procedureDepuisNotion(ligne["Procédure"]),
    dateLimite: instantDepuisNotion(ligne["date:Date limite:start"], ligne["date:Date limite:is_datetime"]),
    dateReperage: jourDepuisNotion(ligne["date:Date repérage:start"]),
    departement: texte(ligne["Département"]),
    montantEstimeHt: montant(ligne["Montant estimé HT"]),
    scoreAdequation: scoreDepuisNotion(ligne["Score adéquation"]),
    offresJmd: offresDepuisNotion(ligne["Offre JMD"]),
    statut: statutDepuisNotion(ligne["Statut"]),
    criteresPonderation: texte(ligne["Critères et pondération"]),
    piecesExigees: texte(ligne["Pièces exigées"]),
    bloquants: texte(ligne["Bloquants"]),
    notes: texte(ligne["Notes"]),
    lienAvis: texte(ligne["Lien avis"]),
    lienDce: texte(ligne["Lien DCE"]),
    premierJet: texte(ligne["Premier jet"]),
    source: "notion_import",
    sourceId,
  };
}

/** Jours calendaires (Europe/Paris) entre aujourd'hui et la date limite ; négatif si passée. */
export function joursAvant(dateLimite: Date | string | null, maintenant = new Date()): number | null {
  if (!dateLimite) return null;
  const d = new Date(dateLimite);
  if (Number.isNaN(d.getTime())) return null;
  const jour = (x: Date) => {
    const [a, m, j] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(x).split("-").map(Number);
    return Date.UTC(a, m - 1, j);
  };
  return Math.round((jour(d) - jour(maintenant)) / 86_400_000);
}

/** Passé = la date limite (instant) est derrière nous. Sans date : à venir (à regarder). */
export const estPasse = (dateLimite: Date | string | null, maintenant = new Date()) =>
  !!dateLimite && new Date(dateLimite).getTime() < maintenant.getTime();

export const SEUIL_URGENCE_JOURS = 10;
