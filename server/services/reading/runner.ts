import { db } from "../../db";
import { and, eq, lt, gte } from "drizzle-orm";
import { readingCards, projects } from "@shared/schema";
import { etage1, noterCandidats, selectionFinale, MAX_FICHES, SEUIL_RETENTION } from "./triage";
import type { CandidatBrut } from "./triage";
import { assurerRequetes } from "./queries";
import { sourcerCandidats, MAX_REQUETES_SERP_PAR_JOUR } from "./source";
import { redigerFiche } from "./card";
import { retrieveMemories } from "../memory/retrieve";
import { serpConfigured } from "../serp";
import { webScrapeConfigured } from "../brightdata-enrich";
import { isAiBlocked } from "../usage";

export interface DepsLecture {
  projetsActifs: (userId: string) => Promise<Array<{ id: number; name: string }>>;
  requetes: (userId: string, projectId: number, today: Date) => Promise<string[]>;
  sourcer: (input: { userId: string; today: Date; parProjet: Array<{ projectId: number; requetes: string[] }> }) => Promise<CandidatBrut[]>;
  hashDejaVus: (userId: string) => Promise<Set<string>>;
  contexteMarque: (userId: string, projectId: number) => Promise<string>;
  noter: typeof noterCandidats;
  rediger: typeof redigerFiche;
  ecrire: (ligne: typeof readingCards.$inferInsert) => Promise<void>;
  expirer: (userId: string, today: Date) => Promise<number>;
  // Tous statuts confondus (y compris `rejected` et `expired`) : une fiche déjà passée
  // aujourd'hui ne libère pas de place, sinon la remplacer serait exactement le
  // « compléter pour atteindre trois » que le projet interdit.
  compterFichesDuJour: (userId: string, today: Date) => Promise<number>;
  // L'accès aux données externes (SERP + scrape) est-il configuré ? Un collaborateur
  // ordinaire, injectable et testable — pas une comparaison d'identité sur depsParDefaut,
  // qui ne peut jamais être vraie dès qu'un objet deps distinct est injecté en test.
  accesExterneConfigure: () => boolean;
  // Le garde-fou de dépense de usage.ts. Injectable pour la même raison que le
  // précédent : le vrai isAiBlocked interroge la base, un test qui injecte ses deps
  // ne doit jamais l'atteindre.
  depenseBloquee: (userId: string) => Promise<boolean>;
}

const debutDuJour = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Les fiches non traitées de la veille passent en `expired`. En silence : aucun report,
 * aucun cumul, aucune notification. Les lignes RESTENT en base — c'est elles qui
 * empêchent une URL d'être reproposée.
 */
export async function expirerFichesDeLaVeille(userId: string, today: Date): Promise<number> {
  const res = await db
    .update(readingCards)
    .set({ status: "expired" })
    .where(and(eq(readingCards.userId, userId), eq(readingCards.status, "proposed"), lt(readingCards.createdAt, debutDuJour(today))))
    .returning({ id: readingCards.id });
  return res.length;
}

const depsParDefaut: DepsLecture = {
  // ORDER BY explicite et stable. Sans lui, la file suivait l'ordre physique de
  // Postgres, qui peut changer d'un jour à l'autre (VACUUM, mise à jour d'une ligne) :
  // combiné au plafond de requêtes SERP, non seulement certaines marques pouvaient
  // n'être jamais veillées, mais LESQUELLES était indéterminé — un comportement qu'on
  // ne peut ni reproduire ni constater. Le tourniquet de sourcerCandidats sert
  // désormais toutes les marques ; cet ordre rend le reste déterministe.
  projetsActifs: async (userId) =>
    db.select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.projectStatus, "active")))
      .orderBy(projects.id),
  requetes: assurerRequetes,
  sourcer: sourcerCandidats,
  hashDejaVus: async (userId) => {
    const rows = await db.select({ h: readingCards.urlHash }).from(readingCards).where(eq(readingCards.userId, userId));
    return new Set(rows.map((r) => r.h));
  },
  contexteMarque: async (userId, projectId) => {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    const mem = await retrieveMemories(userId, projectId, "actualité du marché").catch(() => null);
    const cap = mem?.cap?.map((m) => `- ${m.content}`).join("\n") ?? "";
    return [
      `Marque : ${p?.name ?? projectId}`,
      p?.description ? `Description : ${p.description}` : "",
      p?.statusNote ? `Où en est la marque : ${p.statusNote}` : "",
      cap ? `Ce qui compte pour cette marque :\n${cap}` : "",
    ].filter(Boolean).join("\n");
  },
  noter: noterCandidats,
  rediger: redigerFiche,
  ecrire: async (ligne) => { await db.insert(readingCards).values(ligne).onConflictDoNothing(); },
  expirer: expirerFichesDeLaVeille,
  compterFichesDuJour: async (userId, today) => {
    const rows = await db
      .select({ id: readingCards.id })
      .from(readingCards)
      .where(and(eq(readingCards.userId, userId), gte(readingCards.createdAt, debutDuJour(today))));
    return rows.length;
  },
  accesExterneConfigure: () => serpConfigured() && webScrapeConfigured(),
  depenseBloquee: isAiBlocked,
};

