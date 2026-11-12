// La création, version Naya (spec §8, point 6) : le suivi de ce qui vit dans Naya, pour le matin.
// - une alerte par compte social actif sans aucun post prévu ni publié dans les 7 prochains jours
//   (l'équivalent de l'alerte Metricool) ; la fenêtre regarde DEVANT : un post publié hier ne
//   couvre pas la semaine qui vient ;
// - `aValider` : les posts à l'état `brouillon` ou `a_rediger` (etatPost) prévus dans les 3 jours,
//   avec le lien de l'atelier de leur semaine (les posts proposés par la présence en font partie) ;
// - `aValider` aussi : les phases de campagne qui commencent dans les 7 jours et ne sont pas
//   validées. `campaigns.phases` ne porte ni date ni validation par phase (forme figée dans
//   creation.test.ts) : le début se calcule par computePhaseRanges, et une phase est validée
//   quand sa campagne est lancée (statut ≠ draft). Une campagne déjà finie est ignorée.
// Les fenêtres commencent à minuit (Paris) : un brouillon prévu plus tôt aujourd'hui reste visible.
// Les rituels de création (« Encore Merci : 3 recettes de la semaine », le lundi) sont les rituels
// existants : leur rattachement se fait à la matérialisation (ritual-materialize.ts).
//
// Ce module n'importe ni la base ni le stockage : les sources sont injectées (creation-deps.ts).
import { etatPost, lienAtelier, lundiDe, plusJours } from "@shared/atelier";
import { couvre, estPublie, type CompteActif, type PostPresence } from "./presence";
import { computePhaseRanges, DUREE_JOURS } from "../campagne/phases";
import { formatDate } from "../../utils/dateUtils";

export const FENETRE_ALERTE_JOURS = 7;
export const FENETRE_VALIDATION_JOURS = 3;
export const FENETRE_PHASES_JOURS = 7;
const JOUR_MS = 24 * 3600_000;

export interface PostCreation extends PostPresence {
  id: number; title?: string | null; autoPost?: boolean | null; consigne?: string | null;
  campaignId?: number | null; body?: string | null; tendanceProjetId?: number | null;
  /** Portée du post (mode agence) : l'id du projet client, ou null pour l'utilisatrice. */
  portee?: number | null;
}
export interface CompteCreation extends CompteActif { nom?: string | null; projectId?: number | null }
export interface CampagneCreation {
  id: number; name: string; status: string | null; startDate: string | null; duration: string | null; phases: unknown;
}
export interface SuiviCreation { alertes: string[]; aValider: { libelle: string; lien: string }[] }

// ── Les phases ─────────────────────────────────────────────────────────────────────────

/**
 * Le jour de début de chaque phase et le dernier jour de la campagne, par `computePhaseRanges`
 * (campagne/phases.ts), avec la date de départ lue comme au lancement (`startDate + "T00:00:00"`,
 * /api/campaigns/:id/launch). Sans date de début ou sans phases lisibles : rien.
 */
export function debutsDesPhases(c: CampagneCreation): { numero: number; nom: string; debut: string; finCampagne: string }[] {
  if (!c.startDate || !/^\d{4}-\d{2}-\d{2}/.test(c.startDate) || !Array.isArray(c.phases)) return [];
  const phases = (c.phases as any[])
    .filter((p) => p && typeof p === "object" && Number.isFinite(Number(p.number)))
    .map((p) => ({ ...p, number: Number(p.number) }));
  if (phases.length === 0) return [];
  const jours = DUREE_JOURS[c.duration || "3_months"] || 90;
  const plages = computePhaseRanges(phases, new Date(`${c.startDate.slice(0, 10)}T00:00:00`), jours);
  const triees = [...phases].sort((a, b) => a.number - b.number);
  // Fin de la campagne : la fin de la dernière phase (durée − 1 jours après le départ).
  const finCampagne = formatDate(plages[triees[triees.length - 1].number].end);
  return triees.map((p) => ({
    numero: p.number,
    nom: String(p.name || p.title || `Phase ${p.number}`),
    debut: formatDate(plages[p.number].start),
    finCampagne,
  }));
}

// ── Le suivi ───────────────────────────────────────────────────────────────────────────

const PLATEFORMES: Record<string, string> = {
  instagram: "Instagram", linkedin: "LinkedIn", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube",
  twitter: "X", x: "X", threads: "Threads", pinterest: "Pinterest",
};
export const plateforme = (p: string | null | undefined) => {
  const t = (p ?? "").trim();
  return PLATEFORMES[t.toLowerCase()] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "un réseau");
};

export const jourParis = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d);
// « samedi 14 novembre » (le jour d'un instant, à Paris).
export const jourLong = (d: Date) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long",
}).format(d);
// « dimanche 15 novembre » (un jour YYYY-MM-DD, sans fuseau).
export const jourLongIso = (jour: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
}).format(new Date(`${jour}T12:00:00Z`));

const date = (v: Date | string | null | undefined): Date | null => (v ? new Date(v) : null);

/** Minuit à Paris, le jour de `maintenant` : un brouillon en retard d'aujourd'hui reste visible. */
export function debutJourParis(maintenant: Date): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(maintenant).map((x) => [x.type, x.value]));
  const ecoule = (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + maintenant.getUTCMilliseconds();
  return new Date(maintenant.getTime() - ecoule);
}

