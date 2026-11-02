// Outils de lecture de l'agent (« tout savoir ») : chercher dans tout ce que l'utilisatrice a
// écrit ou reçu, puis lire un élément en entier. Toujours bornés à ctx.userId (la session),
// jamais à un identifiant fourni par le modèle.
import { chercher, lire, SOURCES, type FiltresRecherche, type SourceRecherche } from "../recherche";
import type { Outil } from "../registre";

const LECTURE_MAX = 20000; // caractères rendus par `lire` (une réponse de tâche, un livrable…)

// Libellé lisible d'une recherche, montré sous la réponse (« où l'agent a cherché »).
export function libelleRecherche(requete: string, filtres: FiltresRecherche): string {
  const morceaux = [`« ${requete} »`];
  if (filtres.projetId !== undefined) morceaux.push(`projet n°${filtres.projetId}`);
  if (filtres.depuis && filtres.jusqua) morceaux.push(`du ${filtres.depuis} au ${filtres.jusqua}`);
  else if (filtres.depuis) morceaux.push(`depuis le ${filtres.depuis}`);
  else if (filtres.jusqua) morceaux.push(`jusqu'au ${filtres.jusqua}`);
  if (filtres.sources?.length) morceaux.push(`dans : ${filtres.sources.join(", ")}`);
  return morceaux.join(" · ");
}

const chercherOutil: Outil = {
  nom: "chercher",
  classe: "lecture",
  description:
    "Cherche, par sens et par mots, dans tout ce que l'utilisatrice a écrit ou reçu : réponses dans " +
    "les tâches, livrables, notes et captures, mémoire, conversations avec toi, contenus, tâches, " +
    "réponses de prospects. Filtres facultatifs : projet, période, types de source. Chaque résultat " +
    "donne la source, l'id (pour `lire`), la date, le titre, le projet et un extrait. " +
    "Appelle-le avant de dire que tu ne trouves pas quelque chose.",
  schema: {
    type: "object",
    properties: {
      requete: { type: "string", description: "Ce qu'on cherche, en mots simples (noms propres, sujet, terme exact)." },
      projetId: { type: "integer", description: "Id d'un projet pour limiter la recherche à ce projet." },
      depuis: { type: "string", description: "Date de début incluse, AAAA-MM-JJ." },
      jusqua: { type: "string", description: "Date de fin incluse, AAAA-MM-JJ." },
      sources: {
        type: "array",
        items: { type: "string", enum: SOURCES },
        description: "Types de source à fouiller (tous par défaut).",
      },
    },
    required: ["requete"],
  },
  async executer(ctx, args) {
    const filtres: FiltresRecherche = {};
    if (args.projetId !== undefined && args.projetId !== null) filtres.projetId = args.projetId;
    if (args.depuis) filtres.depuis = args.depuis;
    if (args.jusqua) filtres.jusqua = args.jusqua;
    if (Array.isArray(args.sources) && args.sources.length > 0) filtres.sources = args.sources as SourceRecherche[];
    const requete = String(args.requete).trim();

    const trouvailles = await chercher(ctx.userId, requete, filtres);
    return {
      pourModele: {
        trouvailles: trouvailles.map((t) => ({
          source: t.source, id: t.id, date: t.date.slice(0, 10), titre: t.titre, projet: t.projet, extrait: t.extrait,
        })),
        ...(trouvailles.length === 0 ? { note: "Aucun résultat. Essaie d'autres mots, ou élargis la période." } : {}),
      },
      recherche: libelleRecherche(requete, filtres),
    };
  },
};

const lireOutil: Outil = {
  nom: "lire",
  classe: "lecture",
  description:
    "Lit en entier un élément trouvé par `chercher` (réponse de tâche, livrable, note, conversation…), " +
    "à partir de sa source et de son id.",
  schema: {
    type: "object",
    properties: {
      source: { type: "string", enum: SOURCES, description: "La source donnée par `chercher`." },
      id: { type: "integer", description: "L'id donné par `chercher`." },
    },
    required: ["source", "id"],
  },
  async executer(ctx, args) {
    const lecture = await lire(ctx.userId, args.source as SourceRecherche, args.id);
    if (!lecture) return { pourModele: { erreur: "introuvable" } };
    const tronque = lecture.contenu.length > LECTURE_MAX;
    return {
      pourModele: {
        ...lecture,
        contenu: tronque ? lecture.contenu.slice(0, LECTURE_MAX) : lecture.contenu,
        ...(tronque ? { note: `Contenu coupé à ${LECTURE_MAX} caractères sur ${lecture.contenu.length}.` } : {}),
      },
    };
  },
};

export const OUTILS_LECTURE: Outil[] = [chercherOutil, lireOutil];
