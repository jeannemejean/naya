/**
 * Personnalisation des messages de prospection — variables type lemlist.
 *
 * Syntaxe supportée dans les templates :
 *   {{firstName}}            → valeur, ou vide si absente
 *   {{firstName|toi}}        → valeur, ou « toi » si vide/absente (fallback)
 *   {{ company }}            → espaces tolérés
 *
 * Pur et testable — aucune dépendance.
 */

export type LeadLike = {
  name?: string | null;
  company?: string | null;
  role?: string | null;
  sector?: string | null;
};

export type TemplateVars = Record<string, string>;

/** Extrait les variables disponibles depuis un lead. */
export function leadVars(lead: LeadLike): TemplateVars {
  const fullName = (lead.name || "").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    firstName,
    lastName,
    name: fullName,
    company: (lead.company || "").trim(),
    role: (lead.role || "").trim(),
    sector: (lead.sector || "").trim(),
  };
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/** Remplace les `{{variable}}` (avec fallback `{{variable|défaut}}`) par leurs valeurs. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  if (!template) return template;
  return template.replace(TOKEN, (_match, key: string, fallback?: string) => {
    const value = vars[key];
    if (value !== undefined && value !== "") return value;
    return fallback !== undefined ? fallback : "";
  });
}
