/**
 * Les quatre routines de veille (dossier Acquisition 360, étape 1) : concurrents, voix du
 * client, positions Google, réponses des IA. Une par projet et par type, chaque semaine.
 *
 * Ordre commun : projet (sinon routine désactivée) → éléments suivis (sinon rien, sans
 * dépense) → garde accès et budget → collecte plafonnée → relevés comparables → constats.
 * Un fournisseur en panne donne une erreur neutre, jamais une notification.
 */
import type { Routine, VeilleItem, InsertVeilleReleve, InsertVeilleConstat } from "@shared/schema";
import type { SerpOptions, SerpResult } from "../serp";
import type { ResultatPassage } from "../routines/types";
import { prochainPassageApres } from "../routines/temps";
import { suivis } from "./items";
import { domaineDe, domaineSuivable, empreinte } from "./texte";
import { analyserReponse, comparerGeo, sourcesATravailler, bilanGeo, nomMoteur, type AnalyseGeo, type Entite } from "./geo-analyse";
import { positions, comparerSerp, bilanSerp, type Positions } from "./serp-positions";
import { engagementPosts, contenusForts, lireResumeOffre } from "./concurrents-analyse";
import { lireConstatsVoc, dedoublonnerConstats } from "./voc-analyse";
import type { Moteur, ReponseMoteur } from "./moteurs-ia";
import {
  KIND_CONCURRENTS, KIND_VOIX_CLIENT, KIND_SERP, KIND_GEO, LIMITES, HEURE_VEILLE_UTC, PAYS_DEFAUT, LANGUE_DEFAUT,
  type ConstatBrut, type KindVeille,
} from "./types";

export interface DepsVeille {
  storage: {
    getProject(id: number, userId: string): Promise<any>;
    getVeilleItems(userId: string, projectId: number): Promise<VeilleItem[]>;
    getRelevesParCles(userId: string, projectId: number, kind: string, cles: string[]): Promise<Array<{ cle: string; donnees: any }>>;
    addVeilleReleves(rows: InsertVeilleReleve[]): Promise<void>;
    addVeilleConstats(rows: InsertVeilleConstat[]): Promise<unknown>;
    getVeilleConstats(userId: string, projectId: number, opts?: any): Promise<Array<{ kind: string; texte: string }>>;
  };
  /** Accès et budget avant toute dépense (null : permis). */
  garde(userId: string): Promise<ResultatPassage | null>;
  /** Propriétaire : pas de plafond de questions GEO (jamais bloquée par le budget). */
  illimite(userId: string): Promise<boolean>;
  /** Budget atteint en cours de passage : on s'arrête. */
  bloque(userId: string): Promise<boolean>;
  chercher(userId: string, requete: string, opts: SerpOptions): Promise<SerpResult[]>;
  lirePage(userId: string, url: string): Promise<string | null>;
  interroger(userId: string, moteur: Moteur, prompt: string): Promise<ReponseMoteur>;
  moteurs(): Moteur[];
  /** Appel IA court qui renvoie du JSON (coût imputé à l'utilisatrice). */
  ia(userId: string, projectId: number, system: string, prompt: string): Promise<string>;
  instagram(userId: string, url: string): Promise<any | null>;
  serpConfigure(): boolean;
  lectureConfiguree(): boolean;
  instagramConfigure(): boolean;
}

const NOM_VEILLE: Record<KindVeille, string> = {
  [KIND_CONCURRENTS]: "concurrents",
  [KIND_VOIX_CLIENT]: "voix du client",
  [KIND_SERP]: "Google",
  [KIND_GEO]: "réponses des IA",
};

const OPTS_RECHERCHE: SerpOptions = { pays: PAYS_DEFAUT, langue: LANGUE_DEFAUT };

