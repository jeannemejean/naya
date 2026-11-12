// Les indicateurs du matin (spec §8.3) avec leur valeur précédente. Calculés à partir des données
// de Naya, relevés une fois par jour dans `indicateurs_releves`, montrés au mot du matin.
//
// Règle d'or : une source indisponible est DITE (`indisponible`, `valeur: null`), jamais inventée
// ni mise à 0, et son relevé n'écrase jamais une valeur disponible du même jour. La valeur
// précédente est le dernier relevé DISPONIBLE d'avant aujourd'hui.
//
// Définitions (fenêtre « 4 sem. » = les 28 jours qui précèdent `maintenant`) :
// - prospection_envois_4s : messages de prospection envoyés (`outreach_messages.sent_at`) ;
// - prospection_reponses_4s : prospects distincts ayant répondu (message entrant de nature
//   « reponse » dans la boîte Réponses) ;
// - prospection_interesses_4s : parmi eux, ceux encore « engagés » (stade en discussion,
//   proposition envoyée ou signé — `STADES_ENGAGES`) : une réponse requalifiée « pas une vraie
//   réponse » ou passée en « sans suite » n'en est pas ;
// - prospection_rdv_4s : événements PASSÉS de l'agenda Google dont le titre cite un prospect
//   contacté (nom ou entreprise, `evenementCite` : mots entiers, sans accents ni casse, mots
//   génériques ignorés). Sans agenda relié : « agenda non relié » ;
// - pipeline_en_discussion : prospects actifs au stade en discussion ou proposition envoyée ;
// - pipeline_relances_echues : tâches « Relancer X » (source `relance_prospect`) non faites dont
//   la date convenue est passée (`actionData.relance.date`, que le report des retards ne
//   touche pas ; à défaut la date prévue) ;
// - pipeline_signes : prospects actifs au stade signé, en texte « n / cible ». La cible vient de
//   l'objectif actif de classe `revenue` (`classeObjectif`) : un nombre de clients (« 2 clients »
//   → 2), jamais un montant (« 3 000 € » ne fait pas une cible de clients). Plusieurs objectifs
//   candidats sans départage : pas de cible, on affiche « n » seul. Avec un objectif choisi, on
//   compte les signés de son projet (et ceux sans projet) ;
// - audience_abonnes_{compteId} : abonnés du compte relié, quand l'API le permet (Instagram :
//   oui ; page LinkedIn : si LinkedIn l'autorise ; profil LinkedIn : non) ;
// - audience_posts_4s_{compteId} : contenus publiés par Naya sur ce compte ;
// - ao_a_venir : avis « repéré » dont la date limite n'est pas passée (ou sans date), hors avis
//   écartés par la veille (`estEcarteParNaya`) ;
// - ao_premiers_jets_sans_decision : statut « premier jet prêt » (Jeanne n'a ni lancé la
//   rédaction ni écarté l'avis), date limite non passée ;
// - ao_en_redaction_ou_deposes : statuts « en rédaction » et « déposé » (en attente du résultat).
//
// Ce module ne touche ni la base ni le réseau : tout passe par les dépendances
// (`indicateurs-deps.ts` pour les vraies).
import { ligneIndicateurs, nombreIndicateur, type Indicateur } from "@shared/fil";
import { estEcarteParNaya, estPasse } from "@shared/appels-offres";
import { evenementCite } from "./mouvements";
import { classeObjectif } from "./rattachement";

export { ligneIndicateurs };

/** Les clés, dans l'ordre d'affichage. `{compteId}` : une clé par compte relié. */
export const CLES_INDICATEURS = [
  "prospection_envois_4s", "prospection_reponses_4s", "prospection_interesses_4s", "prospection_rdv_4s",
  "pipeline_en_discussion", "pipeline_relances_echues", "pipeline_signes",
  "audience_abonnes_{compteId}", "audience_posts_4s_{compteId}",
  "ao_a_venir", "ao_premiers_jets_sans_decision", "ao_en_redaction_ou_deposes",
] as const;

export const cleAbonnes = (compteId: number) => `audience_abonnes_${compteId}`;
export const clePosts = (compteId: number) => `audience_posts_4s_${compteId}`;

export const FENETRE_INDICATEURS_JOURS = 28;
const JOUR_MS = 24 * 3600_000;

