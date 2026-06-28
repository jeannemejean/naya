// Résolution de la MARQUE-SUJET d'une conversation, pour le routage de mémoire.
// Règle d'or (BRIEF-FIX-ROUTAGE-MARQUE) : aucun fait d'ADN sous une marque NON CONFIRMÉE.
// On route silencieusement SEULEMENT si UNE seule marque connue est clairement nommée ;
// sinon (0 ou >1) → ambigu → projectId null (le Companion demandera, l'extraction saute).

export interface ProjectRef { id: number; name: string }

// Normalisation : minuscules, sans accents, espaces compactés.
export function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les diacritiques (combining marks)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Un nom est "matchable" (assez distinctif pour router en silence) si :
//  - il a au moins 2 mots (ex. "Encore Merci", "Test Jalons"), OU
//  - c'est un seul mot d'au moins 5 caractères.
// → exclut les noms courts/génériques d'un seul mot ("Naya", "Test") qui matcheraient
//   par accident un mot courant de la phrase. Dans le doute, on préfère DEMANDER.
export function isMatchable(name: string): boolean {
  const n = normalize(name);
  if (!n) return false;
  const words = n.split(" ").filter(Boolean);
  if (words.length >= 2) return true;
  return words[0].length >= 5;
}

// Le nom apparaît-il comme phrase entière, en limite de mots, dans le texte normalisé ?
function namedIn(textNorm: string, nameNorm: string): boolean {
  if (!nameNorm) return false;
  const esc = nameNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // limites de mots manuelles (après normalisation, le texte est essentiellement [a-z0-9])
  const re = new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`, "i");
  return re.test(textNorm);
}

export interface SubjectResolution {
  projectId: number | null;   // la marque-sujet, ou null si ambigu (0 ou >1)
  matched: string[];          // noms de marques détectées (audit)
  ambiguous: boolean;         // true si 0 ou >1 marque nommée
}

// Résout la marque-sujet à partir du texte (message courant + historique concaténés)
// et de la liste des projets de l'utilisateur. Silencieux SI exactement une marque
// matchable est nommée ; sinon ambigu (null).
export function resolveSubjectBrand(text: string, projects: ProjectRef[]): SubjectResolution {
  const tn = normalize(text);
  const matchedIds = new Set<number>();
  const matchedNames: string[] = [];
  for (const p of projects || []) {
    if (!isMatchable(p.name)) continue;
    if (namedIn(tn, normalize(p.name))) {
      if (!matchedIds.has(p.id)) { matchedIds.add(p.id); matchedNames.push(p.name); }
    }
  }
  if (matchedIds.size === 1) {
    return { projectId: Array.from(matchedIds)[0], matched: matchedNames, ambiguous: false };
  }
  return { projectId: null, matched: matchedNames, ambiguous: true };
}

// Décide le projectId d'une entrée de mémoire selon son fil et la marque-sujet résolue.
//  - founder            → transverse (null), JAMAIS de question.
//  - cap / reception     → la marque-sujet résolue ; si absente → on SAUTE (jamais le
//                          projet actif deviné).
export function resolveEntryProjectId(
  fil: string,
  subjectProjectId: number | null | undefined,
): { projectId: number | null; skip: boolean } {
  if (fil === "founder") return { projectId: null, skip: false };
  // cap / reception : spécifique à une marque → exige une marque-sujet confirmée.
  if (subjectProjectId == null) return { projectId: null, skip: true };
  return { projectId: subjectProjectId, skip: false };
}