/** Routine de veille d'un projet (création idempotente). Premier passage le prochain matin. */
export function routineVeillePour(kind: KindVeille, p: { userId: string; projectId: number }, maintenant: Date, actif = true) {
  return {
    userId: p.userId, projectId: p.projectId, kind,
    cible: { projectId: p.projectId }, cibleCle: `project:${p.projectId}`,
    cadence: "hebdomadaire", heureUtc: HEURE_VEILLE_UTC, actif,
    prochainPassage: prochainPassageApres("quotidienne", HEURE_VEILLE_UTC, maintenant),
  };
}

type Contexte = { userId: string; projectId: number; projet: any; items: VeilleItem[]; deps: DepsVeille };

/** Projet, éléments suivis, garde. Rend soit le contexte, soit le résultat à renvoyer tel quel. */
async function preparer(
  routine: Routine, deps: DepsVeille, aSuivre: (items: VeilleItem[]) => VeilleItem[], rienASuivre: string,
): Promise<{ ctx: Contexte; cibles: VeilleItem[] } | { fin: ResultatPassage }> {
  const projectId = Number((routine.cible as any)?.projectId);
  const projet = Number.isInteger(projectId) ? await deps.storage.getProject(projectId, routine.userId) : null;
  if (!projet) return { fin: { statut: "rien_a_faire", resume: "Ce projet n'existe plus : veille arrêtée.", desactiver: true } };
  const items = await deps.storage.getVeilleItems(routine.userId, projectId);
  const cibles = aSuivre(items);
  if (cibles.length === 0) return { fin: { statut: "rien_a_faire", resume: rienASuivre } };
  const refus = await deps.garde(routine.userId);
  if (refus) return { fin: refus };
  return { ctx: { userId: routine.userId, projectId, projet, items, deps }, cibles };
}

/** La marque du projet : l'élément « marque » non écarté, sinon le nom du projet. */
function entiteMarque(ctx: Contexte): Entite & { domaine: string | null } {
  const m = ctx.items.find((i) => i.type === "marque" && i.statut !== "ecarte");
  const v: any = m?.valeur || {};
  // Une page Instagram, Etsy ou Linktree n'est pas le site de la marque (domaine partagé).
  return { nom: m?.libelle || ctx.projet?.name || "", variantes: v.variantes || [], domaine: domaineSuivable(v.site) };
}

function entitesConcurrents(ctx: Contexte) {
  return suivis(ctx.items, "concurrent").map((c) => {
    const v: any = c.valeur || {};
    return { cle: `c${c.id}`, nom: c.libelle, variantes: v.variantes || [], domaine: domaineSuivable(v.site) };
  });
}

/** Enregistre les constats et construit le résultat du passage. */
async function conclure(
  kind: KindVeille, ctx: Contexte, constats: ConstatBrut[], details: Record<string, unknown>, rien: string,
): Promise<ResultatPassage> {
  if (constats.length > 0) {
    await ctx.deps.storage.addVeilleConstats(constats.map((c) => ({
      userId: ctx.userId, projectId: ctx.projectId, kind, type: c.type, titre: c.titre, texte: c.texte, preuve: c.preuve ?? null,
    })));
  }
  const nom = ctx.projet?.name ? `${ctx.projet.name} · ` : "";
  if (constats.length === 0) return { statut: "rien_a_faire", resume: `${nom}${rien}`, details };
  const n = constats.length;
  return {
    statut: "ok",
    resume: `${nom}veille ${NOM_VEILLE[kind]} : ${n} nouveauté${n > 1 ? "s" : ""}. ${constats[0].titre}.`,
    details: { ...details, constats: n },
    notifier: true,
    lien: `/projects/${ctx.projectId}?onglet=veille`,
  };
}

/** Panne du fournisseur : l'utilisatrice n'y peut rien, on journalise sans la notifier. */
function panne(kind: KindVeille, raison: string | null, details: Record<string, unknown>): ResultatPassage {
  console.error(`[veille] ${kind} : collecte en panne (${raison ?? "raison inconnue"})`);
  return {
    statut: "erreur",
    resume: `La veille ${NOM_VEILLE[kind]} est indisponible pour le moment : Naya réessaiera la semaine prochaine.`,
    details: { ...details, raison },
  };
}