/**
 * La revue du matin, pour un utilisateur. Best-effort de bout en bout : chaque étape est
 * gardée, une marque qui échoue n'empêche pas les autres, et l'absence de clé Bright Data
 * arrête la revue sans réveiller la moindre erreur visible.
 */
export async function runReadingRoom(
  userId: string,
  today: Date,
  deps: DepsLecture = depsParDefaut,
): Promise<{ fichesEcrites: number }> {
  // L'expiration a lieu AVANT tout le reste et quoi qu'il arrive ensuite : une revue
  // qui ne tourne pas ne doit pas laisser les fiches d'hier traîner un jour de plus.
  await deps.expirer(userId, today).catch((err: any) => {
    console.error(`[Lecture] expiration échouée pour ${userId}:`, err?.message);
    return 0;
  });

  // Garde-fou de dépense, exigé deux fois par le spec et jusqu'ici appelé NULLE PART
  // dans la lecture : callClaude comptabilise la dépense mais ne bloque jamais, donc
  // la revue était la seule consommatrice d'IA capable de dépasser le plafond sans
  // s'en apercevoir, tous les matins, sans qu'aucune surface ne puisse le montrer.
  // Sa place est ICI, après l'expiration : l'expiration reste inconditionnelle (les
  // fiches d'hier disparaissent même un jour où la revue ne tourne pas), le reste
  // s'arrête proprement. En cas d'échec du test lui-même, on suppose bloqué
  // (fail closed) — même arbitrage que compterFichesDuJour plus bas : une base qui ne
  // répond pas ferait de toute façon échouer les écritures, et un plafond de dépense
  // qu'on franchit sur une erreur de lecture ne protège plus rien.
  const depenseBloquee = await deps.depenseBloquee(userId).catch((err: any) => {
    console.error(`[Lecture] garde-fou de dépense illisible pour ${userId} — revue arrêtée par précaution:`, err?.message);
    return true;
  });
  if (depenseBloquee) {
    console.info(`[Lecture] plafond de dépense IA atteint pour ${userId} — revue arrêtée, zéro fiche`);
    return { fichesEcrites: 0 };
  }

  if (!deps.accesExterneConfigure()) {
    console.info("[Lecture] Bright Data non configuré — revue non exécutée");
    return { fichesEcrites: 0 };
  }

  // UNE ligne de journal récapitulative en fin de passage. Sans elle, « zéro fiche »
  // dans les journaux est indiscernable d'un prompt de génération cassé, d'une clé
  // Bright Data expirée, d'un modèle qui sature ses jetons ou de seize marques jamais
  // servies : chaque étape a bien son log d'échec, mais aucun ne dit ce qui s'est passé
  // quand rien n'échoue et que rien ne sort. Le produit s'interdit tout compteur et tout
  // message visible, donc une défaillance silencieuse est structurellement indétectable
  // par l'utilisatrice : le journal serveur est le seul organe de détection. Côté serveur
  // uniquement — aucun garde-fou produit n'est concerné.
  const bilan = { marques: 0, requetes: 0, bruts: 0, survivants: 0, auDessusDuSeuil: 0, fiches: 0, lecturesEnEchec: 0 };
  const journaliserBilan = () => {
    console.info(
      `[Lecture] bilan ${userId} — marques veillées ${bilan.marques}, requêtes ${bilan.requetes}, ` +
        `candidats bruts ${bilan.bruts}, survivants étage 1 ${bilan.survivants}, ` +
        `au-dessus du seuil ${bilan.auDessusDuSeuil}, fiches écrites ${bilan.fiches}, ` +
        `lectures en échec ${bilan.lecturesEnEchec}`,
    );
  };
  const terminer = () => {
    journaliserBilan();
    return { fichesEcrites: bilan.fiches };
  };

  const projets = await deps.projetsActifs(userId).catch(() => []);
  if (projets.length === 0) return terminer();

  const parProjet: Array<{ projectId: number; requetes: string[] }> = [];
  for (const p of projets) {
    try {
      const requetes = await deps.requetes(userId, p.id, today);
      if (requetes.length) parProjet.push({ projectId: p.id, requetes });
    } catch (err: any) {
      console.error(`[Lecture] requêtes projet ${p.id} échouées:`, err?.message);
    }
  }
  if (parProjet.length === 0) return terminer();
  bilan.marques = parProjet.length;
  // « Requêtes exécutées » et non « transmises » : sourcerCandidats tente TOUTES les
  // requêtes de sa file jusqu'au plafond (chaque échec a déjà son propre log), donc le
  // nombre exécuté est le minimum des deux. Miroir assumé du plafond de source.ts.
  const requetesTransmises = parProjet.reduce((n, p) => n + p.requetes.length, 0);
  bilan.requetes = Math.min(requetesTransmises, MAX_REQUETES_SERP_PAR_JOUR);

  const bruts = await deps.sourcer({ userId, today, parProjet }).catch((err: any) => {
    console.error(`[Lecture] sourcing échoué pour ${userId}:`, err?.message);
    return [];
  });
  bilan.bruts = bruts.length;
  if (bruts.length === 0) return terminer();

  const dejaVus = await deps.hashDejaVus(userId).catch(() => new Set<string>());
  const candidats = etage1(bruts, { today, urlHashDejaVus: dejaVus });
  bilan.survivants = candidats.length;
  if (candidats.length === 0) return terminer();

  // Étage 2 : UN appel par marque, sur ses propres candidats.
  const notes: Array<{ url: string; score: number; rationale: string }> = [];
  for (const p of projets) {
    const duProjet = candidats.filter((c) => c.projectId === p.id);
    if (duProjet.length === 0) continue;
    try {
      const contexte = await deps.contexteMarque(userId, p.id);
      notes.push(...(await deps.noter({ userId, projectId: p.id, contexteMarque: contexte, candidats: duProjet })));
    } catch (err: any) {
      console.error(`[Lecture] notation projet ${p.id} échouée:`, err?.message);
    }
  }

  // Compté sur les notes, pas sur `retenus` : `retenus` a déjà subi le plafond de 3 et
  // le maximum de 2 par marque, donc les deux nombres ensemble distinguent « rien n'a
  // passé le seuil » de « le plafond a tranché ».
  bilan.auDessusDuSeuil = notes.filter((n) => n.score >= SEUIL_RETENTION).length;

  const retenus = selectionFinale(candidats, notes);
  if (retenus.length === 0) return terminer();

  // Le plafond de MAX_FICHES (3) fiches est JOURNALIER, pas par exécution : sans ce
  // garde, une deuxième exécution le même jour (endpoint manuel après le cron) pourrait
  // écrire jusqu'à 3 fiches de plus. On compte TOUS les statuts, y compris `rejected`
  // et `expired` — une fiche déjà passée ce matin ne libère pas de place. En cas d'échec
  // du comptage, on suppose le plafond déjà atteint (fail closed) : mieux vaut une revue
  // manquée qu'un dépassement silencieux du plafond que ce garde existe pour tenir.
  const dejaEcritesAujourdhui = await deps.compterFichesDuJour(userId, today).catch((err: any) => {
    console.error(`[Lecture] comptage des fiches du jour échoué pour ${userId}:`, err?.message);
    return MAX_FICHES;
  });
  const solde = Math.max(0, MAX_FICHES - dejaEcritesAujourdhui);
  if (solde === 0) {
    console.info(`[Lecture] plafond quotidien de ${MAX_FICHES} fiches déjà atteint pour ${userId} — revue arrêtée sans écriture`);
    return terminer();
  }
  const finDeJournee = new Date(debutDuJour(today).getTime() + 24 * 3600 * 1000 - 1);
  let fichesEcrites = 0;
  let lecturesEnEchec = 0;

  // REPÊCHAGE. La version précédente tranchait la liste à `retenus.slice(0, solde)`
  // AVANT la boucle de rédaction, donc un candidat dont le scrape échoue — cas courant
  // sur la presse payante — consommait une place du plafond sans écrire la moindre
  // ligne. Or c'est la ligne écrite qui fait entrer l'URL dans la mémoire « déjà vu » :
  // l'article revenait donc en tête le lendemain, reprenait la même place, et
  // recommençait jusqu'à sortir de la fenêtre de sept jours. Trois articles payants en
  // tête de classement = une semaine de revue vide, en silence. On parcourt maintenant
  // TOUS les retenus et on ne s'arrête qu'au solde atteint ou aux candidats épuisés.
  //
  // Et on n'écrit AUCUNE ligne marqueur pour ces échecs : le comptage du plafond
  // quotidien porte volontairement sur tous les statuts, donc un marqueur volerait la
  // place qu'on vient de rendre. Le coût assumé est d'une tentative de scrape par jour
  // pour un article payant ; ce qu'on refuse, c'est qu'il vole une place.
  for (const r of retenus) {
    if (fichesEcrites >= solde) break;
    try {
      const fiche = await deps.rediger({ userId, candidat: r });
      // scrape ou rédaction en échec → pas de fiche, jamais de fiche creuse, et on
      // passe au candidat suivant plutôt que de renoncer à la place. Compté pour le
      // bilan : c'est le seul chiffre qui distingue « rien ne méritait son avis » de
      // « trois articles illisibles », deux situations identiques côté écran.
      if (!fiche) {
        lecturesEnEchec += 1;
        continue;
      }
      await deps.ecrire({
        userId,
        projectId: r.projectId,
        url: r.url,
        urlHash: r.urlHash,
        title: r.title,
        source: r.source,
        publishedAt: r.publishedAt,
        relevanceScore: r.score,
        relevanceRationale: r.rationale,
        factSummary: fiche.factSummary,
        whyThisBrand: fiche.whyThisBrand,
        angle: fiche.angle,
        question: fiche.question,
        status: "proposed",
        expiresAt: finDeJournee,
      });
      fichesEcrites += 1;
    } catch (err: any) {
      console.error(`[Lecture] écriture de fiche échouée pour ${r.url}:`, err?.message);
    }
  }

  bilan.fiches = fichesEcrites;
  bilan.lecturesEnEchec = lecturesEnEchec;
  return terminer();
}
