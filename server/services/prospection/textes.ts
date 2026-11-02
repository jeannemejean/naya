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
  const bloc = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try {
    return JSON.parse(bloc);
  } catch {
    // Le modèle écrit parfois de vrais retours à la ligne DANS une chaîne JSON (un email en
    // paragraphes) : JSON.parse les refuse. On les échappe, puis on retente une fois.
    try {
      return JSON.parse(echapperSautsDansChaines(bloc));
    } catch {
      return {};
    }
  }
}

/** Échappe les retours à la ligne et tabulations bruts situés à l'intérieur des chaînes JSON. */
function echapperSautsDansChaines(json: string): string {
  let out = "";
  let dansChaine = false;
  let echappe = false;
  for (const c of json) {
    if (dansChaine) {
      if (echappe) { echappe = false; out += c; continue; }
      if (c === "\\") { echappe = true; out += c; continue; }
      if (c === '"') dansChaine = false;
      else if (c === "\n") { out += "\\n"; continue; }
      else if (c === "\r") { continue; }
      else if (c === "\t") { out += "\\t"; continue; }
    } else if (c === '"') dansChaine = true;
    out += c;
  }
  return out;
}