const releve = (ctx: Contexte, kind: KindVeille, cle: string, donnees: unknown): InsertVeilleReleve =>
  ({ userId: ctx.userId, projectId: ctx.projectId, kind, cle, donnees: donnees as any });

/** Dernier relevé de chaque clé. */
async function derniers(ctx: Contexte, kind: KindVeille, cles: string[]): Promise<Map<string, any>> {
  const rows = await ctx.deps.storage.getRelevesParCles(ctx.userId, ctx.projectId, kind, cles);
  const m = new Map<string, any>();
  for (const r of rows) if (!m.has(r.cle)) m.set(r.cle, r.donnees);
  return m;
}

// ─── 1. Concurrents ───────────────────────────────────────────────────────────

const SYSTEME_OFFRE = `Tu compares deux versions de la page d'accueil d'un concurrent. Tu ne relèves que ce qui est commercial : nouvelle offre, prix, promotion, coffret, garantie, changement de positionnement. Ignore la mise en page, les dates, les menus et les mentions légales. Réponds en JSON strict : {"changement_commercial": true|false, "resume": "une ou deux phrases factuelles, sans extrapoler"}.`;

const urlInstagram = (v: string) => {
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://www.instagram.com/${t.replace(/^@/, "").replace(/\/+$/, "")}/`;
};

export async function executerConcurrents(routine: Routine, deps: DepsVeille): Promise<ResultatPassage> {
  const d = await preparer(routine, deps, (xs) => suivis(xs, "concurrent"), "Aucun concurrent suivi : rien à relever.");
  if ("fin" in d) return d.fin;
  const { ctx, cibles } = d;
  const kind = KIND_CONCURRENTS;
  const constats: ConstatBrut[] = [];
  const releves: InsertVeilleReleve[] = [];
  let essais = 0, echecs = 0;
  let derniereErreur: string | null = null;

  // Premier passage d'un concurrent : on note ce qui existe déjà (actualités, posts) comme vu,
  // sans en faire des « nouveautés » : la veille signale ce qui change, pas l'état des lieux.
  const inities = await derniers(ctx, kind, cibles.map((c) => `init:${c.id}`));
  let nouveaux = 0;
  for (const c of cibles) {
    if (await deps.bloque(ctx.userId)) break;
    const v: any = c.valeur || {};
    const premier = !inities.has(`init:${c.id}`);
    if (premier) { nouveaux++; releves.push(releve(ctx, kind, `init:${c.id}`, {})); }

    // a) Le site : un changement commercial depuis la semaine dernière ?
    if (v.site && deps.lectureConfiguree()) {
      essais++;
      const contenu = await deps.lirePage(ctx.userId, v.site).catch(() => null);
      if (!contenu) { echecs++; }
      else {
        const cle = `site:${c.id}`;
        const prec = (await derniers(ctx, kind, [cle])).get(cle);
        const hash = empreinte(contenu);
        releves.push(releve(ctx, kind, cle, { hash, extrait: contenu.slice(0, 4000) }));
        if (prec?.hash && prec.hash !== hash) {
          try {
            const raw = await deps.ia(ctx.userId, ctx.projectId, SYSTEME_OFFRE,
              `Concurrent : ${c.libelle}\n\nAVANT :\n${String(prec.extrait || "").slice(0, 3000)}\n\nMAINTENANT :\n${contenu.slice(0, 3000)}`);
            const r = lireResumeOffre(raw);
            if (r?.changement && r.resume) {
              constats.push({ type: "offre_concurrent", titre: `${c.libelle} : du nouveau sur son site`, texte: r.resume, preuve: { url: v.site } });
            }
          } catch (e: any) {
            derniereErreur = e?.message || String(e);
          }
        }
      }
    }

    // b) L'actualité de la semaine.
    if (deps.serpConfigure()) {
      essais++;
      try {
        const res = (await deps.chercher(ctx.userId, `"${c.libelle}"`, { ...OPTS_RECHERCHE, vertical: "news", freshness: "week" })).slice(0, 5);
        const cles = res.map((r) => `actu:${empreinte(r.link)}`);
        const vus = await derniers(ctx, kind, cles);
        let n = 0;
        res.forEach((r, i) => {
          if (vus.has(cles[i])) return;
          releves.push(releve(ctx, kind, cles[i], { titre: r.title }));
          if (premier || n >= 3) return;
          n++;
          constats.push({
            type: "actu_concurrent", titre: `${c.libelle} dans l'actualité`,
            texte: `${r.title}${r.source ? ` (${r.source})` : ""}`, preuve: { url: r.link, source: r.source },
          });
        });
      } catch (e: any) {
        echecs++;
        derniereErreur = e?.message || String(e);
      }
    }

    // c) Les contenus forts sur Instagram (engagement normalisé, jamais d'abonnés comparés).
    if (v.instagram && deps.instagramConfigure()) {
      essais++;
      const raw = await deps.instagram(ctx.userId, urlInstagram(v.instagram)).catch(() => null);
      if (!raw) { echecs++; }
      else {
        const forts = contenusForts(engagementPosts(raw));
        const cles = forts.map((p) => `insta:${empreinte(p.url)}`);
        const vus = await derniers(ctx, kind, cles);
        forts.forEach((p, i) => {
          if (vus.has(cles[i])) return;
          releves.push(releve(ctx, kind, cles[i], { taux: p.taux }));
          if (premier) return;
          constats.push({
            type: "contenu_fort", titre: `Un post fort de ${c.libelle}`,
            texte: `Engagement de ${(p.taux * 100).toFixed(1)} %, plus du double de sa moyenne.${p.legende ? ` « ${p.legende} »` : ""}`,
            preuve: { url: p.url },
          });
        });
      }
    }
  }

  await deps.storage.addVeilleReleves(releves);
  const details = { concurrents: cibles.length, essais, echecs };
  if (essais > 0 && echecs === essais) return panne(kind, derniereErreur, details);
  return conclure(kind, ctx, constats, details, nouveaux > 0
    ? "Point de départ enregistré : Naya signalera les nouveautés de tes concurrents à partir du prochain passage."
    : "Rien de nouveau chez tes concurrents cette semaine.");
}

