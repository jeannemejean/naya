import type { Saison } from "@shared/saisons";

const NOM: Record<Saison, string> = { automne: "automne", hiver: "hiver", printemps: "printemps", ete: "été" };

// Longueur totale du mot du matin : l'accueil le coupe à 3 lignes, au-delà il finirait en « … ».
export const LONGUEUR_MAX_MOT = 140;

// Consigne ajoutée au prompt du brief : la saison reste une touche, jamais un cliché.
// Pas de salutation : l'écran affiche déjà « Bonjour {prénom}. ».
export function consigneMotDuMatin(saison: Saison): string {
  return `MOT DU MATIN : nous sommes en ${NOM[saison]}. Tu peux l'évoquer en une touche légère, jamais en cliché. `
    + `Le champ "greeting" fait 2 phrases au plus et ${LONGUEUR_MAX_MOT} caractères au plus au total, espaces compris, `
    + `sans aucune formule de salutation (pas de « Bonjour », pas de « Salut ») : l'écran l'affiche déjà.`;
}

// Phrases de secours (IA indisponible), dans la voix de Naya : directes, au tutoiement.
const SECOURS: Record<Saison, { normal: string; bas: string; epuise: string }> = {
  automne: {
    normal: "L'automne s'installe. Pose ce qui compte aujourd'hui, le reste attendra.",
    bas: "Journée au ralenti, comme l'automne le permet. Une chose importante suffit.",
    epuise: "Aujourd'hui, avance doucement. Le repos fait partie du travail.",
  },
  hiver: {
    normal: "L'hiver invite à resserrer. Choisis l'essentiel et tiens-le.",
    bas: "Il fait court dehors, tu peux faire court aussi. Une seule priorité.",
    epuise: "Prends le repos dont tu as besoin. Tu repartiras doucement demain.",
  },
  printemps: {
    normal: "Ça repart dehors, et toi aussi. Lance ce qui attendait depuis un moment.",
    bas: "Tout n'a pas à fleurir aujourd'hui. Avance sur une seule chose.",
    epuise: "Pas besoin de pousser. Un peu de repos, et tu reprends doucement.",
  },
  ete: {
    normal: "Les journées sont longues, profites-en. Garde ton élan pour le plus important.",
    bas: "Rythme d'été : tu peux avancer à ton pas. Une chose, bien faite.",
    epuise: "Aujourd'hui, repos. Rien ne brûle, tu reprendras doucement.",
  },
};

export function phraseDeSecours(energie: string | null | undefined, saison: Saison): string {
  const s = SECOURS[saison];
  if (energie === "depleted") return s.epuise;
  if (energie === "low") return s.bas;
  return s.normal;
}
