// Texte du geste « rejeter une campagne » (chantier 2026-10-02-naya-rejeter-campagne,
// tâche 5) — la seule partie de ce chantier que l'utilisatrice voit, pour une action
// DESTRUCTRICE ET IRRÉVERSIBLE : ce que l'écran annonce avant confirmation doit être
// EXACTEMENT ce que le serveur va faire, ni plus ni moins.
//
// PUR — aucun accès réseau, aucun JSX — pour rester testable en environnement `node` sans
// jsdom (ce dépôt n'en a pas, voir le commentaire de `@/lib/one-shot-guard`). Le composant
// `campaigns.tsx` ne fait qu'appeler ces fonctions et afficher leur résultat ; il ne
// recalcule jamais lui-même un compte déjà rendu par le serveur.
//
// Toutes les chaînes visibles de ce geste (libellés de bouton, titre de dialogue,
// placeholder) vivent aussi ici, en constantes exportées, et pas en texte littéral dans
// `campaigns.tsx` : la garde à cliquet `locales/jsx-guard.test.ts` interdit tout nouveau
// texte en dur DANS LE JSX de ce fichier (sa référence est déjà consommée) — un fichier
// `.ts` pur n'est pas scanné (`jsx-scan.ts` ne regarde que les `.tsx`), donc c'est ici,
// et seulement ici, que ce texte peut être écrit.

/** Forme du 200 de `GET /api/campaigns/:id/reject-preview` — des COMPTES, jamais des
 *  listes d'identifiants (le serveur ne rend jamais les identifiants eux-mêmes). */
export interface ApercuRejet {
  contenusGardes: number;
  contenusPartants: number;
  tachesGardees: number;
  tachesPartantes: number;
  articulationsRompues: ArticulationRompue[];
  /** Campagnes de prospection emportées par ce rejet (volet serveur de ce chantier) —
   *  leur mécanique de séquence s'arrête. Les prospects eux-mêmes ne disparaissent pas,
   *  voir `prospectsAArchiver`. */
  prospectionLiee: ProspectionLiee[];
  /** Nombre de prospects ARCHIVÉS par ce rejet, jamais supprimés — réversible. Un total à
   *  travers toutes les `prospectionLiee`, pas une décomposition par campagne. */
  prospectsAArchiver: number;
}

export interface ArticulationRompue {
  campagneId: number;
  campagneNom: string;
  marque: string;
}

export interface ProspectionLiee {
  id: number;
  name: string;
}

/** Forme du 200 de `POST /api/campaigns/:id/reject`. */
export interface ResultatRejet {
  contenusDetaches: number;
  contenusSupprimes: number;
  tachesDetachees: number;
  tachesSupprimees: number;
  preferenceEcrite: boolean;
  /** Information d'EXPLOITATION, déjà dans le journal serveur — jamais montrée à
   *  l'utilisatrice (voir `construireMessageSucces`). Le champ reste ici pour que le
   *  type colle au contrat de l'endpoint, pas pour être lu côté écran. */
  preferenceSansEmbedding: boolean;
  articulationsRompues: ArticulationRompue[];
}

// ─── Libellés de l'écran ────────────────────────────────────────────────────────────
// Ton : factuel, sans point d'exclamation, sans félicitation, sans injonction.

export const LIBELLE_BOUTON_REJETER = "Rejeter la campagne";
export const TITRE_DIALOGUE_REJET = "Rejeter cette campagne";
export const LABEL_CHAMP_RAISON = "Raison (facultative)";
export const PLACEHOLDER_CHAMP_RAISON = "Ce qui n'allait pas, pour que Naya en tienne compte la prochaine fois";
export const LIBELLE_ANNULER = "Annuler";
export const LIBELLE_CONFIRMER_REJET = "Rejeter";
export const TITRE_REJET_REUSSI = "Campagne rejetée";
export const TITRE_REJET_ECHEC = "Rejet impossible";
export const TITRE_APERCU_ECHEC = "Aperçu indisponible";

