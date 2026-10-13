// Répartition en colonnes des éléments d'une journée (tâches et rendez-vous). Deux éléments
// qui se touchent À L'ÉCRAN — même seulement par la hauteur minimale d'une carte — sont posés
// côte à côte, jamais l'un sur l'autre. Le planning ne doit pas créer de chevauchement ; ce
// filet couvre ce qui ne dépend pas de lui (deux rendez-vous de l'agenda à la même heure).

export interface ElementJournee { id: number; debut: number; fin: number }

export function voiesPlanning(elements: ElementJournee[]): Map<number, { voie: number; total: number }> {
  const tries = [...elements].sort((a, b) => a.debut - b.debut || b.fin - a.fin || a.id - b.id);
  const resultat = new Map<number, { voie: number; total: number }>();
  let groupe: Array<{ id: number; voie: number }> = [];
  let finGroupe = -Infinity;
  let finsVoies: number[] = [];

  const clore = () => {
    const total = Math.max(1, finsVoies.length);
    for (const g of groupe) resultat.set(g.id, { voie: g.voie, total });
    groupe = [];
    finsVoies = [];
  };

  for (const e of tries) {
    if (e.debut >= finGroupe) { clore(); finGroupe = -Infinity; }
    let voie = finsVoies.findIndex((fin) => fin <= e.debut);
    if (voie === -1) { voie = finsVoies.length; finsVoies.push(e.fin); } else finsVoies[voie] = e.fin;
    groupe.push({ id: e.id, voie });
    finGroupe = Math.max(finGroupe, e.fin);
  }
  clore();
  return resultat;
}