const LIBELLES: Record<string, string> = {
  prospection_envois_4s: "Messages de prospection envoyés (4 sem.)",
  prospection_reponses_4s: "Réponses de prospects (4 sem.)",
  prospection_interesses_4s: "Prospects intéressés (4 sem.)",
  prospection_rdv_4s: "Rendez-vous avec des prospects (4 sem.)",
  pipeline_en_discussion: "Opportunités en discussion",
  pipeline_relances_echues: "Relances échues",
  pipeline_signes: "Clients signés",
  ao_a_venir: "Appels d'offres à venir",
  ao_premiers_jets_sans_decision: "Premiers jets d'AO sans décision",
  ao_en_redaction_ou_deposes: "AO en rédaction ou déposés",
};

/** Raisons d'indisponibilité, courtes et montrables. */
export const RAISONS = {
  agendaNonRelie: "agenda non relié",
  agendaIllisible: "agenda illisible",
  lecture: "lecture impossible",
} as const;

export interface CompteRelie { id: number; plateforme: string; nom: string }

const NOMS_RESEAUX: Record<string, string> = { instagram: "Instagram", linkedin: "LinkedIn" };
const reseau = (plateforme: string) => (plateforme.startsWith("linkedin_page") ? "LinkedIn" : NOMS_RESEAUX[plateforme] ?? plateforme);

/** Le libellé d'une clé ; les clés d'audience nomment leur compte. */
export function libelleIndicateur(cle: string, comptes: CompteRelie[]): string {
  if (LIBELLES[cle]) return LIBELLES[cle];
  const m = cle.match(/^audience_(abonnes|posts_4s)_(\d+)$/);
  if (m) {
    const c = comptes.find((x) => x.id === Number(m[2]));
    const qui = c ? `${reseau(c.plateforme)} ${c.nom}` : `compte ${m[2]}`;
    return m[1] === "abonnes" ? `Abonnés ${qui}` : `Posts publiés ${qui} (4 sem.)`;
  }
  return cle;
}

/** Rang d'affichage d'une clé (ordre de `CLES_INDICATEURS`). */
function rang(cle: string): number {
  const i = (CLES_INDICATEURS as readonly string[]).indexOf(cle);
  if (i !== -1) return i;
  if (cle.startsWith("audience_abonnes_")) return CLES_INDICATEURS.indexOf("audience_abonnes_{compteId}");
  if (cle.startsWith("audience_posts_4s_")) return CLES_INDICATEURS.indexOf("audience_posts_4s_{compteId}");
  return CLES_INDICATEURS.length;
}

/**
 * Une source qui manque, avec sa raison courte (montrable telle quelle). Les vraies dépendances
 * la lèvent ; toute autre erreur devient « lecture impossible » (son message pourrait citer une
 * requête, voire un jeton : il n'est jamais montré).
 */
export class SourceIndisponible extends Error {}

// ── Les sources ────────────────────────────────────────────────────────────────────────

export interface ObjectifRevenu { projetId: number; goalType: string; successMode: string; cible: string | null }
export interface AppelOffresIndicateur { statut: string; dateLimite: Date | null; bloquants: string | null; source?: string | null }

export interface SourcesIndicateurs {
  prospection(userId: string, depuis: Date): Promise<{ envois: number; reponses: number; interesses: number }>;
  /** Noms et entreprises des prospects contactés (pour reconnaître un rendez-vous). */
  nomsProspects(userId: string): Promise<string[]>;
  /** Événements de l'agenda ; `null` sans agenda relié. Lève si l'agenda ne répond pas. */
  agenda(userId: string, debut: Date, fin: Date): Promise<{ titre: string; at: Date }[] | null>;
  pipeline(userId: string, aujourdhui: string): Promise<{ enDiscussion: number; relancesEchues: number }>;
  /** Objectifs actifs de l'utilisatrice (toutes classes : le tri est fait ici). */
  objectifs(userId: string): Promise<ObjectifRevenu[]>;
  /** Prospects signés ; `projetId` : ceux de ce projet et ceux sans projet. */
  signes(userId: string, projetId: number | null): Promise<number>;
  /** Comptes Instagram et LinkedIn reliés et actifs (jamais de jeton ici). */
  comptes(userId: string): Promise<CompteRelie[]>;
  abonnes(userId: string, compteId: number, maintenant: Date): Promise<number>;
  postsPublies(userId: string, compteId: number, depuis: Date): Promise<number>;
  appelsOffres(userId: string): Promise<AppelOffresIndicateur[]>;
}

// ── La cible des signés ────────────────────────────────────────────────────────────────

// Une cible en argent (« 3 000 € », « 10k », « 20 % du CA ») n'est pas un nombre de clients.
const MONTANT = /[€$%£]|\d\s*k\b|\beuros?\b|\bchiffre\b|\bca\b|\bk€/i;
const DE_CLIENTS = /client|contrat|sign|mission|projet/i;