// ─── 2. Voix du client ────────────────────────────────────────────────────────

function systemeVoc(ctx: Contexte): string {
  const marque = entiteMarque(ctx).nom;
  return `Tu analyses des discussions et des avis publics (forums, Reddit, sites d'avis) pour la marque « ${marque} ». ` +
    `Tu en tires ce qui aide à mieux parler aux clients : objections (freins à l'achat), vocabulaire réel (les mots exacts qu'ils emploient), attentes (bénéfices recherchés), sujets (questions qui reviennent). ` +
    `Règles : uniquement ce qui figure dans les extraits ; un verbatim court et exact, sans pseudo, nom ni adresse ; jamais d'information sur une personne. ` +
    `Réponds en JSON strict : {"constats":[{"type":"objection|vocabulaire|attente|sujet","texte":"une phrase","verbatim":"citation courte","url":"l'URL de l'extrait"}]}. Au plus 8 constats, les plus utiles.`;
}

const TITRE_VOC: Record<string, string> = {
  objection: "Objection entendue", vocabulaire: "Les mots des clients", attente: "Ce qu'ils attendent", sujet: "Une question qui revient",
};

export async function executerVoixClient(routine: Routine, deps: DepsVeille): Promise<ResultatPassage> {
  const d = await preparer(routine, deps, (xs) => suivis(xs, "requete_voc"), "Aucune recherche « voix du client » suivie.");
  if ("fin" in d) return d.fin;
  const { ctx, cibles } = d;
  const kind = KIND_VOIX_CLIENT;
  if (!deps.serpConfigure()) return panne(kind, "Bright Data non configuré", {});
  // Sans lecture de pages, chercher ne servirait à rien : on ne paie pas les recherches.
  if (!deps.lectureConfiguree()) return panne(kind, "lecture de pages non configurée", {});

  const liens: string[] = [];
  let echecs = 0;
  let derniereErreur: string | null = null;
  for (const q of cibles) {
    if (await deps.bloque(ctx.userId)) break;
    try {
      for (const r of (await deps.chercher(ctx.userId, q.libelle, OPTS_RECHERCHE)).slice(0, 10)) {
        if (r.link && !liens.includes(r.link)) liens.push(r.link);
      }
    } catch (e: any) {
      echecs++;
      derniereErreur = e?.message || String(e);
    }
  }
  if (echecs === cibles.length) return panne(kind, derniereErreur, { requetes: cibles.length });

  const cles = liens.map((l) => `url:${empreinte(l)}`);
  const vus = await derniers(ctx, kind, cles);
  const neufs = liens.filter((_, i) => !vus.has(cles[i])).slice(0, LIMITES.pagesVocParPassage);
  const details: Record<string, unknown> = { requetes: cibles.length, liens: liens.length, neufs: neufs.length };
  if (neufs.length === 0) return conclure(kind, ctx, [], details, "Pas de nouvelle discussion cette semaine.");

  const pages: Array<{ url: string; contenu: string }> = [];
  const releves: InsertVeilleReleve[] = [];
  for (const url of neufs) {
    if (await deps.bloque(ctx.userId)) break;
    const contenu = await deps.lirePage(ctx.userId, url).catch(() => null);
    // Une page illisible est notée aussi : elle ne sera pas relue (et repayée) chaque semaine.
    releves.push(releve(ctx, kind, `url:${empreinte(url)}`, { lu: !!contenu }));
    if (contenu) pages.push({ url, contenu: contenu.slice(0, 3000) });
  }
  details.lues = pages.length;
  // Lecture en panne : rien n'est noté, ces pages seront retentées la semaine prochaine.
  if (pages.length === 0) return panne(kind, "aucune page lisible", details);

  let constats: ConstatBrut[] = [];
  try {
    const raw = await deps.ia(ctx.userId, ctx.projectId, systemeVoc(ctx),
      pages.map((p) => `### ${p.url}\n${p.contenu}`).join("\n\n"));
    const lus = lireConstatsVoc(raw, new Set(pages.map((p) => p.url)));
    const connus = (await deps.storage.getVeilleConstats(ctx.userId, ctx.projectId, { limite: 300 }))
      .filter((c) => c.kind === kind).map((c) => c.texte);
    constats = dedoublonnerConstats(connus, lus).map((c) => ({
      type: c.type, titre: TITRE_VOC[c.type], texte: c.texte, preuve: { url: c.url, extrait: c.verbatim || undefined },
    }));
  } catch (e: any) {
    // Analyse échouée : les pages ne sont pas notées comme lues, elles seront reprises.
    return { statut: "erreur", resume: "L'analyse des discussions a échoué : Naya réessaiera la semaine prochaine.", details: { ...details, raison: e?.message } };
  }
  await deps.storage.addVeilleReleves(releves);
  return conclure(kind, ctx, constats, details, "Rien de neuf dans ce que disent les clients cette semaine.");
}

