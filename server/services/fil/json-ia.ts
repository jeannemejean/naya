// Lecture des réponses de l'IA du fil (étapes, reprises, posts de présence).

/** Le premier objet JSON du texte, ou undefined. */
export function jsonDe(texte: string): unknown {
  const bloc = texte.match(/\{[\s\S]*\}/)?.[0];
  if (!bloc) return undefined;
  try { return JSON.parse(bloc); } catch { return undefined; }
}