/**
 * Message affiché sous le champ de raison quand il est vide (Décision 4 du spec) :
 * soit la raison apprend à Naya, soit l'écran dit explicitement qu'elle n'apprendra
 * rien de ce rejet — jamais de demi-mesure silencieuse. `null` dès qu'autre chose que
 * des espaces a été saisi.
 */
export function texteAvertissementRaisonVide(raison: string): string | null {
  if (raison.trim() !== "") return null;
  return "Sans raison, Naya ne pourra pas l'éviter la prochaine fois.";
}

/**
 * La raison appartient à LA CAMPAGNE pour laquelle elle a été écrite, jamais à « la
 * dernière campagne dont le dialogue était ouvert ». `campagnes.tsx` conserve désormais la
 * raison à travers un échec de rejet (pour ne jamais lui faire retaper un texte qu'elle a
 * peut-être mis du temps à formuler) — mais SANS cette fonction, cette conservation
 * traverserait aussi un changement de campagne : elle taperait une raison pour la campagne
 * de Jeanne, annulerait, ouvrirait le rejet de la campagne de l'Agence JMD, et la
 * retrouverait pré-remplie avec la phrase de Jeanne. Si elle confirme sans la relire, cette
 * phrase devient une préférence PERMANENTE écrite dans la mémoire de la MAUVAISE marque —
 * une corruption silencieuse que rien ne signale jamais, pire que perdre un texte qu'elle
 * devra retaper.
 *
 * Vrai si le dialogue s'ouvre sur une campagne différente de celle à laquelle la raison
 * actuellement tapée est rattachée (`raisonPourCampagneId`) — l'appelant doit alors remettre
 * la raison à zéro avant affichage. Faux quand c'est la MÊME campagne (retry après échec) :
 * c'est précisément le cas que la conservation doit continuer à couvrir.
 */
export function doitReinitialiserRaisonRejet(
  raisonPourCampagneId: number | null,
  campagneOuverteId: number | null,
): boolean {
  return raisonPourCampagneId !== campagneOuverteId;
}

// ─── Accord singulier/pluriel ───────────────────────────────────────────────────────

function accorder(n: number, singulier: string, pluriel: string): string {
  return n === 1 ? singulier : pluriel;
}

/** `null` quand `n` vaut 0 : une clause à zéro est du bruit (« 0 tâche sera
 *  supprimée »), jamais une information. C'est ce qui fait disparaître une ligne ou
 *  un membre de phrase entier plus bas, plutôt que d'écrire un zéro explicite. */
function clauseNombre(n: number, singulier: string, pluriel: string): string | null {
  if (n === 0) return null;
  return `${n} ${accorder(n, singulier, pluriel)}`;
}

/** Joint les clauses non nulles avec « et » ; `null` si aucune n'est présente — c'est
 *  ce `null` qui fait disparaître la ligne entière chez l'appelant. */
function joindre(clauses: Array<string | null>): string | null {
  const presentes = clauses.filter((c): c is string => c !== null);
  if (presentes.length === 0) return null;
  return presentes.join(" et ");
}

// ─── Les trois lignes de fait sur les posts/tâches ─────────────────────────────────

function ligneEntete(totalPosts: number, totalTaches: number): string | null {
  const joint = joindre([
    clauseNombre(totalPosts, "post", "posts"),
    clauseNombre(totalTaches, "tâche", "tâches"),
  ]);
  return joint ? `Cette campagne a ${joint}.` : null;
}

/** Les survivants : détachés de la campagne, jamais supprimés — c'est l'ordre 1 de
 *  `rejeterCampagne` (tâche 2), lu ici sans le recalculer. */
function ligneGardes(contenusGardes: number, tachesGardees: number): string | null {
  const joint = joindre([
    clauseNombre(contenusGardes, "post publié", "posts publiés"),
    clauseNombre(tachesGardees, "tâche faite", "tâches faites"),
  ]);
  if (!joint) return null;
  const total = contenusGardes + tachesGardees;
  const masculinPresent = contenusGardes > 0; // le masculin l'emporte dès qu'un post est présent, mélangé ou seul.
  const verbe =
    total === 1
      ? masculinPresent
        ? "sera conservé, détaché de la campagne."
        : "sera conservée, détachée de la campagne."
      : masculinPresent
        ? "seront conservés, détachés de la campagne."
        : "seront conservées, détachées de la campagne.";
  return `${joint} ${verbe}`;
}

