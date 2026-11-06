/**
 * Lire l'entreprise d'un prospect sans table d'entreprises. PUR.
 *
 * Naya cherche des personnes : l'entreprise n'est qu'un morceau du titre Google, en texte
 * libre. Ce module dit ce qu'on peut en tirer sûrement. En cas de doute, il répond « pas
 * d'entreprise » : un champ vide se complète, une fausse entreprise rapproche deux inconnus.
 */

/** Sans casse ni accent, ponctuation remplacée par des espaces. */
function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, " ")
    .trim();
}

const MOTS_DE_POSTE = new RegExp(
  "\\b(?:" + [
    "fondat(?:eur|rice)", "co ?fondat(?:eur|rice)", "founder", "co ?founder", "owner",
    "gerant(?:e)?", "dirigeant(?:e)?", "direct(?:eur|rice)", "president(?:e)?", "responsable",
    "manager", "chef(?:fe)? de", "head of", "charge(?:e)? de", "associe(?:e)?",
    "ceo", "cto", "cfo", "coo", "cmo", "dg", "pdg", "vp", "vice president",
    "consultant(?:e)?", "freelance", "independant(?:e)?", "auto entrepreneur(?:e)?", "entrepreneur(?:e|se)?",
    "self employed", "ingenieur(?:e)?", "developpeu(?:r|se)", "graphiste", "designer", "photographe",
    "coach", "format(?:eur|rice)", "assistant(?:e)?", "commercial(?:e)?",
  ].join("|") + ")\\b",
);

export function ressembleAUnPoste(texte: string): boolean {
  return MOTS_DE_POSTE.test(normaliser(texte));
}

/**
 * Sépare le poste et l'entreprise des deux morceaux d'un titre Google. `morceau` est celui
 * qui devrait porter l'entreprise : « CEO chez Acme » la contient, « Directrice marketing »
 * est un poste écrit à sa place.
 */
export function lirePosteEtEntreprise(
  poste: string | null,
  morceau: string | null,
): { role: string | null; company: string | null } {
  if (!morceau) return { role: poste, company: null };
  const ecrit = morceau.match(/^(.+?)\s+(?:chez|at|@)\s+(.+)$/i);
  if (ecrit) return { role: poste ?? ecrit[1].trim(), company: ecrit[2].trim() };
  if (ressembleAUnPoste(morceau)) return { role: poste ?? morceau, company: null };
  return { role: poste, company: morceau };
}

const FORMES_JURIDIQUES = /\b(?:sas|sasu|sarl|eurl|sa|sci|scop|snc|gmbh|ltd|limited|inc|llc|s a s|s a r l)\b/g;

/** Clé de comparaison d'un nom d'entreprise. `null` : ce nom ne désigne personne en particulier. */
export function cleEntreprise(nom: string | null | undefined): string | null {
  if (!nom || ressembleAUnPoste(nom)) return null;
  const cle = normaliser(nom).replace(FORMES_JURIDIQUES, " ").replace(/\s+/g, " ").trim();
  return cle.length >= 2 ? cle : null;
}

const MESSAGERIES_PUBLIQUES = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "mac.com", "orange.fr", "wanadoo.fr", "free.fr",
  "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "protonmail.com", "proton.me", "gmx.fr", "gmx.com", "aol.com",
]);

/** Domaine d'une adresse, s'il désigne une entreprise et non une messagerie grand public. */
export function domaineProfessionnel(email: string | null | undefined): string | null {
  const domaine = email?.trim().toLowerCase().split("@")[1];
  return domaine && domaine.includes(".") && !MESSAGERIES_PUBLIQUES.has(domaine) ? domaine : null;
}

export interface ProspectEntreprise {
  company?: string | null;
  email?: string | null;
}

/** Deux fiches parlent-elles de la même entreprise ? Même domaine d'adresse, ou même nom. */
export function memeEntreprise(a: ProspectEntreprise, b: ProspectEntreprise): boolean {
  const domaine = domaineProfessionnel(a.email);
  if (domaine && domaine === domaineProfessionnel(b.email)) return true;
  const cle = cleEntreprise(a.company);
  return !!cle && cle === cleEntreprise(b.company);
}

/** Le poste ou l'entreprise contient-il une exclusion du profil cible, en mots entiers ? */
export function correspondAUneExclusion(
  lead: { role?: string | null; company?: string | null },
  exclusions: string[],
): boolean {
  const texte = ` ${normaliser([lead.role, lead.company].filter(Boolean).join(" "))} `;
  return exclusions.some((exclusion) => {
    const mot = normaliser(exclusion);
    return !!mot && texte.includes(` ${mot} `);
  });
}
