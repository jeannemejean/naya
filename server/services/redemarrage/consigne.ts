// La consigne ajoutée au chat pendant une séance de redémarrage : le bilan du SEUL projet courant
// et la façon de mener l'échange. Rien d'un autre projet n'y figure.
import type { SeanceRedemarrage } from "@shared/schema";
import type { BilanSilencieux } from "./bilan";

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

export function consigneSeance(s: SeanceRedemarrage): string {
  const bilan = s.bilan as BilanSilencieux;
  const projets = (s.projets ?? []) as Array<{ projectId: number }>;
  const p = bilan.projets.find((x) => x.projectId === s.projetCourant);
  if (!p) return "";
  const rang = projets.findIndex((x) => x.projectId === p.projectId) + 1;
  const lignes = [
    `## Séance de redémarrage en cours : projet ${rang} sur ${projets.length}, « ${p.nom} » (projectId ${p.projectId})`,
    `L'utilisatrice revient après une absence (depuis le ${dateFr(bilan.depuis)}). Vous faites le point ensemble, projet par projet, pour que Naya reflète où elle en est vraiment.`,
    "",
    "Ce que Naya sait déjà de ce projet (ne le demande JAMAIS) :",
    `- Statut : ${p.statut}. Note actuelle : ${p.noteActuelle ? `« ${p.noteActuelle} »` : "aucune"}.`,
    `- Dernière tâche faite : ${p.derniereTacheFaite ? dateFr(p.derniereTacheFaite) : "aucune connue"}.`,
    `- Posts prévus sur la période : ${p.postsPrevus}, publiés : ${p.postsPublies}.`,
    p.tachesEnRetard.length
      ? `- Tâches en retard (id : titre, date) :\n${p.tachesEnRetard.map((t) => `  - ${t.id} : ${t.titre} (${t.date})`).join("\n")}`
      : "- Aucune tâche en retard.",
    p.creneaux.length ? `- Créneaux réguliers : ${p.creneaux.map((c) => `${c.id} « ${c.titre} » (${c.rythme})`).join(" ; ")}.` : "- Aucun créneau régulier.",
    p.envoisEnCours.length ? `- Envois en attente : ${p.envoisEnCours.map((e) => `${e.marque} (${e.objet})`).join(" ; ")}.` : "",
    "",
    "Comment mener ce projet :",
    "1. Si ce n'est pas déjà fait dans la conversation, résume en 2 ou 3 lignes ce que tu sais, puis demande où elle en est vraiment. Une seule question ouverte.",
    "2. Au plus 2 questions de relance, et seulement si un trou important reste. C'est rapide : pas d'interrogatoire.",
    "3. Repère le travail qu'elle fait hors de Naya (avec d'autres outils, de façon répétée) : propose un créneau régulier pour lui faire de la place (creer_creneau, avec intervalWeeks si c'est toutes les deux semaines, par exemple).",
    "4. Si elle a présenté un projet à une marque, note l'envoi (creer_envoi) avec une date de relance (par défaut 7 jours après l'envoi).",
    "5. Appelle alors proposer_bilan_projet avec TOUS les changements de ce projet : tâches faites (cocher_tache) ou abandonnées (archiver_tache), note réécrite à partir de son récit (note_projet), statut si elle le dit, créneaux, envois, prochaines étapes (creer_tache). Elle validera tout ou ligne par ligne.",
    "6. Si elle veut passer ce projet sans rien changer, appelle passer_projet.",
    "N'invente rien : ce qu'elle n'a pas dit ne devient pas un changement.",
  ];
  return lignes.filter((l) => l !== "").join("\n");
}

/** Consigne du dernier message, quand la séance vient de se terminer. */
export function consigneFinSeance(s: SeanceRedemarrage): string {
  return [
    "## Séance de redémarrage terminée",
    "Écris le récap, court et concret :",
    "1. L'évaluation des réseaux ci-dessous : publié ou non par rapport à ce qui était prévu, puis les chiffres disponibles. Ne jamais inventer un chiffre absent ; dis clairement ce qui manque et pourquoi (codes dans « limites »).",
    "2. Ce que tu as compris de sa façon de travailler (le travail fait hors de Naya, les créneaux ajoutés, les envois suivis).",
    "3. Une phrase sur la semaine qui vient.",
    `Évaluation des réseaux (JSON) : ${JSON.stringify(s.evaluation ?? null)}`,
  ].join("\n");
}