/** Les partants : supprimés avec la campagne — ordre 2 de `rejeterCampagne`. */
function lignePartants(contenusPartants: number, tachesPartantes: number): string | null {
  const joint = joindre([
    clauseNombre(contenusPartants, "post", "posts"),
    clauseNombre(tachesPartantes, "tâche", "tâches"),
  ]);
  if (!joint) return null;
  const total = contenusPartants + tachesPartantes;
  const masculinPresent = contenusPartants > 0;
  const verbe =
    total === 1
      ? masculinPresent
        ? "sera supprimé."
        : "sera supprimée."
      : masculinPresent
        ? "seront supprimés."
        : "seront supprimées.";
  return `${joint} ${verbe}`;
}

// ─── Articulations rompues ──────────────────────────────────────────────────────────

/** Plafond de lignes détaillées — même motif que `PLAFOND_LIGNES_COLLISION` dans
 *  `content/import-calendrier-recu.ts` : au-delà, une ligne de compte, jamais le silence. */
const PLAFOND_LIGNES_ARTICULATION = 3;

function ligneArticulation(a: ArticulationRompue): string {
  const marque = a.marque.trim();
  const sur = marque ? ` sur ${marque}` : "";
  return `La campagne « ${a.campagneNom.trim()} »${sur} est articulée avec celle-ci — en la rejetant, cette articulation disparaît.`;
}

// ─── Prospection liée ───────────────────────────────────────────────────────────────
//
// Le volet serveur de ce chantier a rétabli la cascade : rejeter une campagne marketing
// emporte sa ou ses campagnes de prospection liées. Les prospects ne sont PAS supprimés —
// ils sont ARCHIVÉS, un état réversible — seule la mécanique de séquence part avec la
// campagne de prospection. Les deux mots comptent : ne jamais écrire « supprimés » pour
// les prospects, ce serait un énoncé faux, précisément le genre que ce chantier traque.

function ligneProspection(p: ProspectionLiee): string {
  const nom = p.name.trim();
  return `La campagne de prospection « ${nom} » liée à celle-ci sera elle aussi rejetée : sa mécanique de séquence s'arrête.`;
}

/** Une ligne par campagne de prospection liée, plafonnée comme les articulations
 *  (`PLAFOND_LIGNES_ARTICULATION`) — même motif, même plafond : au-delà, une ligne de
 *  compte réel restant, jamais le silence sur ce qui dépasse. */
function lignesProspection(prospectionLiee: ProspectionLiee[]): string[] {
  const lignes: string[] = [];
  const affichees = prospectionLiee.slice(0, PLAFOND_LIGNES_ARTICULATION);
  for (const p of affichees) lignes.push(ligneProspection(p));

  const restant = prospectionLiee.length - affichees.length;
  if (restant > 0) {
    lignes.push(
      `Et ${restant} ${accorder(restant, "autre campagne de prospection liée", "autres campagnes de prospection liées")} à celle-ci.`,
    );
  }
  return lignes;
}

/** Les prospects des campagnes de prospection emportées : ARCHIVÉS, jamais supprimés —
 *  c'est le mot qui doit apparaître ici, pas un synonyme qui suggérerait une perte
 *  définitive. `null` si aucun prospect n'est concerné (aucune ligne à zéro). */
function ligneProspectsArchives(prospectsAArchiver: number): string | null {
  const clause = clauseNombre(prospectsAArchiver, "prospect", "prospects");
  if (!clause) return null;
  const verbe = prospectsAArchiver === 1 ? "sera archivé." : "seront archivés.";
  return `${clause} ${verbe}`;
}

