/**
 * Parsing CSV minimal et robuste pour l'import de leads (style lemlist).
 * Gère : guillemets, virgules échappées, guillemets doublés, \r\n.
 * En-têtes normalisés (trim + minuscules) pour un mapping tolérant FR/EN.
 */

/** Parse un texte CSV (1re ligne = en-têtes) en tableau d'objets {header: value}. */
export function parseCsv(text: string): Record<string, string>[] {
  if (!text || !text.trim()) return [];

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // guillemet échappé
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
      else if (c === "\r") { /* ignore — géré avec \n */ }
      else field += c;
    }
  }
  // Dernier champ / dernière ligne
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every(c => c.trim() === "")) continue; // ligne vide
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? "").trim(); });
    out.push(obj);
  }
  return out;
}

export interface ImportedLead {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  sector: string | null;
  linkedinUrl: string | null;
}

const pick = (row: Record<string, string>, keys: string[]): string =>
  keys.map(k => row[k]).find(v => v && v.trim()) || "";

/** Mappe une ligne CSV (en-têtes FR/EN courants) vers un lead. Retourne null si vide. */
export function mapLeadRow(row: Record<string, string>): ImportedLead | null {
  const fullName = pick(row, ["name", "nom", "full name", "nom complet"]);
  const first = pick(row, ["firstname", "first name", "prénom", "prenom"]);
  const last = pick(row, ["lastname", "last name", "nom de famille"]);
  const name = (fullName || [first, last].filter(Boolean).join(" ")).trim();

  const email = pick(row, ["email", "e-mail", "mail", "adresse email"]);
  const company = pick(row, ["company", "société", "societe", "entreprise", "organisation"]);
  const role = pick(row, ["role", "poste", "titre", "fonction", "job title", "title"]);
  const sector = pick(row, ["sector", "secteur", "industry", "industrie"]);
  const linkedinUrl = pick(row, ["linkedin", "linkedinurl", "linkedin url", "profil linkedin"]);

  if (!name && !email) return null; // ligne inutilisable

  return {
    name,
    email: email || null,
    company: company || null,
    role: role || null,
    sector: sector || null,
    linkedinUrl: linkedinUrl || null,
  };
}