// ─── 3. Positions Google ──────────────────────────────────────────────────────

export async function executerSerp(routine: Routine, deps: DepsVeille): Promise<ResultatPassage> {
  const d = await preparer(routine, deps, (xs) => suivis(xs, "mot_cle"), "Aucun mot-clé suivi.");
  if ("fin" in d) return d.fin;
  const { ctx, cibles } = d;
  const kind = KIND_SERP;
  const marque = entiteMarque(ctx);
  const concurrents = entitesConcurrents(ctx);
  const entites = [{ cle: "marque", domaine: marque.domaine }, ...concurrents];
  const domaines: Record<string, string | null> = Object.fromEntries(entites.map((e) => [e.cle, e.domaine]));
  if (entites.every((e) => !e.domaine)) {
    return { statut: "rien_a_faire", resume: "Ajoute le site de ta marque (ou de tes concurrents) pour suivre les positions Google." };
  }
  if (!deps.serpConfigure()) return panne(kind, "Bright Data non configuré", {});

  const cles = cibles.map((k) => `serp:${k.id}`);
  const prec = await derniers(ctx, kind, cles);
  const premierPassage = prec.size === 0;
  const constats: ConstatBrut[] = [];
  const releves: InsertVeilleReleve[] = [];
  const toutes: Positions[] = [];
  let echecs = 0;
  let derniereErreur: string | null = null;
  for (const [i, k] of cibles.entries()) {
    if (await deps.bloque(ctx.userId)) break;
    try {
      const res = await deps.chercher(ctx.userId, k.libelle, OPTS_RECHERCHE);
      const pos = positions(res, entites);
      toutes.push(pos);
      releves.push(releve(ctx, kind, cles[i], { positions: pos, entites: domaines, top: res.slice(0, 10).map((r) => domaineDe(r.link)) }));
      constats.push(...comparerSerp(comparables(prec.get(cles[i]), domaines), pos, { motCle: k.libelle, marqueCle: "marque", concurrents }));
    } catch (e: any) {
      echecs++;
      derniereErreur = e?.message || String(e);
    }
  }
  await deps.storage.addVeilleReleves(releves);
  const details = { motsCles: cibles.length, echecs };
  if (echecs === cibles.length) return panne(kind, derniereErreur, details);
  if (premierPassage && marque.domaine && toutes.length > 0) {
    const b = bilanSerp(toutes, "marque");
    constats.unshift({ type: "bilan_serp", titre: "Point de départ sur Google", texte: `Ta marque apparaît dans les 10 premiers résultats sur ${b.presentes} des ${b.total} requêtes suivies.` });
  }
  return conclure(kind, ctx, constats, details, "Positions Google stables cette semaine.");
}