/**
 * Construit le texte de la confirmation de rejet, une ligne par fait, dans l'ordre
 * d'affichage. AUCUNE ligne à zéro : un fait dont le compte est nul n'est pas un fait
 * à annoncer, c'est du bruit qui dilue les faits réels. Lit `apercu` tel que rendu par
 * `GET /api/campaigns/:id/reject-preview` — AUCUN recompte : les mêmes fonctions de
 * tri (`trierContenus`/`trierTaches`, tâche 1) ont déjà produit ces comptes côté
 * serveur, et le rejet (`POST .../reject`) exécute le tri IDENTIQUE. Reconstruire le
 * compte ici créerait un second endroit où la décision pourrait diverger de ce qui
 * s'exécute réellement.
 */
export function construireTexteConfirmation(apercu: ApercuRejet): string[] {
  const lignes: string[] = [];

  const entete = ligneEntete(
    apercu.contenusGardes + apercu.contenusPartants,
    apercu.tachesGardees + apercu.tachesPartantes,
  );
  if (entete) lignes.push(entete);

  const gardes = ligneGardes(apercu.contenusGardes, apercu.tachesGardees);
  if (gardes) lignes.push(gardes);

  const partants = lignePartants(apercu.contenusPartants, apercu.tachesPartantes);
  if (partants) lignes.push(partants);

  const articulations = apercu.articulationsRompues;
  const affichees = articulations.slice(0, PLAFOND_LIGNES_ARTICULATION);
  for (const a of affichees) lignes.push(ligneArticulation(a));

  const restant = articulations.length - affichees.length;
  if (restant > 0) {
    lignes.push(
      `Et ${restant} ${accorder(restant, "autre campagne articulée", "autres campagnes articulées")} avec celle-ci.`,
    );
  }

  for (const ligne of lignesProspection(apercu.prospectionLiee)) lignes.push(ligne);

  const archives = ligneProspectsArchives(apercu.prospectsAArchiver);
  if (archives) lignes.push(archives);

  return lignes;
}

// ─── Le constat après un rejet réussi ───────────────────────────────────────────────

function phraseDetaches(contenusDetaches: number, tachesDetachees: number): string | null {
  const joint = joindre([
    clauseNombre(contenusDetaches, "post", "posts"),
    clauseNombre(tachesDetachees, "tâche", "tâches"),
  ]);
  if (!joint) return null;
  const total = contenusDetaches + tachesDetachees;
  const masculinPresent = contenusDetaches > 0;
  const verbe =
    total === 1
      ? masculinPresent
        ? "a été détaché de la campagne."
        : "a été détachée de la campagne."
      : masculinPresent
        ? "ont été détachés de la campagne."
        : "ont été détachées de la campagne.";
  return `${joint} ${verbe}`;
}

function phraseSupprimes(contenusSupprimes: number, tachesSupprimees: number): string | null {
  const joint = joindre([
    clauseNombre(contenusSupprimes, "post", "posts"),
    clauseNombre(tachesSupprimees, "tâche", "tâches"),
  ]);
  if (!joint) return null;
  const total = contenusSupprimes + tachesSupprimees;
  const masculinPresent = contenusSupprimes > 0;
  const verbe =
    total === 1
      ? masculinPresent
        ? "a été supprimé."
        : "a été supprimée."
      : masculinPresent
        ? "ont été supprimés."
        : "ont été supprimées.";
  return `${joint} ${verbe}`;
}

