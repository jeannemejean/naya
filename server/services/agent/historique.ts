// Historique du companion : on signale à l'agent les actions que l'utilisatrice a annulées
// depuis (sinon il croit qu'une tâche annulée existe encore). Le client n'envoie que du texte :
// on retrouve les messages sauvegardés par leur contenu, puis UNE requête pour tous les ids.
export interface Tour { role: "user" | "assistant"; content: string }
interface Sauvegarde { role: string; content: string; actions?: unknown }

export interface SourcesHistorique {
  sauvegardes: (userId: string) => Promise<Sauvegarde[]>;
  annulees: (userId: string, ids: number[]) => Promise<{ id: number; resume: string }[]>;
}

function idsDesActions(actions: unknown): number[] {
  const faites = (actions as any)?.faites;
  if (!Array.isArray(faites)) return [];
  return faites.map((f: any) => f?.actionId).filter((n: unknown): n is number => Number.isInteger(n));
}

export async function annoterHistorique(userId: string, historique: Tour[], src: SourcesHistorique): Promise<Tour[]> {
  if (!historique.some((t) => t.role === "assistant")) return historique;
  const sauvegardes = (await src.sauvegardes(userId)).filter((m) => m.role === "assistant" && idsDesActions(m.actions).length > 0);
  if (sauvegardes.length === 0) return historique;

  // Chaque tour assistant du client prend la sauvegarde la plus récente de même contenu non encore utilisée.
  const restantes = [...sauvegardes];
  const idsParTour = new Map<number, number[]>();
  for (let i = historique.length - 1; i >= 0; i--) {
    if (historique[i].role !== "assistant") continue;
    const k = restantes.map((m) => m.content.trim()).lastIndexOf(historique[i].content.trim());
    if (k >= 0) idsParTour.set(i, idsDesActions(restantes.splice(k, 1)[0].actions));
  }
  const tous = Array.from(new Set(Array.from(idsParTour.values()).flat()));
  if (tous.length === 0) return historique;
  const annulees = new Map((await src.annulees(userId, tous)).map((a) => [a.id, a.resume]));
  if (annulees.size === 0) return historique;

  return historique.map((t, i) => {
    const notes = (idsParTour.get(i) ?? []).filter((id) => annulees.has(id))
      .map((id) => noteAnnulation(annulees.get(id)!));
    return notes.length ? { ...t, content: `${t.content}\n${notes.join("\n")}` } : t;
  });
}

export const noteAnnulation = (resume: string) => `(Annulé ensuite par l'utilisatrice : ${resume})`;

// Pour des messages sauvegardés : ids d'actions annulées -> notes, par position. Une seule requête.
export async function notesPourMessages(
  userId: string,
  messages: { actions?: unknown }[],
  annulees: SourcesHistorique["annulees"],
): Promise<string[][]> {
  const idsParMessage = messages.map((m) => idsDesActions(m.actions));
  const tous = Array.from(new Set(idsParMessage.flat()));
  if (tous.length === 0) return messages.map(() => []);
  const resumes = new Map((await annulees(userId, tous)).map((a) => [a.id, a.resume]));
  return idsParMessage.map((ids) => ids.filter((id) => resumes.has(id)).map((id) => noteAnnulation(resumes.get(id)!)));
}

// Historique du modèle construit depuis les messages SAUVEGARDÉS (pas depuis le texte du client :
// il est vide après un rechargement), chaque tour assistant annoté des actions annulées depuis.
export async function historiqueSauvegarde(
  userId: string,
  sauvegardes: (Sauvegarde & { role: string; content: string })[],
  annulees: SourcesHistorique["annulees"],
): Promise<Tour[]> {
  const tours = sauvegardes.filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim());
  const notes = await notesPourMessages(userId, tours, annulees);
  return tours.map((m, i) => ({
    role: m.role as Tour["role"],
    content: notes[i].length ? `${m.content}\n${notes[i].join("\n")}` : m.content,
  }));
}