export function suiviCreation(
  posts: PostCreation[], comptesActifs: CompteCreation[], campagnes: CampagneCreation[], maintenant: Date,
): SuiviCreation {
  // Les fenêtres partent de minuit (Paris) et finissent 7 ou 3 jours après maintenant.
  const t = debutJourParis(maintenant).getTime();
  const finAlerte = maintenant.getTime() + FENETRE_ALERTE_JOURS * JOUR_MS;
  const finValidation = maintenant.getTime() + FENETRE_VALIDATION_JOURS * JOUR_MS;

  // Un post couvre un compte : il le désigne, sinon même plateforme ET même portée (un post d'un
  // projet client ne couvre pas le compte de la marque, et inversement).
  const couvreCompte = (p: PostCreation, c: CompteCreation) =>
    couvre(p, c) && (p.socialAccountId != null || (p.portee ?? null) === (c.projectId ?? null));
  const dansLaSemaine = (p: PostCreation) => {
    if (estPublie(p)) {
      const d = (date(p.publishedAt) ?? date(p.scheduledFor))?.getTime();
      return d != null && d >= t && d <= finAlerte;
    }
    if (p.postStatus === "failed") return false;
    const s = date(p.scheduledFor)?.getTime();
    return s != null && s >= t && s <= finAlerte;
  };
  const alertes = comptesActifs
    .filter((c) => !posts.some((p) => couvreCompte(p, c) && dansLaSemaine(p)))
    .map((c) => `Rien de prévu sur ${plateforme(c.platform)}${c.nom?.trim() ? ` (${c.nom.trim()})` : ""} dans les ${FENETRE_ALERTE_JOURS} prochains jours.`);

  const aValider: SuiviCreation["aValider"] = posts
    .map((p) => ({ p, s: date(p.scheduledFor) }))
    .filter((x): x is { p: PostCreation; s: Date } => x.s != null && x.s.getTime() >= t && x.s.getTime() <= finValidation)
    .map((x) => ({ ...x, etat: etatPost(x.p) }))
    .filter((x) => x.etat === "brouillon" || x.etat === "a_rediger")
    .sort((a, b) => a.s.getTime() - b.s.getTime() || a.p.id - b.p.id)
    .map(({ p, s, etat }) => ({
      libelle: `${etat === "a_rediger" ? "À rédiger" : "À valider"} : « ${(p.title ?? "").trim() || "Post sans titre"} » (${plateforme(p.platform)}, ${jourLong(s)})`,
      lien: lienAtelier(lundiDe(jourParis(s))),
    }));

  const aujourdhui = jourParis(maintenant);
  const limite = plusJours(aujourdhui, FENETRE_PHASES_JOURS);
  for (const c of campagnes) {
    if ((c.status ?? "draft") !== "draft") continue; // lancée = validée
    for (const ph of debutsDesPhases(c)) {
      if (ph.finCampagne < aujourdhui) continue; // campagne déjà finie : plus rien à valider
      if (ph.debut < aujourdhui || ph.debut > limite) continue;
      aValider.push({
        libelle: `Campagne « ${c.name} » : la phase « ${ph.nom} » commence le ${jourLongIso(ph.debut)}, campagne pas encore lancée`,
        lien: "/campaigns",
      });
    }
  }
  return { alertes, aValider };
}

// ── Chargement et cache du matin ───────────────────────────────────────────────────────

export interface DepsCreation {
  /** Comptes sociaux actifs de l'utilisatrice, toutes portées (projectId = portée du compte). */
  comptesActifs(userId: string): Promise<CompteCreation[]>;
  /** Posts prévus ou publiés entre ces deux instants, avec leur portée. */
  posts(userId: string, debut: Date, fin: Date): Promise<PostCreation[]>;
  /** Campagnes de l'utilisatrice (seules les non lancées comptent). */
  campagnes(userId: string): Promise<CampagneCreation[]>;
}

export async function chargerSuiviCreation(userId: string, maintenant: Date, deps?: DepsCreation): Promise<SuiviCreation> {
  const d = deps ?? (await import("./creation-deps")).depsCreation;
  const fin = new Date(maintenant.getTime() + FENETRE_ALERTE_JOURS * JOUR_MS);
  const [comptes, posts, campagnes] = await Promise.all([d.comptesActifs(userId), d.posts(userId, debutJourParis(maintenant), fin), d.campagnes(userId)]);
  return suiviCreation(posts, comptes, campagnes, maintenant);
}

/** Trois lectures à chaque GET /api/fil/matin : gardées 20 min par utilisatrice et par jour (Europe/Paris). */
export const CACHE_CREATION_MS = 20 * 60_000;
const cacheCreation = new Map<string, { at: number; valeur: Promise<SuiviCreation> }>();

/** Pour les tests. */
export function viderCacheCreation(): void {
  cacheCreation.clear();
}

export function suiviCreationEnCache(
  userId: string, maintenant: Date,
  calculer: (userId: string, maintenant: Date) => Promise<SuiviCreation> = chargerSuiviCreation,
): Promise<SuiviCreation> {
  const cle = `${userId}:${jourParis(maintenant)}`;
  const connu = cacheCreation.get(cle);
  if (connu && maintenant.getTime() - connu.at < CACHE_CREATION_MS) return connu.valeur;
  cacheCreation.forEach((v, k) => { if (maintenant.getTime() - v.at >= CACHE_CREATION_MS) cacheCreation.delete(k); });
  const valeur = calculer(userId, maintenant);
  cacheCreation.set(cle, { at: maintenant.getTime(), valeur });
  // Un échec n'est pas gardé : le prochain matin réessaie.
  valeur.catch(() => { if (cacheCreation.get(cle)?.valeur === valeur) cacheCreation.delete(cle); });
  return valeur;
}