/**
 * Construit le constat affiché après un rejet réussi. Lit `resultat` tel que rendu par
 * `POST /api/campaigns/:id/reject` — même discipline que `construireTexteConfirmation` :
 * aucun recompte, aucune ligne à zéro.
 *
 * `raisonDonnee` est ce que CE client a envoyé (pas une relecture du serveur) : c'est ce
 * qui distingue une raison vide (le cas normal, déjà annoncé par
 * `texteAvertissementRaisonVide` avant confirmation, et pour lequel `preferenceEcrite`
 * vaut légitimement faux) d'une raison fournie.
 *
 * Avec l'architecture serveur actuelle (`server/services/campaign-reject/rejeter.ts`),
 * une raison fournie et `preferenceEcrite: false` ne peuvent PAS coexister dans un 200 :
 * l'écriture de la préférence se fait DANS la même `db.transaction` que le reste du
 * rejet — si elle échoue, toute la transaction est annulée et la requête répond 500, pas
 * 200 avec `preferenceEcrite: false`. La branche ci-dessous est donc morte aujourd'hui.
 *
 * Elle reste volontairement : ce module est PUR et découplé du serveur — son seul contrat
 * est la forme JSON de `ResultatRejet`, où `preferenceEcrite` est un simple `boolean`,
 * sans que le type lui-même encode l'invariant qui le rend toujours vrai ici. Si ce
 * couplage serveur change un jour (préférence écrite hors transaction, en best-effort),
 * ce cas redevient réel — et le silence serait alors exactement la demi-mesure que ce
 * chantier entier existe pour interdire (Décision 4 du spec). Mieux vaut une ligne morte
 * et honnêtement documentée qu'un re-silence accidentel le jour où l'invariant casse.
 *
 * `resultat.preferenceSansEmbedding` n'apparaît JAMAIS ici : c'est une information
 * d'exploitation (la préférence existe mais est invisible à la récupération
 * sémantique), déjà dans le journal serveur, sur laquelle l'utilisatrice ne peut rien
 * faire — la lui montrer n'ajouterait qu'une inquiétude sans action possible.
 */
export function construireMessageSucces(resultat: ResultatRejet, raisonDonnee: boolean): string[] {
  const lignes: string[] = [];

  const detaches = phraseDetaches(resultat.contenusDetaches, resultat.tachesDetachees);
  if (detaches) lignes.push(detaches);

  const supprimes = phraseSupprimes(resultat.contenusSupprimes, resultat.tachesSupprimees);
  if (supprimes) lignes.push(supprimes);

  if (raisonDonnee && !resultat.preferenceEcrite) {
    lignes.push("La raison n'a pas pu être enregistrée.");
  }

  return lignes;
}

// ─── Lecture d'un échec HTTP ─────────────────────────────────────────────────────────
//
// Un échec arrive ici sous la forme posée par `throwIfResNotOk`
// (client/src/lib/queryClient.ts) : `new Error(`${status}: ${corpsBrut}`)`. `fetchJson`
// ne fait rien d'autre que relayer cette erreur.
//
// 404 sur ces deux endpoints (`server/routes.ts`, verrouillé) signifie TOUJOURS la même
// chose : la campagne a déjà disparu — l'utilisatrice l'a ouverte dans deux onglets, l'a
// supprimée depuis le premier, et clique « rejeter » depuis le second. Réessayer la même
// requête échouera indéfiniment de la même façon : dire « réessaie » mentirait. Le corps
// JSON du serveur porte `{ message: "Campaign not found" }`, en anglais (texte de debug,
// pas destiné à l'écran) — on ne le relaie donc jamais verbatim ; on affiche à la place
// la phrase pensée pour l'utilisatrice, décidée une fois ici plutôt que recopiée partout
// où ce 404 peut survenir (aperçu ou rejet).
function est404(error: unknown): boolean {
  return error instanceof Error && /^404:/.test(error.message);
}

const MESSAGE_CAMPAGNE_DISPARUE = "Cette campagne n'existe déjà plus.";

/** Message d'échec de `POST /api/campaigns/:id/reject`. */
export function messageEchecRejet(error: unknown): string {
  if (est404(error)) return MESSAGE_CAMPAGNE_DISPARUE;
  return "Le rejet n'a pas pu être effectué : réessaie dans un instant.";
}

/** Message d'échec de `GET /api/campaigns/:id/reject-preview`. */
export function messageEchecApercu(error: unknown): string {
  if (est404(error)) return MESSAGE_CAMPAGNE_DISPARUE;
  return "L'aperçu n'a pas pu être chargé : réessaie dans un instant.";
}