/** Le nombre de clients visé par une cible (« 2 clients » → 2), ou null. */
export function cibleNumerique(cible: string | null): number | null {
  if (!cible || MONTANT.test(cible)) return null;
  const m = cible.match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * L'objectif `revenue` qui porte la cible des signés : l'unique objectif de cette classe avec une
 * cible en nombre ; à plusieurs, celui dont la cible parle de clients (s'il est seul). Sinon pas
 * de cible. `projetId` : le projet de l'unique objectif `revenue`, même sans cible chiffrée.
 */
export function choisirCible(objectifs: ObjectifRevenu[]): { projetId: number | null; cible: number | null } {
  const revenus = objectifs.filter((o) => classeObjectif(o) === "revenue");
  const chiffres = revenus.filter((o) => cibleNumerique(o.cible) != null);
  let choisi = chiffres.length === 1 ? chiffres[0] : null;
  if (!choisi && chiffres.length > 1) {
    const clients = chiffres.filter((o) => DE_CLIENTS.test(o.cible ?? ""));
    choisi = clients.length === 1 ? clients[0] : null;
  }
  if (choisi) return { projetId: choisi.projetId, cible: cibleNumerique(choisi.cible) };
  return { projetId: revenus.length === 1 ? revenus[0].projetId : null, cible: null };
}

export const texteSignes = (n: number, cible: number | null) => (cible != null ? `${n} / ${cible}` : `${n}`);

// ── Le calcul ──────────────────────────────────────────────────────────────────────────

const jourParis = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d);

function raisonDe(e: unknown, defaut: string = RAISONS.lecture): string {
  return e instanceof SourceIndisponible && e.message ? e.message : defaut;
}

/**
 * Les indicateurs du moment, sans valeur précédente (`precedente: null`). Chaque source est lue
 * à part : une source en panne rend ses indicateurs « indisponible » sans toucher aux autres.
 */
export async function calculerIndicateurs(userId: string, maintenant: Date, deps: SourcesIndicateurs): Promise<Indicateur[]> {
  const depuis = new Date(maintenant.getTime() - FENETRE_INDICATEURS_JOURS * JOUR_MS);
  const aujourdhui = jourParis(maintenant);
  let comptes: CompteRelie[] = [];

  const dispo = (cle: string, valeur: number | string): Indicateur =>
    ({ cle, libelle: libelleIndicateur(cle, comptes), valeur, precedente: null });
  const indispo = (cle: string, e: unknown, defaut?: string): Indicateur => {
    if (!(e instanceof SourceIndisponible)) console.error(`[fil] indicateur ${cle} user=${userId} :`, (e as any)?.message ?? e);
    return { cle, libelle: libelleIndicateur(cle, comptes), valeur: null, precedente: null, indisponible: raisonDe(e, defaut) };
  };

  const prospection = async (): Promise<Indicateur[]> => {
    const cles = ["prospection_envois_4s", "prospection_reponses_4s", "prospection_interesses_4s"];
    try {
      const p = await deps.prospection(userId, depuis);
      return [dispo(cles[0], p.envois), dispo(cles[1], p.reponses), dispo(cles[2], p.interesses)];
    } catch (e) {
      return cles.map((c) => indispo(c, e));
    }
  };

  const rdv = async (): Promise<Indicateur[]> => {
    const cle = "prospection_rdv_4s";
    let evenements: { titre: string; at: Date }[] | null;
    try {
      evenements = await deps.agenda(userId, depuis, maintenant);
    } catch (e) {
      return [indispo(cle, e, RAISONS.agendaIllisible)];
    }
    if (evenements == null) return [indispo(cle, new SourceIndisponible(RAISONS.agendaNonRelie))];
    try {
      const noms = await deps.nomsProspects(userId);
      const n = evenements.filter((ev) => ev.at.getTime() >= depuis.getTime() && ev.at.getTime() <= maintenant.getTime()
        && evenementCite(ev.titre, noms)).length;
      return [dispo(cle, n)];
    } catch (e) {
      return [indispo(cle, e)];
    }
  };

  const pipeline = async (): Promise<Indicateur[]> => {
    const res: Indicateur[] = [];
    try {
      const p = await deps.pipeline(userId, aujourdhui);
      res.push(dispo("pipeline_en_discussion", p.enDiscussion), dispo("pipeline_relances_echues", p.relancesEchues));
    } catch (e) {
      res.push(indispo("pipeline_en_discussion", e), indispo("pipeline_relances_echues", e));
    }
    try {
      // Sans objectif lisible, on compte quand même les signés, sans cible.
      const objectifs = await deps.objectifs(userId).catch((e: any) => {
        console.error(`[fil] indicateurs : objectifs illisibles user=${userId} :`, e?.message ?? e);
        return [] as ObjectifRevenu[];
      });
      const { projetId, cible } = choisirCible(objectifs);
      res.push(dispo("pipeline_signes", texteSignes(await deps.signes(userId, projetId), cible)));
    } catch (e) {
      res.push(indispo("pipeline_signes", e));
    }
    return res;
  };

  const audience = async (): Promise<Indicateur[]> => {
    try {
      comptes = await deps.comptes(userId);
    } catch (e: any) {
      // Sans la liste des comptes, on ne sait pas quelles clés écrire : rien plutôt qu'inventer.
      console.error(`[fil] indicateurs : comptes reliés illisibles user=${userId} :`, e?.message ?? e);
      return [];
    }
    const parCompte = await Promise.all(comptes.map(async (c) => {
      const [abonnes, posts] = await Promise.all([
        deps.abonnes(userId, c.id, maintenant).then((n) => dispo(cleAbonnes(c.id), n), (e) => indispo(cleAbonnes(c.id), e)),
        deps.postsPublies(userId, c.id, depuis).then((n) => dispo(clePosts(c.id), n), (e) => indispo(clePosts(c.id), e)),
      ]);
      return [abonnes, posts];
    }));
    return parCompte.flat();
  };

  const ao = async (): Promise<Indicateur[]> => {
    const cles = ["ao_a_venir", "ao_premiers_jets_sans_decision", "ao_en_redaction_ou_deposes"];
    try {
      const lignes = await deps.appelsOffres(userId);
      const ouvert = (a: AppelOffresIndicateur) => !estPasse(a.dateLimite, maintenant);
      return [
        dispo(cles[0], lignes.filter((a) => a.statut === "repere" && ouvert(a) && !estEcarteParNaya(a)).length),
        dispo(cles[1], lignes.filter((a) => a.statut === "premier_jet_pret" && ouvert(a)).length),
        dispo(cles[2], lignes.filter((a) => a.statut === "en_redaction" || a.statut === "depose").length),
      ];
    } catch (e) {
      return cles.map((c) => indispo(c, e));
    }
  };

  const groupes = await Promise.all([prospection(), rdv(), pipeline(), audience(), ao()]);
  // Les libellés d'audience connaissent leurs comptes une fois `comptes` lu.
  return groupes.flat()
    .map((i) => ({ ...i, libelle: libelleIndicateur(i.cle, comptes) }))
    .sort((a, b) => rang(a.cle) - rang(b.cle));
}

// ── Le relevé et la valeur précédente ──────────────────────────────────────────────────

/** Une ligne de `indicateurs_releves` (sans l'utilisatrice ni le jour). */
export interface LigneReleve { cle: string; valeur: number | null; texte: string | null; indisponible: string | null }

/** Indicateur → ligne : un texte (« 1 / 2 ») garde aussi son nombre dans `valeur`. */
export function versLigne(i: Indicateur): LigneReleve {
  if (i.indisponible || i.valeur == null) return { cle: i.cle, valeur: null, texte: null, indisponible: i.indisponible ?? RAISONS.lecture };
  if (typeof i.valeur === "string") return { cle: i.cle, valeur: nombreIndicateur(i.valeur), texte: i.valeur, indisponible: null };
  return { cle: i.cle, valeur: i.valeur, texte: null, indisponible: null };
}

const valeurDe = (l: LigneReleve): number | string | null => l.texte ?? l.valeur;

/**
 * Règle d'écriture du relevé du jour (miroir exact du `ON CONFLICT … WHERE` de
 * `indicateurs-deps.ts`) : une valeur disponible remplace tout ; une indisponibilité ne remplace
 * qu'une indisponibilité. Jamais un « indisponible » sur une valeur déjà relevée.
 */
export function fusionnerReleve(existante: LigneReleve | undefined, nouvelle: LigneReleve): LigneReleve {
  if (!existante) return nouvelle;
  if (nouvelle.indisponible && !existante.indisponible) return existante;
  return nouvelle;
}

export interface DepsReleve {
  calculer(userId: string, maintenant: Date): Promise<Indicateur[]>;
  /** Upsert sur (user_id, cle, releve_le), selon `fusionnerReleve`. */
  ecrire(userId: string, jour: string, lignes: LigneReleve[]): Promise<void>;
  /** Le relevé du jour. */
  lireJour(userId: string, jour: string): Promise<LigneReleve[]>;
  /** Par clé, le dernier relevé DISPONIBLE strictement avant `jour`. */
  precedentes(userId: string, jour: string): Promise<LigneReleve[]>;
  /** Les comptes reliés, pour nommer les indicateurs d'audience (lecture en base, sans réseau). */
  comptes(userId: string): Promise<CompteRelie[]>;
}

/** Le relevé du jour + les précédentes → indicateurs, triés. */
export function assembler(jour: LigneReleve[], precedentes: LigneReleve[], libelle: (cle: string) => string): Indicateur[] {
  const prec = new Map(precedentes.filter((l) => !l.indisponible).map((l) => [l.cle, valeurDe(l)]));
  return jour
    .map((l): Indicateur => {
      const i: Indicateur = { cle: l.cle, libelle: libelle(l.cle), valeur: l.indisponible ? null : valeurDe(l), precedente: prec.get(l.cle) ?? null };
      if (l.indisponible) i.indisponible = l.indisponible;
      return i;
    })
    .sort((a, b) => rang(a.cle) - rang(b.cle));
}

/**
 * Calcule, écrit le relevé du jour (upsert, idempotent dans la journée), puis rend chaque
 * indicateur calculé avec la valeur du relevé (une indisponibilité n'efface pas la valeur déjà
 * relevée aujourd'hui) et sa valeur précédente.
 */
export async function releverEtComparer(userId: string, aujourdhui: string, deps: DepsReleve, maintenant: Date = new Date()): Promise<Indicateur[]> {
  const calcules = await deps.calculer(userId, maintenant);
  await deps.ecrire(userId, aujourdhui, calcules.map(versLigne));
  const [jour, precedentes] = await Promise.all([deps.lireJour(userId, aujourdhui), deps.precedentes(userId, aujourdhui)]);
  const parCle = new Map(jour.map((l) => [l.cle, l]));
  const libelles = new Map(calcules.map((i) => [i.cle, i.libelle]));
  const lignes = calcules.map((i) => parCle.get(i.cle) ?? versLigne(i));
  return assembler(lignes, precedentes, (cle) => libelles.get(cle) ?? cle);
}

// ── Le matin : lire le relevé du jour, ou le faire une seule fois ──────────────────────

/** Après un échec, le matin ne relance pas le calcul (APIs comprises) avant ce délai. */
export const PAUSE_APRES_ECHEC_MS = 10 * 60_000;
const enCours = new Map<string, Promise<Indicateur[]>>();
const echecs = new Map<string, number>();

/** Pour les tests. */
export function viderRelevesEnMemoire(): void {
  enCours.clear();
  echecs.clear();
}

/**
 * Le relevé, une seule fois à la fois par utilisatrice et par jour (mémoire du processus) : deux
 * appels simultanés (passage du matin, page ouverte) partagent le même calcul.
 */
export function releverUneFois(userId: string, aujourdhui: string, deps: DepsReleve, maintenant: Date = new Date()): Promise<Indicateur[]> {
  const cle = `${userId}:${aujourdhui}`;
  const connu = enCours.get(cle);
  if (connu) return connu;
  const p = releverEtComparer(userId, aujourdhui, deps, maintenant)
    .then((r) => { echecs.delete(cle); return r; })
    .catch((e) => { echecs.set(cle, maintenant.getTime()); throw e; })
    .finally(() => enCours.delete(cle));
  enCours.set(cle, p);
  return p;
}

/**
 * Les indicateurs du mot du matin. `GET /api/fil/matin` est appelé souvent : on n'appelle
 * JAMAIS les APIs extérieures à chaque chargement. Si le relevé du jour existe (fait au passage
 * du matin), on le lit avec les précédentes — deux requêtes en base. Sinon (avant le passage, ou
 * passage raté), on le fait une seule fois, puis les chargements suivants le lisent. Après un
 * échec complet, pas de nouvel essai avant `PAUSE_APRES_ECHEC_MS` : le matin part sans indicateurs.
 */
export async function indicateursDuJour(userId: string, aujourdhui: string, maintenant: Date, deps: DepsReleve): Promise<Indicateur[]> {
  const jour = await deps.lireJour(userId, aujourdhui);
  if (jour.length > 0) {
    const [precedentes, comptes] = await Promise.all([
      deps.precedentes(userId, aujourdhui),
      deps.comptes(userId).catch(() => [] as CompteRelie[]),
    ]);
    return assembler(jour, precedentes, (cle) => libelleIndicateur(cle, comptes));
  }
  const cle = `${userId}:${aujourdhui}`;
  const echec = echecs.get(cle);
  if (!enCours.has(cle) && echec != null && maintenant.getTime() - echec < PAUSE_APRES_ECHEC_MS) return [];
  return releverUneFois(userId, aujourdhui, deps, maintenant);
}
