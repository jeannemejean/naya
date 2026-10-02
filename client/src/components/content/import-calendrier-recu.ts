// Construction du reçu affiché après un import de calendrier réussi (Tâche 6).
//
// PUR — aucun accès réseau, aucun JSX — pour rester testable en environnement `node` sans
// jsdom (ce dépôt n'en a pas, voir le commentaire de `@/lib/one-shot-guard`). Le composant
// `import-calendrier.tsx` ne fait qu'appeler `construireRecu` et afficher les lignes.
// `date-fns/format` et sa locale `fr` sont des fonctions PURES (pas de DOM) : les importer
// ici ne casse pas cette garantie.
//
// Le reçu est un CONSTAT ponctuel, jamais un compteur ni une série : chaque ligne décrit ce
// qui vient de se passer pour CE collage, rien de cumulatif. Aucune ligne à zéro — « 0 post
// ignoré » est du bruit — sauf les deux premières, qui restent la tête du reçu même à zéro
// (un import qui n'a rien trouvé reste un résultat qu'il faut pouvoir lire).
import { format } from "date-fns/format";
import { fr } from "date-fns/locale/fr";

/** Forme du 200 de `POST /api/content/import`, réduite à ce que le reçu affiche. */
export interface ReponseImportCalendrier {
  posts: Array<{ scheduledFor: string | Date | null }>;
  ignores: number;
  couverture: number; // entier 0-100, déjà borné côté serveur
  /** `true` quand le modèle a probablement réécrit le texte au lieu de l'extraire. */
  reecrit: boolean;
  tronque: boolean;
  // Forme EXACTE de `CollisionLot` (server/services/brand-links/collision.ts), réduite à
  // ce que le reçu affiche : `nouveauId`/`contenuId` ne servent à rien ici, le reçu ne
  // désigne pas un post par son identifiant technique.
  collisions: Array<{ marque: string; scheduledFor: string | Date | null; pourquoi: string }>;
}

/** Accord simple singulier/pluriel sur un compte — ce dépôt n'a pas de pluriel i18n ici
 * (le reçu est construit en français brut, voir le commentaire de tête), donc la règle vit
 * ici plutôt que dans une clé de traduction. */
function accorder(n: number, singulier: string, pluriel: string): string {
  return n === 1 ? singulier : pluriel;
}

/** Plafond de lignes de détail des recoupements affichées dans le reçu — le reste se
 * résume en une ligne de compte, jamais en silence. */
const PLAFOND_LIGNES_COLLISION = 3;

/**
 * Une ligne de détail pour UN recoupement, alignée mot pour mot sur `messageCollision`
 * (client/src/pages/content-calendar.tsx) : même gabarit de phrase, pour que le chemin
 * mono-post (programmation d'un seul contenu) et le chemin en lot (cet import) disent la
 * même chose de la même façon.
 */
function ligneCollision(c: { marque: string; scheduledFor: string | Date | null; pourquoi: string }): string {
  const d = c.scheduledFor ? new Date(c.scheduledFor) : null;
  const dateLisible = d && !isNaN(d.getTime()) ? format(d, "d MMMM", { locale: fr }) : null;
  const lieu = dateLisible ? `le ${dateLisible} sur « ${c.marque.trim()} »` : `sur « ${c.marque.trim()} »`;
  return `Un contenu déjà programmé ${lieu} couvre un angle proche : ${c.pourquoi.trim()}`;
}

/**
 * Rend les lignes du reçu, dans l'ordre d'affichage. Chaque ligne conditionnelle
 * (ignorés, collisions, tronqué) n'apparaît que si son compte est strictement positif.
 */
export function construireRecu(reponse: ReponseImportCalendrier): string[] {
  const total = reponse.posts.length;
  const dates = reponse.posts.filter((p) => p.scheduledFor !== null).length;
  const enReserve = total - dates;

  const lignes: string[] = [];

  // DEUX lignes, jamais soudées en une seule : le nombre de posts CRÉÉS et la
  // couverture du texte LU sont deux faits indépendants. `couverture` mesure ce qui a
  // été repris du texte collé, AVANT que les doublons soient ignorés — si 14 posts sur
  // 16 ont été ignorés comme déjà présents, les 2 posts créés ne couvrent pas 95 % de
  // quoi que ce soit ; c'est le texte LU, dans son ensemble, qui l'est. Les souder («
  // 2 posts créés, couvrant environ 95 % de ton texte ») laisserait croire que les 2
  // posts créés représentent 95 % du texte collé, ce qui serait faux dans ce cas.
  lignes.push(`${total} ${accorder(total, "post créé", "posts créés")}.`);
  lignes.push(`Ton texte a été repris à environ ${reponse.couverture} %.`);

  // Décompose plus loin : n'a de sens que s'il y a au moins un post à répartir.
  if (total > 0) {
    lignes.push(
      `${dates} ${accorder(dates, "est daté", "sont datés")}, ${enReserve} ${accorder(enReserve, "est en réserve", "sont en réserve")}.`,
    );
  }

  if (reponse.ignores > 0) {
    lignes.push(
      `${reponse.ignores} ${accorder(
        reponse.ignores,
        "post était déjà présent, ignoré",
        "posts étaient déjà présents, ignorés",
      )}.`,
    );
  }

  // Comme `messageCollision` (chemin mono-post) : un recoupement dont le `pourquoi` est
  // vide n'est JAMAIS affiché — une phrase à moitié vraie ("ça recoupe quelque chose,
  // mais on ne sait pas quoi") est pire que son absence. Le filtre s'applique AVANT le
  // plafond ET avant le compte restant, pour qu'un recoupement invisible ne soit jamais
  // compté dans "et N autres".
  const collisionsAffichables = reponse.collisions.filter((c) => c.pourquoi.trim().length > 0);
  if (collisionsAffichables.length > 0) {
    const affichees = collisionsAffichables.slice(0, PLAFOND_LIGNES_COLLISION);
    for (const c of affichees) lignes.push(ligneCollision(c));

    const restant = collisionsAffichables.length - affichees.length;
    if (restant > 0) {
      lignes.push(
        `Et ${restant} ${accorder(restant, "autre recoupement du même type", "autres recoupements du même type")}.`,
      );
    }
  }

  if (reponse.reecrit) {
    lignes.push("Naya a probablement reformulé ton texte au lieu de le recopier : vérifie quelques posts.");
  }

  if (reponse.tronque) {
    lignes.push("Ton texte était trop long pour un seul passage : une partie n'a pas été lue.");
  }

  return lignes;
}