/**
 * Positions précédentes réellement comparables : une entité dont le site a changé (ou qui a été
 * ajoutée) depuis le dernier relevé en est retirée, et repart d'un point de départ.
 */
function comparables(prec: any, domaines: Record<string, string | null>): Positions | null {
  if (!prec?.positions) return null;
  if (!prec.entites) return prec.positions;
  const out: Positions = {};
  for (const [cle, pos] of Object.entries(prec.positions as Positions)) {
    if (cle in domaines && prec.entites[cle] === domaines[cle]) out[cle] = pos;
  }
  return out;
}

// ─── 4. Réponses des IA (GEO) ─────────────────────────────────────────────────

export async function executerGeo(routine: Routine, deps: DepsVeille): Promise<ResultatPassage> {
  const d = await preparer(routine, deps, (xs) => suivis(xs, "prompt_geo"), "Aucune question suivie auprès des IA.");
  if ("fin" in d) return d.fin;
  const { ctx, cibles } = d;
  const kind = KIND_GEO;
  let moteurs = deps.moteurs();
  if (moteurs.length === 0) return panne(kind, "aucune IA branchée (clé OpenAI ou Perplexity absente)", {});
  // Budget : hors propriétaire, une seule IA et quelques questions par passage, pour que la
  // veille ne consomme pas à elle seule le budget du mois (et ne bloque pas le reste de Naya).
  let questions = cibles;
  if (!(await deps.illimite(ctx.userId))) {
    moteurs = moteurs.slice(0, 1);
    questions = cibles.slice(0, LIMITES.geoQuestionsStandard);
  }
  const marque = entiteMarque(ctx);
  const concurrents = entitesConcurrents(ctx);
  // Configuration au moment du relevé : une marque reconfigurée ou un concurrent ajouté depuis
  // ne sont pas des « changements » des réponses.
  const config = { marque: `${marque.nom}|${(marque.variantes || []).join(",")}|${marque.domaine || ""}`, concurrents: concurrents.map((c) => c.nom) };

  const paires = questions.flatMap((p) => moteurs.map((m) => ({ p, m, cle: `geo:${m}:${p.id}` })));
  const prec = await derniers(ctx, kind, paires.map((x) => x.cle));
  const premierPassage = prec.size === 0;
  const constats: ConstatBrut[] = [];
  const releves: InsertVeilleReleve[] = [];
  const analyses: AnalyseGeo[] = [];
  let echecs = 0, essais = 0;
  let derniereErreur: string | null = null;
  const parMoteur = new Map<string, { essais: number; echecs: number; raison: string | null }>();
  for (const { p, m, cle } of paires) {
    if (await deps.bloque(ctx.userId)) break;
    essais++;
    const st = parMoteur.get(m) ?? { essais: 0, echecs: 0, raison: null };
    st.essais++;
    parMoteur.set(m, st);
    try {
      const rep = await deps.interroger(ctx.userId, m, p.libelle);
      const a = analyserReponse(rep, marque, concurrents);
      analyses.push(a);
      releves.push(releve(ctx, kind, cle, { analyse: a, config, texte: rep.texte.slice(0, 1500), citations: rep.citations.slice(0, 15) }));
      const avant = prec.get(cle);
      constats.push(...comparerGeo(avant?.analyse ?? null, a, p.libelle, m, {
        marqueComparable: !avant?.config || avant.config.marque === config.marque,
        concurrentsAvant: avant?.config?.concurrents,
      }));
    } catch (e: any) {
      echecs++;
      st.echecs++;
      st.raison = e?.message || String(e);
      derniereErreur = st.raison;
    }
  }
  const details = { questions: questions.length, moteurs, essais, echecs };
  if (essais > 0 && echecs === essais) { await deps.storage.addVeilleReleves(releves); return panne(kind, derniereErreur, details); }

  // Sources à travailler : signalées quand la liste des domaines change, pas chaque semaine.
  if (analyses.length > 0) {
    const sources = sourcesATravailler(analyses);
    const domaines = sources.map((x) => x.domaine).sort();
    const avant = (await derniers(ctx, kind, ["sources_geo"])).get("sources_geo");
    const memes = Array.isArray(avant?.domaines) && avant.domaines.length === domaines.length
      && avant.domaines.every((d: string, i: number) => d === domaines[i]);
    releves.push(releve(ctx, kind, "sources_geo", { domaines }));
    if (sources.length > 0 && !memes) {
      constats.push({
        type: "source_geo", titre: "Les sources à travailler pour les IA",
        texte: `Quand tes concurrents sont cités sans toi, les IA s'appuient sur : ${sources.map((x) => `${x.domaine} (${x.n})`).join(", ")}. Y être présente (article, avis, comparatif) aide à être citée.`,
      });
    }
  }
  if (premierPassage && analyses.length > 0) {
    const b = bilanGeo(analyses);
    constats.unshift({ type: "bilan_geo", titre: "Point de départ dans les réponses des IA", texte: `Ta marque est citée dans ${b.citees} des ${b.total} réponses obtenues.` });
  }
  await deps.storage.addVeilleReleves(releves);
  const res = await conclure(kind, ctx, constats, details, "Les réponses des IA n'ont pas bougé cette semaine.");
  // Une IA qui n'a répondu à aucune question (clé refusée…) est signalée, même si l'autre a marché.
  const enPanne = Array.from(parMoteur).filter(([, st]) => st.essais > 0 && st.echecs === st.essais);
  if (enPanne.length > 0) {
    res.resume += ` ${enPanne.map(([m, st]) => `${nomMoteur(m)} n'a pas répondu (${st.raison}).`).join(" ")}`;
  }
  return res;
}
