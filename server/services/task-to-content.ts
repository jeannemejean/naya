/**
 * Transformation d'une note d'espace de travail en ligne du calendrier de contenu. PURE.
 *
 * La table `content` impose `title`, `body`, `platform`, `contentType`, `pillar` et `goal`,
 * tous NOT NULL. Une note d'espace de travail n'en porte que deux : le texte écrit et son
 * titre. Les quatre autres manquent.
 *
 * Arbitrage de Jeanne (2026-09-16) : Naya les déduit, plutôt que d'ajouter un formulaire au
 * moment du clic. Le corollaire est qu'elle se trompera, et que les champs devinés doivent
 * se signaler — d'où `deducedFields`, renseignée ici et par personne d'autre.
 */

/** Les seuls champs que la déduction a le droit de fournir. */
export const CHAMPS_DEDUCTIBLES = ["platform", "contentType", "pillar", "goal"] as const;

export type ChampDeductible = (typeof CHAMPS_DEDUCTIBLES)[number];

/**
 * Valeur écrite quand la déduction n'a rien rendu d'exploitable pour un champ obligatoire.
 *
 * Écrire « à préciser » plutôt qu'un pilier plausible est délibéré : un pilier plausible ne
 * se remarque pas. Il s'installe dans les statistiques d'attribution et les fausse sans que
 * rien ne le signale. Une valeur qui se lit comme un trou reste un trou.
 */
export const VALEUR_A_PRECISER = "à préciser";

export interface TachePourContenu {
  id: number;
  projectId: number | null;
  type: string | null;
  title: string;
}

export interface NotePourContenu {
  title: string;
  content: string;
}

export interface LigneContenu {
  projectId: number | null;
  title: string;
  body: string;
  platform: string;
  contentType: string;
  pillar: string;
  goal: string;
  status: string;
  /** Voir shared/schema.ts : `[]` = routage effectué sans rien deviner, jamais `null` ici. */
  deducedFields: string[];
  sourceTaskId: number;
}

export interface ResultatConstruction {
  /** `null` quand il n'y a rien à écrire — une note vide ne crée aucun contenu. */
  ligne: LigneContenu | null;
}

/** Une valeur déduite ne compte que si elle porte autre chose que du blanc. */
function exploitable(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function construireContenuDepuisTache(input: {
  tache: TachePourContenu;
  note: NotePourContenu;
  deduit: Partial<Record<ChampDeductible, unknown>>;
}): ResultatConstruction {
  const { tache, note, deduit } = input;

  // Une note blanche ne produit rien. Sans ce garde, cliquer sur Enregistrer sans avoir
  // écrit créerait un contenu vide dans le calendrier.
  if (!note.content.trim()) return { ligne: null };

  const champs: Record<ChampDeductible, string> = {
    platform: "",
    contentType: "",
    pillar: "",
    goal: "",
  };
  const deduits: string[] = [];

  // On n'itère que sur CHAMPS_DEDUCTIBLES : une clé inventée par le modèle est ignorée
  // plutôt que recopiée vers une colonne qui n'existe pas.
  for (const champ of CHAMPS_DEDUCTIBLES) {
    const valeur = deduit[champ];
    champs[champ] = exploitable(valeur) ? valeur.trim() : VALEUR_A_PRECISER;
    // Le champ est marqué dans les DEUX cas : une valeur devinée par le modèle est une
    // supposition, et un « à préciser » aussi. Ce qui n'est pas marqué vient de l'humaine.
    deduits.push(champ);
  }

  return {
    ligne: {
      projectId: tache.projectId,
      // Le titre vient de la note, sinon de la tâche. Les deux sont écrits par
      // l'utilisatrice : reprendre le titre de la tâche n'est pas une supposition, et le
      // marquer « déduit » diluerait le sens du marqueur.
      title: note.title.trim() || tache.title,
      body: note.content,
      platform: champs.platform,
      contentType: champs.contentType,
      pillar: champs.pillar,
      goal: champs.goal,
      // Demande de Jeanne : « à l'endroit des posts rédigés mais qui ne sont pas terminés ».
      status: "draft",
      deducedFields: deduits,
      sourceTaskId: tache.id,
    },
  };
}
