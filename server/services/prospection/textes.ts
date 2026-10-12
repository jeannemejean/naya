/** Utilitaires de texte de la prospection. PURS, sans dépendance (module feuille). */

/** Aplati les données enrichies + notes existantes en un bloc de texte (audit / signal). */
export function enrichmentText(lead: any, data: any): string {
  const parts: string[] = [];
  if (lead?.role) parts.push(`Rôle: ${lead.role}`);
  if (lead?.company) parts.push(`Société: ${lead.company}`);
  if (lead?.sector) parts.push(`Secteur: ${lead.sector}`);
  if (lead?.notes) parts.push(`Notes: ${lead.notes}`);
  const li = data?.linkedin;
  if (li) parts.push(`LinkedIn — ${[li.headline, li.company, li.location, li.about].filter(Boolean).join(" | ")}`);
  const ig = data?.instagram;
  if (ig) parts.push(`Instagram — ${[ig.username, ig.biography, ig.followers ? `${ig.followers} abonnés` : ""].filter(Boolean).join(" | ")}`);
  if (data?.web?.content) parts.push(`Site web — ${data.web.content}`);
  return parts.join("\n") || "Données limitées : audit prudent à partir du nom/rôle/société.";
}

export function parseJsonObject(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
  } catch {
    return {};
  }
}
