# Les profils de veille — lot 1 (socle + Instagram) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque marque de Naya est rangée dans un profil de veille partagé ; un robot suit 15 comptes Instagram de référence par profil, repère les contenus forts, en déduit chaque semaine les formats qui performent, et les livre à chaque marque (rendez-vous hebdo + injection dans la rédaction de contenu).

**Architecture :** module à part `server/services/profils-veille/` (règles pures dans `shared/profils-veille.ts`, dépendances injectées comme `veille/` et `atelier/`, requêtes dans `stockage.ts`). Tables partagées sans donnée privée ; coût imputé au profil (plafond 10 €/mois). Un planificateur toutes les 15 min, idempotent par contraintes d'unicité (rattachement, collecte lun/mer/ven, analyse le dimanche via l'API Batch, tri par marque, rétention). Réponses IA en sorties structurées validées (extension du fournisseur IA).

**Tech Stack :** TypeScript, Express, Drizzle (PostgreSQL / Neon), Vitest, React + TanStack Query + react-i18next, SDK Anthropic 0.78 (`output_config.format`, `messages.batches`), `zod/v4` (`toJSONSchema`), Bright Data datasets v3.

**Spec :** `docs/superpowers/specs/2026-10-14-profils-de-veille-design.md` (à lire avant toute tâche).

## Global Constraints

- Vocabulaire : *profil de veille*, jamais *persona* (code, interface, prompts).
- Plafond dur **10 € / profil / mois** (collecte + analyse) ; un profil n'est collecté que s'il est `actif` **et** a au moins un projet actif rattaché (`propose` ou `confirme`).
- **15 comptes `suivi` par profil et par plateforme** au plus. Lot 1 : plateforme `instagram` seulement (le code accepte les trois valeurs).
- Collecte lundi, mercredi, vendredi à partir de 5 h UTC ; analyse le dimanche à partir de 5 h UTC ; fenêtre d'analyse **14 jours** ; maturité **48 h** ; contenu fort = engagement > **2 × la médiane** des **30** derniers posts mûrs du compte, au moins **8** posts mûrs connus.
- Seuil anti-hasard : `lift ≥ 1,5`, **≥ 3 contenus forts**, **≥ 2 comptes**.
- Au plus **5 tendances par projet et par semaine** ; visibles **28 jours** ; une tendance écartée bloque son format pour ce projet **8 semaines** ; rattachement automatique si confiance **≥ 0,7**.
- Une métrique absente rend l'engagement `null`, jamais 0 (« non mesuré ≠ zéro »).
- Aucun média stocké (lien seulement) ; légendes passées par `anonymiser()` ; posts bruts supprimés à **90 jours**.
- Toute réponse IA du module : sortie structurée validée ; prompts en français ; aucun repli silencieux (échec écrit dans `profil_passages` / `profil_analyses`).
- `npx tsc --noEmit` à zéro erreur ; `npx vitest run` vert ; aucun texte en dur dans le JSX (cliquet `jsx-guard`), clés FR et EN ensemble.
- Migration : `npx drizzle-kit generate` → relire le SQL ligne par ligne → `npm run db:migrate` **sur la base de dev seulement**. Jamais `db:push`. La production est une étape manuelle de Jeanne (sauvegarde Neon avant).
- La diffusion aux utilisatrices (tri par marque, carte, onglet) n'est active que pour le rôle `owner` tant que `PROFILS_VEILLE_POUR_TOUS !== "true"` (variable posée par Jeanne après le banc d'évaluation, Tâche 13).

## Review Focus

1. **Métrique absente** (likes masqués, abonnés inconnus) → engagement `null`, post jamais « fort », jamais compté comme 0 dans la médiane. Test : Tâche 1 (`engagementDe`, `estFort`) et Tâche 5 (post sans likes).
2. **Double passage** (deux instances, redémarrage, « Lancer maintenant » pendant le planificateur) → un seul passage par profil × plateforme × jour, aucun post en double. Test : Tâche 5 (`reserverPassage` renvoie `null` → rien n'est collecté).
3. **Plafond atteint en cours de mois** → plus de collecte ni d'analyse, une seule ligne de passage `plafond` par jour, visible dans l'admin. Test : Tâches 5 et 6.
4. **Tendance d'un autre compte, expirée, écartée ou d'une autre plateforme** → jamais injectée, 404 sur les routes. Test : Tâches 8 et 10.
5. **Réponse Bright Data partielle** (un compte en erreur, ou tout le lot en échec) → les autres comptes sont traités ; un compte ne passe `injoignable` qu'après 2 échecs consécutifs qui lui sont propres ; un échec global ne pénalise aucun compte. Test : Tâche 5.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `shared/profils-veille.ts` (+ `.test.ts`) | Règles pures et constantes (engagement, maturité, fort, formats, seuils, semaines, comptes, créneau) |
| `shared/schema.ts` | Tables `profils_veille`, `profil_comptes`, `profil_rattachements`, `profil_posts`, `profil_passages`, `profil_analyses`, `profil_tendances`, `tendances_projet`, `profil_etiquettes` ; colonnes `content.tendance_id`, `content.tendance_projet_id` |
| `migrations/0031_*.sql` | Migration générée |
| `server/services/ai/types.ts`, `providers/anthropic.ts`, `providers/openai.ts`, `server/services/claude.ts` | Option `schema` (sortie structurée) ; `callClaudeDetailed` renvoie `coutEur` |
| `server/services/ai/structure.ts` (+ test) | `schemaJson`, `lireStructure`, `genererStructure` |
| `server/services/ai/lots.ts` (+ test) | `soumettreLot`, `lireLot` (API Batch) |
| `server/services/brightdata-enrich.ts` | `collecterParLot` (plusieurs URL, toutes les lignes) |
| `server/services/profils-veille/collecte/instagram.ts` (+ test) | Adaptateur : réponse Bright Data → `ProfilCollecte` |
| `server/services/profils-veille/collecte.ts` (+ test) | Un passage de collecte d'un profil × plateforme |
| `server/services/profils-veille/analyse.ts` (+ test) | Classement, comptage, soumission et lecture du lot, écriture des tendances |
| `server/services/profils-veille/rattachement.ts` (+ test) | Rattachement d'un projet, proposition de nouveau profil |
| `server/services/profils-veille/tri.ts` (+ test) | Tri par marque, bloc d'injection `tendancesPourLeContenu` |
| `server/services/profils-veille/planificateur.ts` (+ test) | Le tour toutes les 15 min |
| `server/services/profils-veille/stockage.ts` | Toutes les requêtes Drizzle du module |
| `server/services/profils-veille/deps.ts` | Les vraies dépendances (stockage, IA, Bright Data, SERP) |
| `server/routes-profils-veille.ts` (+ test) | Routes admin (`owner`) et utilisatrice |
| `server/services/atelier/redaction.ts`, `deps.ts`, `shared/atelier.ts` | Post issu d'une tendance = « à rédiger » ; injection ; `TENDANCE: <id>` |
| `server/services/openai.ts`, `server/routes.ts`, `server/services/refus-post/remplacement.ts` | Injection du bloc dans les autres générateurs |
| `server/index.ts` | `scheduleProfilsVeille()` |
| `client/src/pages/admin-profils-veille.tsx` | Admin : catalogue, panels, propositions, tendances, coût, étiquetage |
| `client/src/components/tendances-secteur.tsx` | « Ce qui marche dans ton secteur » (onglet Veille + carte du lundi) |
| `client/src/locales/fr.ts`, `en.ts` | Clés `tendancesSecteur.*`, `adminProfils.*` |
| `scripts/evaluer-classement.ts` | Banc d'évaluation du classement |

---

### Task 1 : Règles pures `shared/profils-veille.ts`

**Files :**
- Create : `shared/profils-veille.ts`
- Test : `shared/profils-veille.test.ts`

**Interfaces :**
- Consumes : `lundiDe(jour: string): string`, `plusJours(jour: string, n: number): string` de `@shared/atelier`.
- Produces (utilisés par toutes les tâches suivantes) :
  - `PLATEFORMES_VEILLE`, `type PlateformeVeille`, `PLATEFORMES_LOT1: PlateformeVeille[]`
  - `TYPES_MEDIA`, `type TypeMedia`, `STRUCTURES`, `type Structure`, `ACCROCHES`, `type Accroche`, `LIBELLES_STRUCTURE`, `LIBELLES_MEDIA`
  - `REGLES` (constantes chiffrées)
  - `interface Metriques`, `engagementDe(plateforme, m, abonnes): number | null`
  - `estMur(publieLe: Date | string | null, maintenant: Date): boolean`
  - `mediane(xs: number[]): number | null`, `estFort(e: number | null, historique: number[]): boolean | null`
  - `interface PostFenetre`, `interface StatFormat`, `cleFormat(...)`, `statsFormats(posts)`, `formatsRetenus(stats)`, `enBaisse(precedentes, retenues, stats)`
  - `semaineDe(d: Date): string`, `semaineAnalysee(dimanche: Date): string`, `moisDe(d: Date): string`, `jourDe(d: Date): string`
  - `clesEcartees(ecartees, maintenant): Set<string>`, `tendanceVisible(t, maintenant): boolean`
  - `creneauTendance(maintenant: Date): Date`
  - `normaliserCompteInstagram(saisie: string): { compte: string; url: string } | null`, `handlesInstagram(liens: string[]): string[]`, `cleDePost(url: string): string`
  - `extraireTendance(texte: string): { texte: string; tendanceId: number | null }`
  - `libelleFormat(typeMedia: TypeMedia, structure: Structure): string`

- [ ] **Step 1 : Écrire les tests (ils échouent)**

```ts
// shared/profils-veille.test.ts
import { describe, it, expect } from "vitest";
import {
  REGLES, engagementDe, estMur, mediane, estFort, statsFormats, formatsRetenus, enBaisse, cleFormat,
  semaineDe, semaineAnalysee, moisDe, jourDe, clesEcartees, tendanceVisible, creneauTendance,
  normaliserCompteInstagram, handlesInstagram, cleDePost, extraireTendance, libelleFormat, type PostFenetre,
} from "./profils-veille";

describe("engagementDe", () => {
  it("instagram : (likes + commentaires) / abonnés", () => {
    expect(engagementDe("instagram", { likes: 90, commentaires: 10 }, 1000)).toBeCloseTo(0.1);
  });
  it("tiktok : (likes + commentaires + partages) / vues", () => {
    expect(engagementDe("tiktok", { likes: 50, commentaires: 30, partages: 20, vues: 1000 }, null)).toBeCloseTo(0.1);
  });
  it("linkedin : (likes + commentaires + republications) / abonnés", () => {
    expect(engagementDe("linkedin", { likes: 5, commentaires: 3, republications: 2 }, 100)).toBeCloseTo(0.1);
  });
  it("une métrique absente ou un dénominateur nul rend null, jamais 0", () => {
    expect(engagementDe("instagram", { commentaires: 10 }, 1000)).toBeNull();
    expect(engagementDe("instagram", { likes: 10, commentaires: 1 }, null)).toBeNull();
    expect(engagementDe("instagram", { likes: 10, commentaires: 1 }, 0)).toBeNull();
    expect(engagementDe("tiktok", { likes: 1, commentaires: 1, partages: 1 }, 500)).toBeNull();
  });
  it("instagram : commentaires absents comptent pour 0 seulement si les likes sont là", () => {
    expect(engagementDe("instagram", { likes: 100 }, 1000)).toBeCloseTo(0.1);
  });
});

describe("maturité et contenu fort", () => {
  const maintenant = new Date("2026-10-14T10:00:00Z");
  it("mûr à partir de 48 h", () => {
    expect(estMur("2026-10-12T10:00:00Z", maintenant)).toBe(true);
    expect(estMur("2026-10-12T10:00:01Z", maintenant)).toBe(false);
    expect(estMur(null, maintenant)).toBe(false);
  });
  it("médiane", () => {
    expect(mediane([])).toBeNull();
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 2, 3])).toBe(2.5);
  });
  it("fort = plus de 2 × la médiane, avec au moins 8 posts mûrs", () => {
    const hist = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
    expect(estFort(0.03, hist)).toBe(true);
    expect(estFort(0.02, hist)).toBe(false);
    expect(estFort(0.03, hist.slice(0, 7))).toBeNull();
    expect(estFort(null, hist)).toBeNull();
  });
  it("ne garde que les 30 derniers posts de l'historique", () => {
    const vieux = Array(30).fill(0.001);
    const recents = Array(30).fill(0.1);
    expect(estFort(0.15, [...recents, ...vieux])).toBe(false); // médiane 0.1 (30 premiers = les plus récents)
  });
});

describe("formats", () => {
  const p = (cle: string, compteId: number, structure: any, fort: boolean | null, typeMedia: any = "carrousel"): PostFenetre =>
    ({ cle, compteId, plateforme: "instagram", typeMedia, structure, fort });
  const posts: PostFenetre[] = [
    p("a", 1, "avant_apres", true), p("b", 2, "avant_apres", true), p("c", 2, "avant_apres", true), p("d", 1, "avant_apres", false),
    p("e", 1, "tutoriel", false), p("f", 2, "tutoriel", false), p("g", 3, "tutoriel", true), p("h", 3, "tutoriel", false),
    p("i", 3, "liste", false), p("j", 3, "liste", false), p("k", 1, "liste", null), p("l", 1, null, true),
  ];
  it("lift = taux du format / taux global, posts sans fort ni structure ignorés", () => {
    const s = statsFormats(posts).find((x) => x.structure === "avant_apres")!;
    // 10 posts jugés et classés, 4 forts → 0,4 ; avant_apres 3/4 = 0,75 → lift 1,875
    expect(s.nbPosts).toBe(4);
    expect(s.nbForts).toBe(3);
    expect(s.nbComptes).toBe(2);
    expect(s.lift).toBeCloseTo(1.875);
    expect(s.clesForts.sort()).toEqual(["a", "b", "c"]);
    expect(s.cle).toBe(cleFormat("instagram", "carrousel", "avant_apres"));
  });
  it("seuil anti-hasard : lift ≥ 1,5, ≥ 3 forts, ≥ 2 comptes", () => {
    const r = formatsRetenus(statsFormats(posts));
    expect(r.map((x) => x.structure)).toEqual(["avant_apres"]);
    const unSeulCompte = posts.map((x) => ({ ...x, compteId: 1 }));
    expect(formatsRetenus(statsFormats(unSeulCompte))).toEqual([]);
  });
  it("en baisse : retenu la semaine d'avant, plus retenu, lift encore ≥ 1", () => {
    const stats = [{ cle: "x", lift: 1.2 }, { cle: "y", lift: 0.8 }, { cle: "z", lift: 2 }] as any;
    expect(enBaisse([{ cle: "x" }, { cle: "y" }, { cle: "z" }, { cle: "absent" }], new Set(["z"]), stats)).toEqual(["x"]);
  });
});

describe("semaines, mois, jours", () => {
  it("semaineDe = le lundi (UTC) de la semaine", () => {
    expect(semaineDe(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10-12");
    expect(semaineDe(new Date("2026-10-18T23:00:00Z"))).toBe("2026-10-12");
  });
  it("l'analyse du dimanche prépare la semaine qui commence le lendemain", () => {
    expect(semaineAnalysee(new Date("2026-10-18T06:00:00Z"))).toBe("2026-10-19");
  });
  it("moisDe et jourDe", () => {
    expect(moisDe(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10");
    expect(jourDe(new Date("2026-10-14T23:59:00Z"))).toBe("2026-10-14");
  });
});

describe("tendances côté marque", () => {
  const maintenant = new Date("2026-10-14T10:00:00Z");
  it("un format écarté est bloqué 8 semaines", () => {
    const s = clesEcartees([
      { cle: "x", ecarteLe: new Date("2026-08-20T00:00:00Z") },
      { cle: "y", ecarteLe: new Date("2026-08-18T00:00:00Z") },
    ], maintenant);
    expect(s.has("x")).toBe(true);
    expect(s.has("y")).toBe(false);
  });
  it("visible : nouveau / vu non expirés, gardé toujours, écarté et utilisé jamais", () => {
    expect(tendanceVisible({ statut: "nouveau", expireLe: "2026-10-20T00:00:00Z" }, maintenant)).toBe(true);
    expect(tendanceVisible({ statut: "vu", expireLe: "2026-10-13T00:00:00Z" }, maintenant)).toBe(false);
    expect(tendanceVisible({ statut: "garde", expireLe: "2026-01-01T00:00:00Z" }, maintenant)).toBe(true);
    expect(tendanceVisible({ statut: "ecarte", expireLe: "2026-12-01T00:00:00Z" }, maintenant)).toBe(false);
    expect(tendanceVisible({ statut: "utilise", expireLe: "2026-12-01T00:00:00Z" }, maintenant)).toBe(false);
  });
  it("créneau d'un post issu d'une tendance : mercredi de la semaine suivante, 8 h UTC", () => {
    expect(creneauTendance(maintenant).toISOString()).toBe("2026-10-21T08:00:00.000Z");
    expect(creneauTendance(new Date("2026-10-18T22:00:00Z")).toISOString()).toBe("2026-10-21T08:00:00.000Z");
  });
});

describe("comptes et posts", () => {
  it("normalise une saisie Instagram", () => {
    expect(normaliserCompteInstagram("@Lune.Studio")).toEqual({ compte: "lune.studio", url: "https://www.instagram.com/lune.studio/" });
    expect(normaliserCompteInstagram("https://instagram.com/lune.studio/?hl=fr")).toEqual({ compte: "lune.studio", url: "https://www.instagram.com/lune.studio/" });
    expect(normaliserCompteInstagram("https://www.instagram.com/p/ABC123/")).toBeNull();
    expect(normaliserCompteInstagram("")).toBeNull();
    expect(normaliserCompteInstagram("pas un compte !")).toBeNull();
  });
  it("extrait les comptes de liens de recherche, sans doublon ni page de post", () => {
    expect(handlesInstagram([
      "https://www.instagram.com/lune.studio/", "https://www.instagram.com/lune.studio/reels/",
      "https://www.instagram.com/p/XYZ/", "https://www.instagram.com/explore/tags/yoga/", "https://example.com/a",
      "https://instagram.com/soleil_coach",
    ])).toEqual(["lune.studio", "soleil_coach"]);
  });
  it("clé d'un post : URL sans paramètres ni barre finale", () => {
    expect(cleDePost("https://www.instagram.com/p/ABC/?img_index=1")).toBe("https://www.instagram.com/p/ABC");
  });
  it("lit puis retire la ligne TENDANCE: <id>", () => {
    expect(extraireTendance("Mon post.\n\nTENDANCE: 12")).toEqual({ texte: "Mon post.", tendanceId: 12 });
    expect(extraireTendance("Mon post.")).toEqual({ texte: "Mon post.", tendanceId: null });
  });
  it("libellé lisible d'un format", () => {
    expect(libelleFormat("carrousel", "avant_apres")).toBe("Carrousel avant/après");
  });
  it("les seuils sont ceux de la spec", () => {
    expect(REGLES).toMatchObject({ comptesMaxParPlateforme: 15, plafondEurParMois: 10, maturiteHeures: 48, fenetreMediane: 30,
      postsMursMin: 8, facteurFort: 2, fenetreAnalyseJours: 14, liftMin: 1.5, fortsMin: 3, comptesMin: 2,
      tendancesMaxParProjet: 5, dureeTendanceJours: 28, ecartSemaines: 8, confianceMin: 0.7, retentionPostsJours: 90 });
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run : `npx vitest run shared/profils-veille.test.ts`
Expected : FAIL (`Cannot find module './profils-veille'`).

- [ ] **Step 3 : Implémenter**

```ts
// shared/profils-veille.ts
/**
 * Profils de veille : règles pures (aucune I/O). Un profil = un type de marque, suivi pour
 * TOUTES les marques qui lui ressemblent (recherche mutualisée), puis trié marque par marque.
 * Spec : docs/superpowers/specs/2026-10-14-profils-de-veille-design.md
 */
import { lundiDe, plusJours } from "./atelier";

export const PLATEFORMES_VEILLE = ["instagram", "linkedin", "tiktok"] as const;
export type PlateformeVeille = (typeof PLATEFORMES_VEILLE)[number];
/** Lot 1 : Instagram seulement. TikTok (lot 2) et LinkedIn (lot 3) s'ajoutent ici. */
export const PLATEFORMES_LOT1: PlateformeVeille[] = ["instagram"];

export const TYPES_MEDIA = ["image", "carrousel", "reel", "video", "texte", "document"] as const;
export type TypeMedia = (typeof TYPES_MEDIA)[number];
export const STRUCTURES = [
  "tutoriel", "avant_apres", "coulisses", "temoignage_client", "liste", "histoire_personnelle",
  "prise_de_position", "erreur_courante", "presentation_offre", "tendance_reprise", "question_communaute", "autre",
] as const;
export type Structure = (typeof STRUCTURES)[number];
export const ACCROCHES = ["chiffre", "question", "promesse", "erreur", "contre_intuitif", "histoire", "aucune", "autre"] as const;
export type Accroche = (typeof ACCROCHES)[number];

export const LIBELLES_MEDIA: Record<TypeMedia, string> = {
  image: "Image", carrousel: "Carrousel", reel: "Reel", video: "Vidéo", texte: "Post texte", document: "Document",
};
export const LIBELLES_STRUCTURE: Record<Structure, string> = {
  tutoriel: "tutoriel", avant_apres: "avant/après", coulisses: "coulisses", temoignage_client: "témoignage client",
  liste: "liste", histoire_personnelle: "histoire personnelle", prise_de_position: "prise de position",
  erreur_courante: "erreur courante", presentation_offre: "présentation d'offre", tendance_reprise: "tendance reprise",
  question_communaute: "question à la communauté", autre: "autre",
};
export function libelleFormat(typeMedia: TypeMedia, structure: Structure): string {
  return `${LIBELLES_MEDIA[typeMedia]} ${LIBELLES_STRUCTURE[structure]}`;
}

export const REGLES = {
  comptesMaxParPlateforme: 15,
  plafondEurParMois: 10,
  joursCollecteUtc: [1, 3, 5] as readonly number[],
  heureCollecteUtc: 5,
  jourAnalyseUtc: 0,
  heureAnalyseUtc: 5,
  maturiteHeures: 48,
  fenetreMediane: 30,
  postsMursMin: 8,
  facteurFort: 2,
  fenetreAnalyseJours: 14,
  liftMin: 1.5,
  fortsMin: 3,
  comptesMin: 2,
  tendancesMaxParProjet: 5,
  dureeTendanceJours: 28,
  ecartSemaines: 8,
  confianceMin: 0.7,
  retentionPostsJours: 90,
  echecsAvantInjoignable: 2,
} as const;

export interface Metriques {
  likes?: number | null; commentaires?: number | null; partages?: number | null;
  vues?: number | null; republications?: number | null;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Engagement normalisé. Une métrique indispensable absente → null (non mesuré ≠ zéro). */
export function engagementDe(plateforme: PlateformeVeille, m: Metriques, abonnes: number | null | undefined): number | null {
  const likes = n(m.likes);
  if (likes == null) return null;
  const coms = n(m.commentaires) ?? 0;
  if (plateforme === "tiktok") {
    const vues = n(m.vues);
    if (!vues) return null;
    return (likes + coms + (n(m.partages) ?? 0)) / vues;
  }
  const ab = n(abonnes);
  if (!ab) return null;
  if (plateforme === "linkedin") return (likes + coms + (n(m.republications) ?? 0)) / ab;
  return (likes + coms) / ab;
}

export function estMur(publieLe: Date | string | null | undefined, maintenant: Date): boolean {
  if (!publieLe) return false;
  const t = new Date(publieLe).getTime();
  return Number.isFinite(t) && maintenant.getTime() - t >= REGLES.maturiteHeures * 3600_000;
}

export function mediane(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const t = [...xs].sort((a, b) => a - b);
  return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
}

/**
 * `historique` : engagements des posts mûrs du compte, du plus récent au plus ancien (le post
 * jugé compris). Seuls les 30 premiers comptent. Moins de 8 → on ne juge pas (null).
 */
export function estFort(e: number | null, historique: number[]): boolean | null {
  if (e == null) return null;
  const fenetre = historique.slice(0, REGLES.fenetreMediane);
  if (fenetre.length < REGLES.postsMursMin) return null;
  const m = mediane(fenetre)!;
  return e > REGLES.facteurFort * m;
}

export interface PostFenetre {
  cle: string; compteId: number; plateforme: PlateformeVeille; typeMedia: TypeMedia;
  structure: Structure | null; fort: boolean | null;
}
export interface StatFormat {
  cle: string; plateforme: PlateformeVeille; typeMedia: TypeMedia; structure: Structure;
  lift: number; nbPosts: number; nbForts: number; nbComptes: number; clesForts: string[];
}

export const cleFormat = (plateforme: string, typeMedia: string, structure: string) => `${plateforme}|${typeMedia}|${structure}`;

/** Statistiques par format (plateforme × type de média × structure), posts jugés et classés seulement. */
export function statsFormats(posts: PostFenetre[]): StatFormat[] {
  const juges = posts.filter((p) => p.fort !== null && p.structure !== null);
  const parPlateforme = new Map<string, { total: number; forts: number }>();
  for (const p of juges) {
    const g = parPlateforme.get(p.plateforme) ?? { total: 0, forts: 0 };
    g.total++; if (p.fort) g.forts++;
    parPlateforme.set(p.plateforme, g);
  }
  const groupes = new Map<string, PostFenetre[]>();
  for (const p of juges) {
    const k = cleFormat(p.plateforme, p.typeMedia, p.structure!);
    groupes.set(k, [...(groupes.get(k) ?? []), p]);
  }
  const out: StatFormat[] = [];
  for (const [cle, ps] of Array.from(groupes)) {
    const g = parPlateforme.get(ps[0].plateforme)!;
    const tauxGlobal = g.total ? g.forts / g.total : 0;
    const forts = ps.filter((p) => p.fort);
    const tauxFormat = forts.length / ps.length;
    out.push({
      cle, plateforme: ps[0].plateforme, typeMedia: ps[0].typeMedia, structure: ps[0].structure!,
      lift: tauxGlobal > 0 ? tauxFormat / tauxGlobal : 0,
      nbPosts: ps.length, nbForts: forts.length,
      nbComptes: new Set(forts.map((p) => p.compteId)).size,
      clesForts: forts.map((p) => p.cle),
    });
  }
  return out.sort((a, b) => b.lift - a.lift);
}

/** Seuil anti-hasard : lift ≥ 1,5, ≥ 3 forts, venant d'au moins 2 comptes. `autre` n'est jamais une tendance. */
export function formatsRetenus(stats: StatFormat[]): StatFormat[] {
  return stats.filter((s) => s.structure !== "autre" && s.lift >= REGLES.liftMin && s.nbForts >= REGLES.fortsMin && s.nbComptes >= REGLES.comptesMin);
}

/** Retenus la semaine d'avant, pas cette semaine, mais encore au moins dans la moyenne. */
export function enBaisse(precedentes: Array<{ cle: string }>, retenues: Set<string>, stats: StatFormat[]): string[] {
  const lift = new Map(stats.map((s) => [s.cle, s.lift]));
  return precedentes.map((p) => p.cle).filter((c) => !retenues.has(c) && (lift.get(c) ?? 0) >= 1);
}

export const jourDe = (d: Date) => d.toISOString().slice(0, 10);
export const moisDe = (d: Date) => d.toISOString().slice(0, 7);
export const semaineDe = (d: Date) => lundiDe(jourDe(d));
/** L'analyse du dimanche prépare la semaine qui commence le lendemain. */
export const semaineAnalysee = (d: Date) => semaineDe(new Date(d.getTime() + 24 * 3600_000));

export function clesEcartees(ecartees: Array<{ cle: string; ecarteLe: Date | string }>, maintenant: Date): Set<string> {
  const limite = maintenant.getTime() - REGLES.ecartSemaines * 7 * 24 * 3600_000;
  return new Set(ecartees.filter((e) => new Date(e.ecarteLe).getTime() >= limite).map((e) => e.cle));
}

export function tendanceVisible(t: { statut: string; expireLe: Date | string }, maintenant: Date): boolean {
  if (t.statut === "garde") return true;
  if (t.statut !== "nouveau" && t.statut !== "vu") return false;
  return new Date(t.expireLe).getTime() > maintenant.getTime();
}

/** Post créé depuis une tendance : mercredi de la semaine suivante, 8 h UTC (modifiable dans l'atelier). */
export function creneauTendance(maintenant: Date): Date {
  const mercredi = plusJours(plusJours(semaineDe(maintenant), 7), 2);
  return new Date(`${mercredi}T08:00:00.000Z`);
}

const HANDLE = /^[a-z0-9._]{1,30}$/;
const PAS_DES_COMPTES = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "about", "developer", "legal"]);

export function normaliserCompteInstagram(saisie: string): { compte: string; url: string } | null {
  let s = (saisie || "").trim().toLowerCase();
  if (!s) return null;
  const m = /instagram\.com\/([^/?#]+)/.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@/, "").replace(/\/+$/, "");
  if (!HANDLE.test(s) || PAS_DES_COMPTES.has(s)) return null;
  return { compte: s, url: `https://www.instagram.com/${s}/` };
}

export function handlesInstagram(liens: string[]): string[] {
  const vus = new Set<string>();
  for (const l of liens) {
    if (!/instagram\.com\//i.test(l)) continue;
    const r = normaliserCompteInstagram(l);
    if (r) vus.add(r.compte);
  }
  return Array.from(vus);
}

export function cleDePost(url: string): string {
  return (url || "").trim().split(/[?#]/)[0].replace(/\/+$/, "");
}

export function extraireTendance(texte: string): { texte: string; tendanceId: number | null } {
  const m = /\n?\s*TENDANCE\s*:\s*(\d+)\s*$/i.exec(texte ?? "");
  if (!m) return { texte: (texte ?? "").trim(), tendanceId: null };
  return { texte: texte.slice(0, m.index).trim(), tendanceId: Number(m[1]) };
}
```

- [ ] **Step 4 : Lancer les tests**

Run : `npx vitest run shared/profils-veille.test.ts`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add shared/profils-veille.ts shared/profils-veille.test.ts
git commit -m "feat(profils-veille): règles pures — engagement, maturité, contenus forts, formats, seuils"
```

---

### Task 2 : Schéma et migration

**Files :**
- Modify : `shared/schema.ts` (ajout en fin de fichier + 2 colonnes dans `content`)
- Create : `migrations/0031_*.sql` (généré)

**Interfaces :**
- Produces : tables Drizzle `profilsVeille`, `profilComptes`, `profilRattachements`, `profilPosts`, `profilPassages`, `profilAnalyses`, `profilTendances`, `tendancesProjet`, `profilEtiquettes` et leurs types `ProfilVeille`, `ProfilCompte`, `ProfilRattachement`, `ProfilPost`, `ProfilPassage`, `ProfilAnalyse`, `ProfilTendance`, `TendanceProjet`, `ProfilEtiquette` (+ `Insert…`). Colonnes `content.tendanceId`, `content.tendanceProjetId`.

- [ ] **Step 1 : Ajouter les colonnes à `content`** (juste après `consigne`, dans le bloc `pgTable("content", …)`)

```ts
  // Profils de veille : la tendance dont le post s'inspire (null = aucune), et la tendance de
  // la marque d'où il a été créé (« En faire un post »). Entiers simples, sans clé étrangère :
  // les tendances ne sont jamais supprimées, et le post ne doit jamais dépendre d'elles.
  tendanceId: integer("tendance_id"),
  tendanceProjetId: integer("tendance_projet_id"),
```

- [ ] **Step 2 : Ajouter les tables en fin de `shared/schema.ts`**

```ts
// ─── Profils de veille (spec 2026-10-14) ────────────────────────────────────────
// Recherche MUTUALISÉE : un profil = un type de marque, suivi pour toutes les marques qui lui
// ressemblent. Aucune donnée privée d'utilisatrice dans profils/comptes/posts/tendances.
export const profilsVeille = pgTable("profils_veille", {
  id: serial("id").primaryKey(),
  nom: text("nom").notNull(),
  description: text("description").notNull().default(""),
  criteres: jsonb("criteres").notNull().default({}),        // { typesBusiness: string[], cibles: string[], motsCles: string[] }
  origine: text("origine").notNull().default("jeanne"),     // jeanne | naya
  statut: text("statut").notNull().default("propose"),      // propose | actif | en_pause | archive
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type ProfilVeille = typeof profilsVeille.$inferSelect;
export type InsertProfilVeille = typeof profilsVeille.$inferInsert;

export const profilComptes = pgTable("profil_comptes", {
  id: serial("id").primaryKey(),
  profilId: integer("profil_id").notNull().references(() => profilsVeille.id, { onDelete: "cascade" }),
  plateforme: text("plateforme").notNull(),                 // instagram | linkedin | tiktok
  compte: text("compte").notNull(),                         // handle normalisé
  url: text("url").notNull(),
  libelle: text("libelle"),
  statut: text("statut").notNull().default("propose"),      // propose | suivi | ecarte | injoignable
  origine: text("origine").notNull().default("naya"),       // naya | jeanne | suggestion
  suggerePar: varchar("suggere_par").references(() => users.id),
  echecsConsecutifs: integer("echecs_consecutifs").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  unCompteParProfil: uniqueIndex("profil_comptes_unique").on(t.profilId, t.plateforme, t.compte),
}));
export type ProfilCompte = typeof profilComptes.$inferSelect;
export type InsertProfilCompte = typeof profilComptes.$inferInsert;

export const profilRattachements = pgTable("profil_rattachements", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  profilId: integer("profil_id").notNull().references(() => profilsVeille.id),
  confiance: doublePrecision("confiance").notNull().default(0),
  raison: text("raison").notNull().default(""),
  statut: text("statut").notNull().default("propose"),      // propose | confirme | refuse | en_attente (profil proposé à Jeanne)
  exclus: jsonb("exclus").notNull().default([]),             // ids de profils refusés par l'utilisatrice
  dernierTri: text("dernier_tri"),                           // semaine (lundi ISO) du dernier tri, même vide
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  unParProjet: uniqueIndex("profil_rattachements_projet").on(t.projectId),
}));
export type ProfilRattachement = typeof profilRattachements.$inferSelect;
export type InsertProfilRattachement = typeof profilRattachements.$inferInsert;

export const profilPosts = pgTable("profil_posts", {
  id: serial("id").primaryKey(),
  profilId: integer("profil_id").notNull().references(() => profilsVeille.id, { onDelete: "cascade" }),
  compteId: integer("compte_id").notNull().references(() => profilComptes.id, { onDelete: "cascade" }),
  plateforme: text("plateforme").notNull(),
  url: text("url").notNull(),
  cle: text("cle").notNull(),
  publieLe: timestamp("publie_le"),
  typeMedia: text("type_media").notNull(),
  legende: text("legende"),
  metriques: jsonb("metriques").notNull().default({}),
  abonnes: integer("abonnes"),
  engagement: doublePrecision("engagement"),
  fort: boolean("fort"),
  format: jsonb("format"),                                  // { structure, accroche, autreLibelle? }
  releveLe: timestamp("releve_le").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  unParProfil: uniqueIndex("profil_posts_cle").on(t.profilId, t.cle),
  parCompte: index("profil_posts_compte_idx").on(t.compteId, t.publieLe),
}));
export type ProfilPost = typeof profilPosts.$inferSelect;
export type InsertProfilPost = typeof profilPosts.$inferInsert;

export const profilPassages = pgTable("profil_passages", {
  id: serial("id").primaryKey(),
  profilId: integer("profil_id").notNull().references(() => profilsVeille.id, { onDelete: "cascade" }),
  plateforme: text("plateforme").notNull(),
  jour: text("jour").notNull(),                             // YYYY-MM-DD (UTC)
  statut: text("statut").notNull().default("en_cours"),     // en_cours | ok | erreur | plafond
  comptes: integer("comptes").notNull().default(0),
  postsNouveaux: integer("posts_nouveaux").notNull().default(0),
  postsMisAJour: integer("posts_mis_a_jour").notNull().default(0),
  echecs: integer("echecs").notNull().default(0),
  erreur: text("erreur"),
  coutEur: doublePrecision("cout_eur").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  unParJour: uniqueIndex("profil_passages_jour").on(t.profilId, t.plateforme, t.jour),
}));
export type ProfilPassage = typeof profilPassages.$inferSelect;

export const profilAnalyses = pgTable("profil_analyses", {
  id: serial("id").primaryKey(),
  profilId: integer("profil_id").notNull().references(() => profilsVeille.id, { onDelete: "cascade" }),
  semaine: text("semaine").notNull(),                       // lundi ISO de la semaine préparée
  statut: text("statut").notNull().default("en_cours"),     // en_cours | lot_soumis | termine | rien | erreur | plafond
  batchId: text("batch_id"),
  retenus: jsonb("retenus").notNull().default([]),           // StatFormat[] retenus + en baisse, en attente du lot
  coutEur: doublePrecision("cout_eur").notNull().default(0),
  erreur: text("erreur"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uneParSemaine: uniqueIndex("profil_analyses_semaine").on(t.profilId, t.semaine),
}));
export type ProfilAnalyse = typeof profilAnalyses.$inferSelect;

export const profilTendances = pgTable("profil_tendances", {
  id: serial("id").primaryKey(),
  profilId: integer("profil_id").notNull().references(() => profilsVeille.id, { onDelete: "cascade" }),
  semaine: text("semaine").notNull(),
  plateforme: text("plateforme").notNull(),
  typeMedia: text("type_media").notNull(),
  structure: text("structure").notNull(),
  cle: text("cle").notNull(),                               // cleFormat(plateforme, typeMedia, structure)
  accrocheDominante: text("accroche_dominante"),
  lift: doublePrecision("lift").notNull(),
  nbForts: integer("nb_forts").notNull(),
  nbComptes: integer("nb_comptes").notNull(),
  exemples: jsonb("exemples").notNull().default([]),         // [url]
  pourquoi: text("pourquoi").notNull().default(""),
  commentAdapter: text("comment_adapter").notNull().default(""),
  statut: text("statut").notNull().default("nouveau"),      // nouveau | confirme | en_baisse
  ecarteParJeanne: boolean("ecarte_par_jeanne").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uneParFormat: uniqueIndex("profil_tendances_format").on(t.profilId, t.semaine, t.cle),
}));
export type ProfilTendance = typeof profilTendances.$inferSelect;
export type InsertProfilTendance = typeof profilTendances.$inferInsert;

export const tendancesProjet = pgTable("tendances_projet", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tendanceId: integer("tendance_id").notNull().references(() => profilTendances.id, { onDelete: "cascade" }),
  adaptation: text("adaptation").notNull(),
  statut: text("statut").notNull().default("nouveau"),      // nouveau | vu | garde | utilise | ecarte
  contentId: integer("content_id"),
  ecarteLe: timestamp("ecarte_le"),
  expireLe: timestamp("expire_le").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uneParProjet: uniqueIndex("tendances_projet_unique").on(t.projectId, t.tendanceId),
  parProjet: index("tendances_projet_idx").on(t.userId, t.projectId),
}));
export type TendanceProjet = typeof tendancesProjet.$inferSelect;
export type InsertTendanceProjet = typeof tendancesProjet.$inferInsert;

// Banc d'évaluation du classement : les étiquettes posées à la main par Jeanne.
export const profilEtiquettes = pgTable("profil_etiquettes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => profilPosts.id, { onDelete: "cascade" }),
  structure: text("structure").notNull(),
  accroche: text("accroche").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uneParPost: uniqueIndex("profil_etiquettes_post").on(t.postId),
}));
export type ProfilEtiquette = typeof profilEtiquettes.$inferSelect;
```

- [ ] **Step 3 : Vérifier les types**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 4 : Générer la migration et la relire**

Run : `npx drizzle-kit generate`
Puis : `cat migrations/0031_*.sql`
Expected : uniquement des `CREATE TABLE` pour les 9 tables, leurs index et clés étrangères, et deux `ALTER TABLE "content" ADD COLUMN` (`tendance_id`, `tendance_projet_id`, nullables). **Aucun `DROP`, aucun autre `ALTER`.** S'il y en a : arrêter, ne pas appliquer, comprendre l'écart avec `MIGRATIONS.md`.

- [ ] **Step 5 : Appliquer sur la base de dev**

Run : `npm run db:migrate` (avec le `DATABASE_URL` de dev du `.env`, jamais celui de prod)
Expected : migration 0031 appliquée.

- [ ] **Step 6 : Commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(profils-veille): migration 0031 — tables des profils de veille, content.tendance_id"
```

---

### Task 3 : Sorties structurées et API Batch

**Files :**
- Modify : `server/services/ai/types.ts`, `server/services/ai/providers/anthropic.ts`, `server/services/ai/providers/openai.ts`, `server/services/claude.ts`
- Create : `server/services/ai/structure.ts`, `server/services/ai/lots.ts`
- Test : `server/services/ai/structure.test.ts`, `server/services/ai/lots.test.ts`

**Interfaces :**
- Produces :
  - `GenerateInput.schema?: Record<string, unknown>` ; `CallClaudeOptions.schema?: Record<string, unknown>` ; `callClaudeDetailed(...)` renvoie `{ text, stopReason, coutEur }`.
  - `schemaJson(s: z.ZodType): Record<string, unknown>`
  - `lireStructure<T>(s: z.ZodType<T>, texte: string): T` (lève `Error("structure_invalide: …")`)
  - `genererStructure<T>(o: { schema: z.ZodType<T>; system: string; prompt: string; model: string; maxTokens: number; taskKind: TaskKind; etape: string; userId?: string; projectId?: number | null }): Promise<{ valeur: T; coutEur: number }>`
  - `interface RequeteLot { customId: string; system: string; prompt: string; model: string; maxTokens: number; schema: Record<string, unknown> }`
  - `soumettreLot(reqs: RequeteLot[], client?): Promise<string>`
  - `type ResultatLot = { customId: string; texte: string; coutEur: number } | { customId: string; erreur: string }`
  - `lireLot(batchId: string, client?): Promise<ResultatLot[] | null>` (null = encore en cours)

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/services/ai/structure.test.ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";

const appel = vi.hoisted(() => ({ callClaudeDetailed: vi.fn() }));
vi.mock("../claude", () => ({
  callClaudeDetailed: appel.callClaudeDetailed,
  assertNotTruncated: (stop: string | undefined, etape: string) => { if (stop === "max_tokens") throw new Error(`tronqué : ${etape}`); },
}));
const { schemaJson, lireStructure, genererStructure } = await import("./structure");

const S = z.object({ choix: z.enum(["a", "b"]), note: z.number() });

describe("sorties structurées", () => {
  it("schemaJson : objet JSON Schema fermé (additionalProperties false)", () => {
    const j: any = schemaJson(S);
    expect(j.type).toBe("object");
    expect(j.additionalProperties).toBe(false);
    expect(j.required.sort()).toEqual(["choix", "note"]);
  });
  it("lireStructure valide, sinon lève", () => {
    expect(lireStructure(S, '{"choix":"a","note":2}')).toEqual({ choix: "a", note: 2 });
    expect(() => lireStructure(S, '{"choix":"c","note":2}')).toThrow(/structure_invalide/);
    expect(() => lireStructure(S, "pas du json")).toThrow(/structure_invalide/);
  });
  it("genererStructure passe le schéma, refuse une réponse tronquée, renvoie le coût", async () => {
    appel.callClaudeDetailed.mockResolvedValueOnce({ text: '{"choix":"b","note":1}', stopReason: "end_turn", coutEur: 0.002 });
    const r = await genererStructure({ schema: S, system: "s", prompt: "p", model: "m", maxTokens: 100, taskKind: "classification", etape: "test" });
    expect(r).toEqual({ valeur: { choix: "b", note: 1 }, coutEur: 0.002 });
    expect(appel.callClaudeDetailed.mock.calls[0][0].schema.type).toBe("object");
    appel.callClaudeDetailed.mockResolvedValueOnce({ text: '{"choix":', stopReason: "max_tokens", coutEur: 0.001 });
    await expect(genererStructure({ schema: S, system: "s", prompt: "p", model: "m", maxTokens: 10, taskKind: "classification", etape: "test" })).rejects.toThrow(/test/);
  });
});
```

```ts
// server/services/ai/lots.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("./providers/anthropic", () => ({ anthropic: {} }));
vi.mock("../usage", () => ({ estimateClaudeCostEur: (_m: string, i: number, o: number) => (i + o) / 1000 }));
const { soumettreLot, lireLot } = await import("./lots");

describe("API Batch", () => {
  it("soumet une requête par élément, avec le schéma", async () => {
    const create = vi.fn(async () => ({ id: "lot_1" }));
    const id = await soumettreLot([{ customId: "t1", system: "s", prompt: "p", model: "m", maxTokens: 500, schema: { type: "object" } }], { messages: { batches: { create } } } as any);
    expect(id).toBe("lot_1");
    const req = (create.mock.calls[0] as any)[0].requests[0];
    expect(req.custom_id).toBe("t1");
    expect(req.params.output_config).toEqual({ format: { type: "json_schema", schema: { type: "object" } } });
  });
  it("null tant que le lot n'est pas terminé ; ensuite textes, erreurs et coût à 50 %", async () => {
    const enCours = { messages: { batches: { retrieve: vi.fn(async () => ({ processing_status: "in_progress" })) } } } as any;
    expect(await lireLot("lot_1", enCours)).toBeNull();
    async function* res() {
      yield { custom_id: "t1", result: { type: "succeeded", message: { model: "m", content: [{ type: "text", text: '{"a":1}' }], usage: { input_tokens: 600, output_tokens: 400 } } } };
      yield { custom_id: "t2", result: { type: "errored", error: { error: { message: "boom" } } } };
      yield { custom_id: "t3", result: { type: "expired" } };
    }
    const fini = { messages: { batches: { retrieve: vi.fn(async () => ({ processing_status: "ended" })), results: vi.fn(async () => res()) } } } as any;
    expect(await lireLot("lot_1", fini)).toEqual([
      { customId: "t1", texte: '{"a":1}', coutEur: 0.5 },
      { customId: "t2", erreur: "boom" },
      { customId: "t3", erreur: "expired" },
    ]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/ai/structure.test.ts server/services/ai/lots.test.ts`
Expected : FAIL (modules absents).

- [ ] **Step 3 : Étendre le fournisseur**

Dans `server/services/ai/types.ts`, ajouter à `GenerateInput` :

```ts
  /** JSON Schema de la réponse (sortie structurée). Le texte rendu est alors un JSON conforme. */
  schema?: Record<string, unknown>;
```

Dans `server/services/ai/providers/anthropic.ts`, `generate` :

```ts
    const { system, messages, maxTokens = 1024, temperature, schema } = input;

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(schema ? { output_config: { format: { type: "json_schema" as const, schema } } } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
```

Dans `server/services/ai/providers/openai.ts`, au début de `generate` :

```ts
    if (input.schema) throw new Error("[ai/openai] sortie structurée non prise en charge par ce fournisseur");
```

Dans `server/services/claude.ts` : ajouter `schema?: Record<string, unknown>;` à `CallClaudeOptions` ; dans `callClaudeDetailed`, passer `schema: options.schema` à `provider.generate({ system: systemMsg, messages: chatMessages, maxTokens: max_tokens, temperature, schema: options.schema }, model)`, changer le type de retour en `Promise<{ text: string; stopReason?: string; coutEur: number }>` et finir par `return { text: result.text, stopReason: result.stopReason, coutEur: costEur ?? 0 };`.

- [ ] **Step 4 : `server/services/ai/structure.ts`**

```ts
// Sorties structurées : le schéma zod (v4) est la seule source de vérité. Il produit le JSON
// Schema envoyé au modèle ET valide la réponse. Jamais de JSON découpé à la main.
import { z } from "zod/v4";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { callClaudeDetailed, assertNotTruncated } from "../claude";
import type { TaskKind } from "./types";

export function schemaJson(s: z.ZodType): Record<string, unknown> {
  return transformJSONSchema(z.toJSONSchema(s) as Record<string, any>);
}

export function lireStructure<T>(s: z.ZodType<T>, texte: string): T {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new Error("structure_invalide: réponse non JSON");
  }
  const r = s.safeParse(brut);
  if (!r.success) throw new Error(`structure_invalide: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`);
  return r.data;
}

export async function genererStructure<T>(o: {
  schema: z.ZodType<T>; system: string; prompt: string; model: string; maxTokens: number;
  taskKind: TaskKind; etape: string; userId?: string; projectId?: number | null;
}): Promise<{ valeur: T; coutEur: number }> {
  const { text, stopReason, coutEur } = await callClaudeDetailed({
    model: o.model, system: o.system, messages: [{ role: "user", content: o.prompt }],
    max_tokens: o.maxTokens, taskKind: o.taskKind, schema: schemaJson(o.schema),
    ...(o.userId ? { userId: o.userId } : {}), projectId: o.projectId ?? null,
  });
  assertNotTruncated(stopReason, o.etape);
  return { valeur: lireStructure(o.schema, text), coutEur };
}
```

- [ ] **Step 5 : `server/services/ai/lots.ts`**

```ts
// API Batch d'Anthropic : 50 % moins cher, résultat en quelques heures (assez pour l'analyse
// hebdomadaire des profils de veille). Le lot est soumis, puis relu à un tour suivant.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./providers/anthropic";
import { estimateClaudeCostEur } from "../usage";

export interface RequeteLot { customId: string; system: string; prompt: string; model: string; maxTokens: number; schema: Record<string, unknown> }
export type ResultatLot = { customId: string; texte: string; coutEur: number } | { customId: string; erreur: string };

export async function soumettreLot(reqs: RequeteLot[], client: Pick<Anthropic, "messages"> = anthropic): Promise<string> {
  const lot = await client.messages.batches.create({
    requests: reqs.map((r) => ({
      custom_id: r.customId,
      params: {
        model: r.model, max_tokens: r.maxTokens, system: r.system,
        messages: [{ role: "user" as const, content: r.prompt }],
        output_config: { format: { type: "json_schema" as const, schema: r.schema } },
      },
    })),
  });
  return lot.id;
}

export async function lireLot(batchId: string, client: Pick<Anthropic, "messages"> = anthropic): Promise<ResultatLot[] | null> {
  const lot = await client.messages.batches.retrieve(batchId);
  if (lot.processing_status !== "ended") return null;
  const out: ResultatLot[] = [];
  for await (const r of await client.messages.batches.results(batchId)) {
    const res: any = r.result;
    if (res.type === "succeeded") {
      const m = res.message;
      const texte = (m.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      out.push({ customId: r.custom_id, texte, coutEur: 0.5 * estimateClaudeCostEur(m.model, m.usage?.input_tokens ?? 0, m.usage?.output_tokens ?? 0) });
    } else {
      out.push({ customId: r.custom_id, erreur: res.type === "errored" ? String(res.error?.error?.message ?? "errored") : String(res.type) });
    }
  }
  return out;
}
```

- [ ] **Step 6 : Tests et types**

Run : `npx vitest run server/services/ai/ && npx tsc --noEmit`
Expected : PASS, 0 erreur. Si TypeScript refuse `output_config` dans `batches.create` (version du SDK), typer `params` comme `Anthropic.Messages.MessageCreateParamsNonStreaming` et vérifier dans `node_modules/@anthropic-ai/sdk/resources/messages/batches.d.ts` que `params` accepte `output_config` ; sinon, c'est un blocage à remonter (ne pas contourner avec `as any` sur l'appel réseau).

- [ ] **Step 7 : Suite complète (aucune régression des appelants de `callClaudeDetailed`)**

Run : `npx vitest run`
Expected : vert.

- [ ] **Step 8 : Commit**

```bash
git add server/services/ai/ server/services/claude.ts
git commit -m "feat(ia): sorties structurées validées (zod v4) et API Batch ; callClaudeDetailed renvoie le coût"
```

---

### Task 4 : Collecte Bright Data par lot et adaptateur Instagram

**Files :**
- Modify : `server/services/brightdata-enrich.ts`
- Create : `server/services/profils-veille/collecte/instagram.ts`, `scripts/capturer-instagram.ts`
- Test : `server/services/profils-veille/collecte/instagram.test.ts`

**Interfaces :**
- Produces :
  - `collecterParLot(datasetId: string, urls: string[], o?: { maxWaitMs?: number; intervalMs?: number }): Promise<any[] | null>` (null = non configuré, échec ou délai dépassé ; `[]` = terminé vide)
  - `instagramDataset(): string | undefined`
  - `interface PostCollecte { url: string; publieLe: Date | null; typeMedia: TypeMedia; legende: string | null; metriques: Metriques }`
  - `interface ProfilCollecte { compte: string | null; abonnes: number | null; erreur: string | null; posts: PostCollecte[] }`
  - `lireProfilInstagram(raw: any): ProfilCollecte`

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/services/profils-veille/collecte/instagram.test.ts
import { describe, it, expect } from "vitest";
import { lireProfilInstagram } from "./instagram";

describe("lireProfilInstagram", () => {
  it("lit compte, abonnés et posts (champs usuels du dataset)", () => {
    const r = lireProfilInstagram({
      account: "Lune.Studio", followers: 12000,
      posts: [
        { url: "https://www.instagram.com/p/A/?img_index=1", datetime: "2026-10-10T09:00:00.000Z", content_type: "Carousel", likes: 300, comments: 12, caption: "Avant / après @cliente une séance" },
        { url: "https://www.instagram.com/reel/B/", date_time: "2026-10-09T09:00:00.000Z", product_type: "clips", likes_count: 80, num_comments: 2, video_view_count: 4000 },
        { url: "https://www.instagram.com/p/C/", timestamp: 1791000000, is_video: false, likes: 10 },
      ],
    });
    expect(r.compte).toBe("lune.studio");
    expect(r.abonnes).toBe(12000);
    expect(r.erreur).toBeNull();
    expect(r.posts[0]).toEqual({
      url: "https://www.instagram.com/p/A/?img_index=1", publieLe: new Date("2026-10-10T09:00:00.000Z"), typeMedia: "carrousel",
      legende: "Avant / après … une séance", metriques: { likes: 300, commentaires: 12, vues: null },
    });
    expect(r.posts[1].typeMedia).toBe("reel");
    expect(r.posts[1].metriques).toEqual({ likes: 80, commentaires: 2, vues: 4000 });
    expect(r.posts[2].typeMedia).toBe("image");
    expect(r.posts[2].publieLe).toEqual(new Date(1791000000 * 1000));
  });
  it("likes masqués : likes null (jamais 0)", () => {
    const r = lireProfilInstagram({ account: "x", followers: 10, posts: [{ url: "https://www.instagram.com/p/D/", likes: null, comments: 3 }] });
    expect(r.posts[0].metriques.likes).toBeNull();
  });
  it("ligne d'erreur Bright Data, compte privé ou introuvable : erreur et aucun post", () => {
    expect(lireProfilInstagram({ error: "Profile not found", input: { url: "u" } })).toMatchObject({ erreur: "Profile not found", posts: [] });
    expect(lireProfilInstagram({ account: "x", is_private: true, posts: [] })).toMatchObject({ erreur: "prive" });
    expect(lireProfilInstagram(null)).toMatchObject({ erreur: "vide", posts: [] });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/profils-veille/collecte/instagram.test.ts`
Expected : FAIL.

- [ ] **Step 3 : `collecterParLot` dans `brightdata-enrich.ts`** (après `triggerAndPoll`, même style)

```ts
export function instagramDataset(): string | undefined {
  return process.env.BRIGHT_DATA_INSTAGRAM_DATASET;
}

/**
 * Comme triggerAndPoll, mais pour PLUSIEURS URL d'un coup (un seul déclenchement, un seul
 * instantané) et en renvoyant TOUTES les lignes (dont les lignes d'erreur, `include_errors`).
 * null : non configuré, refus, délai dépassé. [] : terminé sans ligne.
 */
export async function collecterParLot(
  datasetId: string,
  urls: string[],
  { maxWaitMs = 300_000, intervalMs = 10_000 }: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<any[] | null> {
  const key = apiKey();
  if (!key || urls.length === 0) return null;
  try {
    const trig = await fetch(
      `${API}/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&include_errors=true`,
      { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(urls.map((url) => ({ url }))) },
    );
    if (!trig.ok) return null;
    const snapshotId: string | undefined = (await trig.json())?.snapshot_id;
    if (!snapshotId) return null;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const snap = await fetch(`${API}/datasets/v3/snapshot/${snapshotId}?format=json`, { headers: { Authorization: `Bearer ${key}` } });
      if (snap.status === 202) continue;
      if (!snap.ok) return null;
      const data: any = await snap.json();
      const rows = Array.isArray(data) ? data : data?.data;
      if (Array.isArray(rows)) return rows;
    }
    return null;
  } catch (e: any) {
    console.error("[brightdata] collecterParLot:", e?.message || e);
    return null;
  }
}
```

- [ ] **Step 4 : `collecte/instagram.ts`**

```ts
// Adaptateur Instagram (dataset Bright Data « instagram profiles ») → posts normalisés.
// Les noms de champs varient selon les versions du dataset : on lit les variantes connues.
// Vérifié sur un échantillon réel (scripts/capturer-instagram.ts) — voir Task 4, Step 6.
import type { Metriques, TypeMedia } from "@shared/profils-veille";
import { anonymiser } from "../../veille/texte";

export interface PostCollecte { url: string; publieLe: Date | null; typeMedia: TypeMedia; legende: string | null; metriques: Metriques }
export interface ProfilCollecte { compte: string | null; abonnes: number | null; erreur: string | null; posts: PostCollecte[] }

const nombre = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function date(p: any): Date | null {
  const v = p?.datetime ?? p?.date_time ?? p?.date ?? p?.timestamp ?? p?.taken_at;
  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function typeMedia(p: any): TypeMedia {
  const t = String(p?.content_type ?? p?.type ?? "").toLowerCase();
  const produit = String(p?.product_type ?? "").toLowerCase();
  if (t.includes("carousel") || t.includes("sidecar") || produit === "carousel_container") return "carrousel";
  if (produit === "clips" || t.includes("reel") || t.includes("clip")) return "reel";
  if (t.includes("video") || p?.is_video === true) return "video";
  return "image";
}

export function lireProfilInstagram(raw: any): ProfilCollecte {
  if (!raw || typeof raw !== "object") return { compte: null, abonnes: null, erreur: "vide", posts: [] };
  if (raw.error) return { compte: null, abonnes: null, erreur: String(raw.error).slice(0, 200), posts: [] };
  const compte = typeof (raw.account ?? raw.username) === "string" ? String(raw.account ?? raw.username).toLowerCase() : null;
  if (raw.is_private === true) return { compte, abonnes: null, erreur: "prive", posts: [] };
  const posts: PostCollecte[] = [];
  for (const p of Array.isArray(raw.posts) ? raw.posts : []) {
    if (!p?.url) continue;
    const legende = typeof p.caption === "string" ? anonymiser(p.caption).slice(0, 600) || null : null;
    posts.push({
      url: String(p.url),
      publieLe: date(p),
      typeMedia: typeMedia(p),
      legende,
      metriques: {
        likes: nombre(p.likes) ?? nombre(p.likes_count),
        commentaires: nombre(p.comments) ?? nombre(p.num_comments),
        vues: nombre(p.video_view_count) ?? nombre(p.views) ?? nombre(p.video_play_count),
      },
    });
  }
  return { compte, abonnes: nombre(raw.followers), erreur: null, posts };
}
```

Note : pour le premier post du test, `commentaires: 12` puis `vues: null` (aucun champ vues) — l'ordre des clés du test suit l'objet construit.

- [ ] **Step 5 : Tests**

Run : `npx vitest run server/services/profils-veille/collecte/instagram.test.ts`
Expected : PASS.

- [ ] **Step 6 : Vérifier sur un échantillon réel (coût ≈ 0,002 €)**

Créer `scripts/capturer-instagram.ts` :

```ts
// Capture UNE réponse réelle du dataset Instagram pour vérifier l'adaptateur.
// Usage : npx tsx scripts/capturer-instagram.ts <compte> — affiche les clés et le résultat lu.
import { collecterParLot, instagramDataset } from "../server/services/brightdata-enrich";
import { lireProfilInstagram } from "../server/services/profils-veille/collecte/instagram";

const compte = process.argv[2];
const ds = instagramDataset();
if (!compte || !ds) { console.error("usage : npx tsx scripts/capturer-instagram.ts <compte> (BRIGHT_DATA_INSTAGRAM_DATASET requis)"); process.exit(1); }
const rows = await collecterParLot(ds, [`https://www.instagram.com/${compte}/`]);
const r = rows?.[0];
console.log("Clés du profil :", r ? Object.keys(r) : rows);
console.log("Clés d'un post :", r?.posts?.[0] ? Object.keys(r.posts[0]) : "aucun post");
console.log(JSON.stringify(lireProfilInstagram(r), null, 2).slice(0, 3000));
```

Run : `npx tsx scripts/capturer-instagram.ts <un compte public de marque>`
Expected : posts lus avec `publieLe` non nul, `typeMedia` plausible, `likes` renseignés. Si un champ est lu `null` alors qu'il existe sous un autre nom dans « Clés d'un post », ajouter ce nom dans `date()`, `typeMedia()` ou `metriques` **et** une ligne de test qui l'exerce, puis relancer les tests.

- [ ] **Step 7 : Commit**

```bash
git add server/services/brightdata-enrich.ts server/services/profils-veille/collecte/ scripts/capturer-instagram.ts
git commit -m "feat(profils-veille): collecte Bright Data par lot et adaptateur Instagram"
```

---

### Task 5 : Le passage de collecte d'un profil

**Files :**
- Create : `server/services/profils-veille/collecte.ts`, `server/services/profils-veille/stockage.ts` (premières requêtes)
- Test : `server/services/profils-veille/collecte.test.ts`

**Interfaces :**
- Consumes : `REGLES`, `engagementDe`, `estMur`, `estFort`, `cleDePost`, `jourDe`, `moisDe`, `PlateformeVeille` (Task 1) ; `ProfilCollecte`, `PostCollecte` (Task 4).
- Produces :
  - `interface CompteSuivi { id: number; compte: string; url: string; echecsConsecutifs: number }`
  - `interface DepsCollecte` (ci-dessous)
  - `type ResultatCollecte = { statut: "deja" } | { statut: "plafond" } | { statut: "erreur"; erreur: string } | { statut: "ok"; nouveaux: number; misAJour: number; echecs: number }`
  - `collecterProfil(deps: DepsCollecte, profilId: number, plateforme: PlateformeVeille, maintenant: Date): Promise<ResultatCollecte>`
  - `stockageProfils.depenseDuMois(profilId: number, mois: string): Promise<number>` (réutilisé Tâches 6, 9, 10)

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/services/profils-veille/collecte.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { collecterProfil, type DepsCollecte } from "./collecte";
import { lireProfilInstagram } from "./collecte/instagram";

const maintenant = new Date("2026-10-14T06:00:00Z");
const ancien = "2026-10-10T09:00:00.000Z"; // mûr
const recent = "2026-10-13T20:00:00.000Z"; // pas mûr

function deps(over: Partial<DepsCollecte> = {}): DepsCollecte {
  return {
    comptesSuivis: vi.fn(async () => [
      { id: 1, compte: "lune", url: "https://www.instagram.com/lune/", echecsConsecutifs: 0 },
      { id: 2, compte: "soleil", url: "https://www.instagram.com/soleil/", echecsConsecutifs: 1 },
    ]),
    reserverPassage: vi.fn(async () => 50),
    terminerPassage: vi.fn(async () => {}),
    collecter: vi.fn(async () => [
      { account: "lune", followers: 1000, posts: [
        { url: "https://www.instagram.com/p/A/", datetime: ancien, likes: 300, comments: 0 },
        { url: "https://www.instagram.com/p/B/", datetime: recent, likes: 5, comments: 0 },
        { url: "https://www.instagram.com/p/C/", datetime: ancien, comments: 4 },
      ] },
      { error: "Profile not found", input: { url: "https://www.instagram.com/soleil/" } },
    ]),
    lireProfil: lireProfilInstagram,
    clesExistantes: vi.fn(async () => new Set(["https://www.instagram.com/p/A"])),
    enregistrerPosts: vi.fn(async () => {}),
    historiqueCompte: vi.fn(async () => [0.3, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01]),
    marquerForts: vi.fn(async () => {}),
    majCompte: vi.fn(async () => {}),
    depenseDuMois: vi.fn(async () => 1),
    coutParCompte: 0.0014,
    ...over,
  };
}

describe("collecterProfil", () => {
  let d: DepsCollecte;
  beforeEach(() => { d = deps(); });

  it("passage déjà pris (autre instance, autre tour) : rien n'est collecté", async () => {
    d = deps({ reserverPassage: vi.fn(async () => null) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toEqual({ statut: "deja" });
    expect(d.collecter).not.toHaveBeenCalled();
  });

  it("plafond atteint : une ligne de passage « plafond », aucune collecte", async () => {
    d = deps({ depenseDuMois: vi.fn(async () => 10) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toEqual({ statut: "plafond" });
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "plafond" }));
    expect(d.collecter).not.toHaveBeenCalled();
  });

  it("enregistre les posts, juge seulement les mûrs, n'invente jamais un engagement", async () => {
    const r = await collecterProfil(d, 7, "instagram", maintenant);
    expect(r).toEqual({ statut: "ok", nouveaux: 2, misAJour: 1, echecs: 1 });
    const rows = (d.enregistrerPosts as any).mock.calls[0][0];
    const parUrl = Object.fromEntries(rows.map((x: any) => [x.cle, x]));
    expect(parUrl["https://www.instagram.com/p/A"].engagement).toBeCloseTo(0.3);
    expect(parUrl["https://www.instagram.com/p/B"].engagement).toBeNull(); // pas mûr
    expect(parUrl["https://www.instagram.com/p/C"].engagement).toBeNull(); // likes absents
    expect(parUrl["https://www.instagram.com/p/A"]).toMatchObject({ profilId: 7, compteId: 1, plateforme: "instagram", abonnes: 1000 });
    expect(d.marquerForts).toHaveBeenCalledWith([{ cle: "https://www.instagram.com/p/A", fort: true }], 7);
  });

  it("un compte en erreur : compteur d'échecs ; injoignable au 2e échec consécutif ; l'autre compte remis à zéro", async () => {
    await collecterProfil(d, 7, "instagram", maintenant);
    expect(d.majCompte).toHaveBeenCalledWith(2, { echecsConsecutifs: 2, statut: "injoignable" });
    expect(d.majCompte).toHaveBeenCalledWith(1, { echecsConsecutifs: 0 });
  });

  it("échec global (Bright Data ne répond pas) : passage en erreur, aucun compte pénalisé", async () => {
    d = deps({ collecter: vi.fn(async () => null) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toMatchObject({ statut: "erreur" });
    expect(d.majCompte).not.toHaveBeenCalled();
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "erreur", coutEur: 0 }));
  });

  it("aucun compte suivi : passage ok vide, sans appel payant", async () => {
    d = deps({ comptesSuivis: vi.fn(async () => []) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toEqual({ statut: "ok", nouveaux: 0, misAJour: 0, echecs: 0 });
    expect(d.collecter).not.toHaveBeenCalled();
  });

  it("coût du passage = comptes réellement collectés × coût par compte (le compte en erreur ne coûte rien)", async () => {
    await collecterProfil(d, 7, "instagram", maintenant);
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "ok", comptes: 1, coutEur: 0.0014 }));
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/profils-veille/collecte.test.ts`
Expected : FAIL.

- [ ] **Step 3 : `collecte.ts`**

```ts
// Un passage de collecte : un profil × une plateforme × un jour. Idempotent (le passage est
// réservé en base avant toute dépense), borné par le plafond mensuel du profil, best-effort.
import { REGLES, engagementDe, estMur, estFort, cleDePost, jourDe, moisDe, type PlateformeVeille } from "@shared/profils-veille";
import type { InsertProfilPost } from "@shared/schema";
import type { ProfilCollecte } from "./collecte/instagram";

export interface CompteSuivi { id: number; compte: string; url: string; echecsConsecutifs: number }

export interface DepsCollecte {
  comptesSuivis(profilId: number, plateforme: PlateformeVeille): Promise<CompteSuivi[]>;
  /** Réserve le passage du jour ; null s'il existe déjà (unicité profil × plateforme × jour). */
  reserverPassage(profilId: number, plateforme: PlateformeVeille, jour: string): Promise<number | null>;
  terminerPassage(id: number, patch: { statut: string; comptes?: number; postsNouveaux?: number; postsMisAJour?: number; echecs?: number; erreur?: string | null; coutEur?: number }): Promise<void>;
  collecter(plateforme: PlateformeVeille, urls: string[]): Promise<any[] | null>;
  lireProfil(raw: any): ProfilCollecte;
  clesExistantes(profilId: number, cles: string[]): Promise<Set<string>>;
  /** Upsert sur (profilId, cle) : métriques, abonnés, engagement, releveLe mis à jour. */
  enregistrerPosts(rows: InsertProfilPost[]): Promise<void>;
  /** Engagements non nuls des posts mûrs du compte, du plus récent au plus ancien (30 au plus). */
  historiqueCompte(compteId: number): Promise<number[]>;
  marquerForts(maj: Array<{ cle: string; fort: boolean | null }>, profilId: number): Promise<void>;
  majCompte(id: number, patch: { echecsConsecutifs: number; statut?: string }): Promise<void>;
  depenseDuMois(profilId: number, mois: string): Promise<number>;
  coutParCompte: number;
}

export type ResultatCollecte =
  | { statut: "deja" } | { statut: "plafond" } | { statut: "erreur"; erreur: string }
  | { statut: "ok"; nouveaux: number; misAJour: number; echecs: number };

export async function collecterProfil(deps: DepsCollecte, profilId: number, plateforme: PlateformeVeille, maintenant: Date): Promise<ResultatCollecte> {
  const passage = await deps.reserverPassage(profilId, plateforme, jourDe(maintenant));
  if (passage == null) return { statut: "deja" };

  if ((await deps.depenseDuMois(profilId, moisDe(maintenant))) >= REGLES.plafondEurParMois) {
    await deps.terminerPassage(passage, { statut: "plafond", erreur: "Plafond mensuel du profil atteint." });
    return { statut: "plafond" };
  }

  const comptes = (await deps.comptesSuivis(profilId, plateforme)).slice(0, REGLES.comptesMaxParPlateforme);
  if (comptes.length === 0) {
    await deps.terminerPassage(passage, { statut: "ok" });
    return { statut: "ok", nouveaux: 0, misAJour: 0, echecs: 0 };
  }

  const lignes = await deps.collecter(plateforme, comptes.map((c) => c.url));
  if (lignes == null) {
    const erreur = "La collecte n'a pas répondu (fournisseur indisponible ou délai dépassé).";
    await deps.terminerPassage(passage, { statut: "erreur", comptes: comptes.length, erreur, coutEur: 0 });
    return { statut: "erreur", erreur };
  }

  const lus = lignes.map((l) => ({ l, p: deps.lireProfil(l) }));
  const pourCompte = (c: CompteSuivi) =>
    lus.find(({ l, p }) => p.compte === c.compte || String(l?.input?.url ?? l?.url ?? "").toLowerCase().includes(`/${c.compte}`));

  const rows: InsertProfilPost[] = [];
  const parCompte = new Map<number, string[]>();
  let echecs = 0;
  for (const c of comptes) {
    const trouve = pourCompte(c);
    if (!trouve || trouve.p.erreur) {
      echecs++;
      const n = c.echecsConsecutifs + 1;
      await deps.majCompte(c.id, n >= REGLES.echecsAvantInjoignable ? { echecsConsecutifs: n, statut: "injoignable" } : { echecsConsecutifs: n });
      continue;
    }
    await deps.majCompte(c.id, { echecsConsecutifs: 0 });
    for (const post of trouve.p.posts) {
      const cle = cleDePost(post.url);
      const mur = estMur(post.publieLe, maintenant);
      rows.push({
        profilId, compteId: c.id, plateforme, url: post.url, cle, publieLe: post.publieLe,
        typeMedia: post.typeMedia, legende: post.legende, metriques: post.metriques, abonnes: trouve.p.abonnes,
        engagement: mur ? engagementDe(plateforme, post.metriques, trouve.p.abonnes) : null, releveLe: maintenant,
      });
      if (mur) parCompte.set(c.id, [...(parCompte.get(c.id) ?? []), cle]);
    }
  }

  const existantes = await deps.clesExistantes(profilId, rows.map((r) => r.cle));
  await deps.enregistrerPosts(rows);

  const forts: Array<{ cle: string; fort: boolean | null }> = [];
  for (const [compteId, cles] of Array.from(parCompte)) {
    const historique = await deps.historiqueCompte(compteId);
    for (const cle of cles) {
      const e = rows.find((r) => r.cle === cle)?.engagement ?? null;
      forts.push({ cle, fort: estFort(e, historique) });
    }
  }
  await deps.marquerForts(forts.filter((f) => f.fort !== null), profilId);

  const nouveaux = rows.filter((r) => !existantes.has(r.cle)).length;
  const collectes = comptes.length - echecs;
  await deps.terminerPassage(passage, {
    statut: "ok", comptes: collectes, postsNouveaux: nouveaux, postsMisAJour: rows.length - nouveaux, echecs,
    coutEur: collectes * deps.coutParCompte,
  });
  return { statut: "ok", nouveaux, misAJour: rows.length - nouveaux, echecs };
}
```

- [ ] **Step 4 : `stockage.ts` (requêtes de cette tâche)**

```ts
// Requêtes Drizzle du module profils de veille. Toute la base du module passe par ici.
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { profilComptes, profilPassages, profilPosts, profilAnalyses, type InsertProfilPost } from "@shared/schema";
import { REGLES, type PlateformeVeille } from "@shared/profils-veille";
import type { CompteSuivi } from "./collecte";

export const stockageProfils = {
  async comptesSuivis(profilId: number, plateforme: PlateformeVeille): Promise<CompteSuivi[]> {
    return db.select({ id: profilComptes.id, compte: profilComptes.compte, url: profilComptes.url, echecsConsecutifs: profilComptes.echecsConsecutifs })
      .from(profilComptes)
      .where(and(eq(profilComptes.profilId, profilId), eq(profilComptes.plateforme, plateforme), eq(profilComptes.statut, "suivi")))
      .orderBy(profilComptes.id).limit(REGLES.comptesMaxParPlateforme);
  },
  async reserverPassage(profilId: number, plateforme: string, jour: string): Promise<number | null> {
    const [r] = await db.insert(profilPassages).values({ profilId, plateforme, jour }).onConflictDoNothing().returning({ id: profilPassages.id });
    return r?.id ?? null;
  },
  async terminerPassage(id: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(profilPassages).set(patch as any).where(eq(profilPassages.id, id));
  },
  async clesExistantes(profilId: number, cles: string[]): Promise<Set<string>> {
    if (cles.length === 0) return new Set();
    const rows = await db.select({ cle: profilPosts.cle }).from(profilPosts).where(and(eq(profilPosts.profilId, profilId), inArray(profilPosts.cle, cles)));
    return new Set(rows.map((r) => r.cle));
  },
  async enregistrerPosts(rows: InsertProfilPost[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(profilPosts).values(rows).onConflictDoUpdate({
      target: [profilPosts.profilId, profilPosts.cle],
      set: {
        metriques: sql`excluded.metriques`, abonnes: sql`excluded.abonnes`, releveLe: sql`excluded.releve_le`,
        // Un post déjà jugé garde son engagement si le nouveau relevé ne le mesure pas.
        engagement: sql`coalesce(excluded.engagement, ${profilPosts.engagement})`,
        legende: sql`coalesce(excluded.legende, ${profilPosts.legende})`,
      },
    });
  },
  async historiqueCompte(compteId: number): Promise<number[]> {
    const rows = await db.select({ e: profilPosts.engagement }).from(profilPosts)
      .where(and(eq(profilPosts.compteId, compteId), isNotNull(profilPosts.engagement)))
      .orderBy(desc(profilPosts.publieLe)).limit(REGLES.fenetreMediane);
    return rows.map((r) => r.e as number);
  },
  async marquerForts(maj: Array<{ cle: string; fort: boolean | null }>, profilId: number): Promise<void> {
    for (const m of maj) await db.update(profilPosts).set({ fort: m.fort }).where(and(eq(profilPosts.profilId, profilId), eq(profilPosts.cle, m.cle)));
  },
  async majCompte(id: number, patch: { echecsConsecutifs: number; statut?: string }): Promise<void> {
    await db.update(profilComptes).set(patch).where(eq(profilComptes.id, id));
  },
  async depenseDuMois(profilId: number, mois: string): Promise<number> {
    const debut = new Date(`${mois}-01T00:00:00Z`);
    const fin = new Date(debut); fin.setUTCMonth(fin.getUTCMonth() + 1);
    const [a] = await db.select({ s: sql<number>`coalesce(sum(${profilPassages.coutEur}), 0)` }).from(profilPassages)
      .where(and(eq(profilPassages.profilId, profilId), gte(profilPassages.createdAt, debut), lt(profilPassages.createdAt, fin)));
    const [b] = await db.select({ s: sql<number>`coalesce(sum(${profilAnalyses.coutEur}), 0)` }).from(profilAnalyses)
      .where(and(eq(profilAnalyses.profilId, profilId), gte(profilAnalyses.createdAt, debut), lt(profilAnalyses.createdAt, fin)));
    return Number(a?.s ?? 0) + Number(b?.s ?? 0);
  },
};
```

- [ ] **Step 5 : Tests et types**

Run : `npx vitest run server/services/profils-veille/ && npx tsc --noEmit`
Expected : PASS, 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add server/services/profils-veille/
git commit -m "feat(profils-veille): passage de collecte — idempotent, plafonné, contenus forts, comptes injoignables"
```

---

### Task 6 : L'analyse hebdomadaire des formats

**Files :**
- Create : `server/services/profils-veille/analyse.ts`
- Modify : `server/services/profils-veille/stockage.ts` (requêtes de l'analyse)
- Test : `server/services/profils-veille/analyse.test.ts`

**Interfaces :**
- Consumes : `statsFormats`, `formatsRetenus`, `enBaisse`, `cleFormat`, `REGLES`, `STRUCTURES`, `ACCROCHES`, `libelleFormat`, `moisDe` (Task 1) ; `RequeteLot`, `ResultatLot`, `schemaJson`, `lireStructure` (Task 3).
- Produces :
  - `SCHEMA_CLASSEMENT`, `SCHEMA_TENDANCE` (zod v4)
  - `interface PostAClasser { id: number; typeMedia: TypeMedia; legende: string | null }`
  - `interface DepsAnalyse` (ci-dessous)
  - `lancerAnalyse(deps, profil: { id: number; nom: string; description: string }, semaine: string, maintenant: Date): Promise<"deja" | "plafond" | "rien" | "lot_soumis" | "erreur">`
  - `finaliserAnalyse(deps, analyse: { id: number; profilId: number; semaine: string; batchId: string | null; retenus: unknown; coutEur: number }): Promise<"en_cours" | "termine" | "erreur">`

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/services/profils-veille/analyse.test.ts
import { describe, it, expect, vi } from "vitest";
import { lancerAnalyse, finaliserAnalyse, type DepsAnalyse } from "./analyse";
import { cleFormat } from "@shared/profils-veille";

const profil = { id: 7, nom: "Coachs bien-être", description: "Coachs indépendantes" };
const maintenant = new Date("2026-10-18T06:00:00Z");
const AV = cleFormat("instagram", "carrousel", "avant_apres");

const fenetre = [
  ...["a", "b", "c"].map((cle, i) => ({ cle, compteId: i % 2 ? 1 : 2, plateforme: "instagram" as const, typeMedia: "carrousel" as const, structure: "avant_apres" as const, fort: true })),
  { cle: "d", compteId: 1, plateforme: "instagram" as const, typeMedia: "carrousel" as const, structure: "avant_apres" as const, fort: false },
  ...["e", "f", "g", "h", "i", "j"].map((cle, i) => ({ cle, compteId: 3, plateforme: "instagram" as const, typeMedia: "image" as const, structure: "liste" as const, fort: i === 0 })),
];

function deps(over: Partial<DepsAnalyse> = {}): DepsAnalyse {
  return {
    creerAnalyse: vi.fn(async () => 30),
    majAnalyse: vi.fn(async () => {}),
    depenseDuMois: vi.fn(async () => 0),
    postsAClasser: vi.fn(async () => [{ id: 1, typeMedia: "carrousel", legende: "Avant / après" }]),
    classer: vi.fn(async () => ({ resultats: [{ id: 1, structure: "avant_apres", accroche: "chiffre", autreLibelle: null }], coutEur: 0.01 })),
    enregistrerFormat: vi.fn(async () => {}),
    postsFenetre: vi.fn(async () => fenetre),
    exemples: vi.fn(async (cles: string[]) => cles.slice(0, 3).map((c, i) => ({ cle: c, url: `https://ig/${c}`, legende: `légende ${c}`, compteId: i, accroche: "chiffre" }))),
    tendancesPrecedentes: vi.fn(async () => []),
    soumettre: vi.fn(async () => "lot_9"),
    lire: vi.fn(async () => null),
    enregistrerTendances: vi.fn(async () => {}),
    modeleRaisonnement: "smart", modeleRapide: "fast",
    ...over,
  };
}

describe("lancerAnalyse", () => {
  it("déjà lancée cette semaine : rien", async () => {
    const d = deps({ creerAnalyse: vi.fn(async () => null) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("deja");
    expect(d.classer).not.toHaveBeenCalled();
  });
  it("plafond atteint : statut plafond, aucun appel IA", async () => {
    const d = deps({ depenseDuMois: vi.fn(async () => 10) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("plafond");
    expect(d.majAnalyse).toHaveBeenCalledWith(30, expect.objectContaining({ statut: "plafond" }));
    expect(d.classer).not.toHaveBeenCalled();
  });
  it("classe les posts sans format, compte, soumet un lot pour chaque format retenu", async () => {
    const d = deps();
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("lot_soumis");
    expect(d.enregistrerFormat).toHaveBeenCalledWith(1, { structure: "avant_apres", accroche: "chiffre", autreLibelle: null });
    const reqs = (d.soumettre as any).mock.calls[0][0];
    expect(reqs.map((r: any) => r.customId)).toEqual([AV]);
    expect(reqs[0].prompt).toContain("Carrousel avant/après");
    expect(reqs[0].model).toBe("smart");
    expect(d.majAnalyse).toHaveBeenLastCalledWith(30, expect.objectContaining({ statut: "lot_soumis", batchId: "lot_9", coutEur: 0.01 }));
  });
  it("aucun format au-dessus du seuil : statut rien, pas de lot (zéro tendance est normal)", async () => {
    const d = deps({ postsFenetre: vi.fn(async () => fenetre.filter((p) => p.structure !== "avant_apres")) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("rien");
    expect(d.soumettre).not.toHaveBeenCalled();
  });
  it("le classement échoue : statut erreur, écrit, sans lot", async () => {
    const d = deps({ classer: vi.fn(async () => { throw new Error("structure_invalide: x"); }) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("erreur");
    expect(d.majAnalyse).toHaveBeenLastCalledWith(30, expect.objectContaining({ statut: "erreur", erreur: expect.stringContaining("structure_invalide") }));
  });
  it("format retenu la semaine d'avant, encore ≥ 1 mais sous le seuil : fiche « en baisse », sans appel IA ni lot", async () => {
    const LI = cleFormat("instagram", "image", "liste");
    const p = (cle: string, compteId: number, typeMedia: any, structure: any, fort: boolean) => ({ cle, compteId, plateforme: "instagram" as const, typeMedia, structure, fort });
    // avant_apres 3 forts / 6 (lift 0,83) ; liste 3 forts / 4 mais un seul compte (lift 1,25, non retenue)
    const fen = [
      p("a", 1, "carrousel", "avant_apres", true), p("b", 2, "carrousel", "avant_apres", true), p("c", 1, "carrousel", "avant_apres", true),
      p("d", 1, "carrousel", "avant_apres", false), p("e", 2, "carrousel", "avant_apres", false), p("f", 2, "carrousel", "avant_apres", false),
      p("g", 3, "image", "liste", true), p("h", 3, "image", "liste", true), p("i", 3, "image", "liste", true), p("j", 3, "image", "liste", false),
    ];
    const d = deps({
      postsFenetre: vi.fn(async () => fen),
      tendancesPrecedentes: vi.fn(async () => [{ cle: LI, pourquoi: "p", commentAdapter: "c", exemples: ["u"], plateforme: "instagram", typeMedia: "image", structure: "liste", accrocheDominante: null } as any]),
    });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("lot_soumis");
    expect(d.soumettre).not.toHaveBeenCalled();
    const derniere = (d.majAnalyse as any).mock.calls.at(-1)[1];
    expect(derniere).toMatchObject({ statut: "lot_soumis", batchId: null });
    expect(derniere.retenus).toEqual([expect.objectContaining({ cle: LI, statut: "en_baisse", enBaisse: true, pourquoi: "p", exemples: ["u"] })]);
    // la finalisation écrit la fiche sans lire de lot
    expect(await finaliserAnalyse(d, { id: 30, profilId: 7, semaine: "2026-10-19", batchId: null, retenus: derniere.retenus, coutEur: 0 })).toBe("termine");
    expect(d.lire).not.toHaveBeenCalled();
    expect(d.enregistrerTendances).toHaveBeenCalledWith([expect.objectContaining({ cle: LI, statut: "en_baisse" })]);
  });
});

describe("finaliserAnalyse", () => {
  const analyse = { id: 30, profilId: 7, semaine: "2026-10-19", batchId: "lot_9", coutEur: 0.01,
    retenus: [{ cle: AV, plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", lift: 1.9, nbPosts: 4, nbForts: 3, nbComptes: 2, clesForts: ["a", "b", "c"], exemples: ["https://ig/a", "https://ig/b"], accrocheDominante: "chiffre", statut: "nouveau" }] };
  it("lot en cours : rien n'est écrit", async () => {
    const d = deps();
    expect(await finaliserAnalyse(d, analyse)).toBe("en_cours");
    expect(d.enregistrerTendances).not.toHaveBeenCalled();
  });
  it("lot terminé : une tendance par format réussi, coût ajouté, statut termine", async () => {
    const d = deps({ lire: vi.fn(async () => [{ customId: AV, texte: '{"pourquoi":"Le résultat se voit.","commentAdapter":"Montre une transformation."}', coutEur: 0.004 }]) });
    expect(await finaliserAnalyse(d, analyse)).toBe("termine");
    expect(d.enregistrerTendances).toHaveBeenCalledWith([expect.objectContaining({
      profilId: 7, semaine: "2026-10-19", cle: AV, lift: 1.9, nbForts: 3, nbComptes: 2, exemples: ["https://ig/a", "https://ig/b"],
      pourquoi: "Le résultat se voit.", commentAdapter: "Montre une transformation.", statut: "nouveau",
    })]);
    const maj = (d.majAnalyse as any).mock.calls.at(-1)[1];
    expect(maj.statut).toBe("termine");
    expect(maj.coutEur).toBeCloseTo(0.014);
  });
  it("une réponse invalide n'écrit pas cette tendance et le dit", async () => {
    const d = deps({ lire: vi.fn(async () => [{ customId: AV, texte: "{}", coutEur: 0.004 }]) });
    expect(await finaliserAnalyse(d, analyse)).toBe("termine");
    expect(d.enregistrerTendances).toHaveBeenCalledWith([]);
    expect(d.majAnalyse).toHaveBeenCalledWith(30, expect.objectContaining({ erreur: expect.stringContaining(AV) }));
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/profils-veille/analyse.test.ts`
Expected : FAIL.

- [ ] **Step 3 : `analyse.ts`**

```ts
// Analyse hebdomadaire d'un profil : (1) nommer le format des posts mûrs (modèle rapide,
// sortie structurée), (2) compter sans IA, (3) écrire une fiche par format retenu via l'API
// Batch (lue à un tour suivant). Zéro tendance est une sortie normale.
import { z } from "zod/v4";
import {
  REGLES, STRUCTURES, ACCROCHES, statsFormats, formatsRetenus, enBaisse, libelleFormat, moisDe,
  type PostFenetre, type StatFormat, type TypeMedia, type Structure, type PlateformeVeille,
} from "@shared/profils-veille";
import type { InsertProfilTendance } from "@shared/schema";
import { schemaJson, lireStructure } from "../ai/structure";
import type { RequeteLot, ResultatLot } from "../ai/lots";

export const SCHEMA_CLASSEMENT = z.object({
  posts: z.array(z.object({
    id: z.number().int(),
    structure: z.enum(STRUCTURES),
    accroche: z.enum(ACCROCHES),
    autreLibelle: z.string().nullable(),
  })),
});
export const SCHEMA_TENDANCE = z.object({ pourquoi: z.string().min(1), commentAdapter: z.string().min(1) });

export interface PostAClasser { id: number; typeMedia: TypeMedia; legende: string | null }
type Format = { structure: Structure; accroche: string; autreLibelle: string | null };
type Retenu = StatFormat & { exemples: string[]; accrocheDominante: string | null; statut: "nouveau" | "confirme" | "en_baisse"; enBaisse?: boolean; pourquoi?: string; commentAdapter?: string };

export interface DepsAnalyse {
  creerAnalyse(profilId: number, semaine: string): Promise<number | null>;
  majAnalyse(id: number, patch: Record<string, unknown>): Promise<void>;
  depenseDuMois(profilId: number, mois: string): Promise<number>;
  postsAClasser(profilId: number, depuis: Date, maintenant: Date): Promise<PostAClasser[]>;
  classer(posts: PostAClasser[]): Promise<{ resultats: Array<{ id: number } & Format>; coutEur: number }>;
  enregistrerFormat(postId: number, format: Format): Promise<void>;
  postsFenetre(profilId: number, depuis: Date, maintenant: Date): Promise<PostFenetre[]>;
  exemples(profilId: number, cles: string[]): Promise<Array<{ cle: string; url: string; legende: string | null; compteId: number; accroche: string | null }>>;
  tendancesPrecedentes(profilId: number, semaine: string): Promise<Array<Pick<InsertProfilTendance, "cle" | "pourquoi" | "commentAdapter" | "exemples" | "plateforme" | "typeMedia" | "structure" | "accrocheDominante">>>;
  soumettre(reqs: RequeteLot[]): Promise<string>;
  lire(batchId: string): Promise<ResultatLot[] | null>;
  enregistrerTendances(rows: InsertProfilTendance[]): Promise<void>;
  modeleRaisonnement: string;
  modeleRapide: string;
}

const PAR_APPEL = 20;
const SYSTEME_TENDANCE =
  "Tu es l'analyste de veille de Naya. On te donne un format de publication qui surperforme, mesuré, chez des marques d'un même secteur, avec des exemples. " +
  "Explique en 2 phrases au plus pourquoi ce format marche probablement (une hypothèse, formulée comme telle, jamais comme une certitude), " +
  "puis en 2 phrases au plus comment une marque de ce secteur peut l'adapter sans copier. Français, direct, concret, sans jargon.";

function plusFrequent(xs: Array<string | null>): string | null {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return Array.from(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function exemplesVariés(ex: Array<{ url: string; compteId: number }>): string[] {
  const vus = new Set<number>(); const out: string[] = [];
  for (const e of ex) { if (vus.has(e.compteId)) continue; vus.add(e.compteId); out.push(e.url); if (out.length === 3) break; }
  return out;
}

export async function lancerAnalyse(deps: DepsAnalyse, profil: { id: number; nom: string; description: string }, semaine: string, maintenant: Date) {
  const id = await deps.creerAnalyse(profil.id, semaine);
  if (id == null) return "deja" as const;
  if ((await deps.depenseDuMois(profil.id, moisDe(maintenant))) >= REGLES.plafondEurParMois) {
    await deps.majAnalyse(id, { statut: "plafond", erreur: "Plafond mensuel du profil atteint.", updatedAt: new Date() });
    return "plafond" as const;
  }
  const depuis = new Date(maintenant.getTime() - REGLES.fenetreAnalyseJours * 24 * 3600_000);
  let cout = 0;
  try {
    const aClasser = await deps.postsAClasser(profil.id, depuis, maintenant);
    for (let i = 0; i < aClasser.length; i += PAR_APPEL) {
      const { resultats, coutEur } = await deps.classer(aClasser.slice(i, i + PAR_APPEL));
      cout += coutEur;
      const ids = new Set(aClasser.slice(i, i + PAR_APPEL).map((p) => p.id));
      for (const r of resultats) if (ids.has(r.id)) await deps.enregistrerFormat(r.id, { structure: r.structure, accroche: r.accroche, autreLibelle: r.autreLibelle });
    }
    const stats = statsFormats(await deps.postsFenetre(profil.id, depuis, maintenant));
    const retenus = formatsRetenus(stats);
    const precedentes = await deps.tendancesPrecedentes(profil.id, semainePrecedente(semaine));
    const clesPrec = new Set(precedentes.map((p) => p.cle));
    const enBaisseCles = enBaisse(precedentes.map((p) => ({ cle: p.cle })), new Set(retenus.map((r) => r.cle)), stats);

    const fiches: Retenu[] = [];
    for (const r of retenus) {
      const ex = await deps.exemples(profil.id, r.clesForts);
      fiches.push({ ...r, exemples: exemplesVariés(ex), accrocheDominante: plusFrequent(ex.map((e) => e.accroche)), statut: clesPrec.has(r.cle) ? "confirme" : "nouveau" });
    }
    for (const cle of enBaisseCles) {
      const p = precedentes.find((x) => x.cle === cle)!;
      const s = stats.find((x) => x.cle === cle)!;
      fiches.push({ ...s, exemples: (p.exemples as string[]) ?? [], accrocheDominante: p.accrocheDominante ?? null, statut: "en_baisse", enBaisse: true, pourquoi: p.pourquoi ?? "", commentAdapter: p.commentAdapter ?? "" });
    }
    if (fiches.length === 0) {
      await deps.majAnalyse(id, { statut: "rien", retenus: [], coutEur: cout, updatedAt: new Date() });
      return "rien" as const;
    }
    const aEcrire = fiches.filter((f) => !f.enBaisse);
    if (aEcrire.length === 0) {
      await deps.majAnalyse(id, { statut: "lot_soumis", batchId: null, retenus: fiches, coutEur: cout, updatedAt: new Date() });
      return "lot_soumis" as const;
    }
    const schema = schemaJson(SCHEMA_TENDANCE);
    const batchId = await deps.soumettre(aEcrire.map((f) => ({
      customId: f.cle, system: SYSTEME_TENDANCE, model: deps.modeleRaisonnement, maxTokens: 600, schema,
      prompt: [
        `Secteur : ${profil.nom} — ${profil.description}`,
        `Format : ${libelleFormat(f.typeMedia, f.structure)} sur ${f.plateforme}`,
        `Mesure : contenus forts ${f.lift.toFixed(1)} fois plus souvent que la moyenne du secteur (${f.nbForts} contenus forts, ${f.nbComptes} marques, 14 derniers jours).`,
        f.accrocheDominante ? `Accroche la plus fréquente : ${f.accrocheDominante}` : "",
        `Exemples (liens) : ${f.exemples.join(" ")}`,
      ].filter(Boolean).join("\n"),
    })));
    await deps.majAnalyse(id, { statut: "lot_soumis", batchId, retenus: fiches, coutEur: cout, updatedAt: new Date() });
    return "lot_soumis" as const;
  } catch (e: any) {
    await deps.majAnalyse(id, { statut: "erreur", erreur: String(e?.message ?? e).slice(0, 500), coutEur: cout, updatedAt: new Date() });
    return "erreur" as const;
  }
}

export function semainePrecedente(semaine: string): string {
  const d = new Date(`${semaine}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export async function finaliserAnalyse(deps: DepsAnalyse, analyse: { id: number; profilId: number; semaine: string; batchId: string | null; retenus: unknown; coutEur: number }) {
  const fiches = (analyse.retenus as Retenu[]) ?? [];
  const resultats = analyse.batchId ? await deps.lire(analyse.batchId) : [];
  if (resultats == null) return "en_cours" as const;
  let cout = analyse.coutEur;
  const erreurs: string[] = [];
  const rows: InsertProfilTendance[] = [];
  for (const f of fiches) {
    let pourquoi = f.pourquoi ?? "", commentAdapter = f.commentAdapter ?? "";
    if (!f.enBaisse) {
      const r = resultats.find((x) => x.customId === f.cle);
      if (!r) { erreurs.push(`${f.cle} : absent du lot`); continue; }
      if ("erreur" in r) { erreurs.push(`${f.cle} : ${r.erreur}`); continue; }
      cout += r.coutEur;
      try { ({ pourquoi, commentAdapter } = lireStructure(SCHEMA_TENDANCE, r.texte)); } catch (e: any) { erreurs.push(`${f.cle} : ${e.message}`); continue; }
    }
    rows.push({
      profilId: analyse.profilId, semaine: analyse.semaine, plateforme: f.plateforme, typeMedia: f.typeMedia, structure: f.structure,
      cle: f.cle, accrocheDominante: f.accrocheDominante, lift: f.lift, nbForts: f.nbForts, nbComptes: f.nbComptes,
      exemples: f.exemples, pourquoi, commentAdapter, statut: f.statut,
    });
  }
  await deps.enregistrerTendances(rows);
  await deps.majAnalyse(analyse.id, { statut: "termine", coutEur: cout, erreur: erreurs.length ? erreurs.join(" | ").slice(0, 1000) : null, updatedAt: new Date() });
  return "termine" as const;
}

export type { PlateformeVeille };
```

- [ ] **Step 4 : Requêtes de l'analyse dans `stockage.ts`** (ajouter à `stockageProfils` ; compléter les imports : `isNull`, `profilTendances`, `type InsertProfilTendance`, `type PostFenetre`, `type TypeMedia`, `type Structure`)

```ts
  async creerAnalyse(profilId: number, semaine: string): Promise<number | null> {
    const [r] = await db.insert(profilAnalyses).values({ profilId, semaine }).onConflictDoNothing().returning({ id: profilAnalyses.id });
    return r?.id ?? null;
  },
  async majAnalyse(id: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(profilAnalyses).set(patch as any).where(eq(profilAnalyses.id, id));
  },
  async analysesEnAttente() {
    return db.select().from(profilAnalyses).where(eq(profilAnalyses.statut, "lot_soumis"));
  },
  async postsAClasser(profilId: number, depuis: Date, maintenant: Date) {
    const mur = new Date(maintenant.getTime() - REGLES.maturiteHeures * 3600_000);
    return db.select({ id: profilPosts.id, typeMedia: profilPosts.typeMedia, legende: profilPosts.legende }).from(profilPosts)
      .where(and(eq(profilPosts.profilId, profilId), isNull(profilPosts.format), gte(profilPosts.publieLe, depuis), lt(profilPosts.publieLe, mur))) as any;
  },
  async enregistrerFormat(postId: number, format: unknown): Promise<void> {
    await db.update(profilPosts).set({ format }).where(eq(profilPosts.id, postId));
  },
  async postsFenetre(profilId: number, depuis: Date, maintenant: Date): Promise<PostFenetre[]> {
    const mur = new Date(maintenant.getTime() - REGLES.maturiteHeures * 3600_000);
    const rows = await db.select({ cle: profilPosts.cle, compteId: profilPosts.compteId, plateforme: profilPosts.plateforme, typeMedia: profilPosts.typeMedia, format: profilPosts.format, fort: profilPosts.fort })
      .from(profilPosts).where(and(eq(profilPosts.profilId, profilId), gte(profilPosts.publieLe, depuis), lt(profilPosts.publieLe, mur)));
    return rows.map((r) => ({ cle: r.cle, compteId: r.compteId, plateforme: r.plateforme as any, typeMedia: r.typeMedia as TypeMedia, structure: ((r.format as any)?.structure ?? null) as Structure | null, fort: r.fort }));
  },
  async exemples(profilId: number, cles: string[]) {
    if (cles.length === 0) return [];
    const rows = await db.select({ cle: profilPosts.cle, url: profilPosts.url, legende: profilPosts.legende, compteId: profilPosts.compteId, format: profilPosts.format, engagement: profilPosts.engagement })
      .from(profilPosts).where(and(eq(profilPosts.profilId, profilId), inArray(profilPosts.cle, cles))).orderBy(desc(profilPosts.engagement));
    return rows.map((r) => ({ cle: r.cle, url: r.url, legende: r.legende, compteId: r.compteId, accroche: (r.format as any)?.accroche ?? null }));
  },
  async tendancesPrecedentes(profilId: number, semaine: string) {
    return db.select().from(profilTendances).where(and(eq(profilTendances.profilId, profilId), eq(profilTendances.semaine, semaine)));
  },
  async enregistrerTendances(rows: InsertProfilTendance[]): Promise<void> {
    if (rows.length) await db.insert(profilTendances).values(rows).onConflictDoNothing();
  },
```

- [ ] **Step 5 : Tests et types**

Run : `npx vitest run server/services/profils-veille/ && npx tsc --noEmit`
Expected : PASS, 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add server/services/profils-veille/
git commit -m "feat(profils-veille): analyse hebdo — classement structuré, comptage, fiches de tendance via l'API Batch"
```

---

### Task 7 : Rattachement d'un projet et proposition de profil

**Files :**
- Create : `server/services/profils-veille/rattachement.ts`
- Modify : `server/services/profils-veille/stockage.ts`
- Test : `server/services/profils-veille/rattachement.test.ts`

**Interfaces :**
- Consumes : `REGLES`, `handlesInstagram`, `normaliserCompteInstagram` (Task 1).
- Produces :
  - `SCHEMA_CHOIX`, `SCHEMA_PROPOSITION` (zod v4)
  - `interface ProjetARattacher { userId: string; projectId: number; nom: string; contexte: string; exclus: number[]; rattachementId: number | null }`
  - `interface DepsRattachement` (ci-dessous)
  - `rattacherProjet(deps, projet: ProjetARattacher): Promise<"rattache" | "propose_a_jeanne" | "refus_garde" | "erreur">`

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/services/profils-veille/rattachement.test.ts
import { describe, it, expect, vi } from "vitest";
import { rattacherProjet, type DepsRattachement } from "./rattachement";

const projet = { userId: "u", projectId: 4, nom: "Lune", contexte: "Coach bien-être, Instagram", exclus: [] as number[], rattachementId: null };
function deps(over: Partial<DepsRattachement> = {}): DepsRattachement {
  return {
    garde: vi.fn(async () => null),
    catalogue: vi.fn(async () => [{ id: 1, nom: "Coachs bien-être", description: "d", criteres: {} }, { id: 2, nom: "Mode éthique", description: "d", criteres: {} }]),
    choisir: vi.fn(async () => ({ profilId: 1, confiance: 0.86, raison: "Coach indépendante." })),
    enregistrer: vi.fn(async () => {}),
    proposer: vi.fn(async () => ({ nom: "Céramistes", description: "Ateliers de céramique", criteres: { typesBusiness: ["artisanat"], cibles: [], motsCles: ["céramique"] }, requetes: ["céramiste atelier"] })),
    chercher: vi.fn(async () => ["https://www.instagram.com/terre.atelier/", "https://www.instagram.com/p/X/", "https://www.instagram.com/argile_co/"]),
    creerProposition: vi.fn(async () => 9),
    ...over,
  };
}

describe("rattacherProjet", () => {
  it("confiance ≥ 0,7 : rattaché (propose), avec la raison", async () => {
    const d = deps();
    expect(await rattacherProjet(d, projet)).toBe("rattache");
    expect(d.enregistrer).toHaveBeenCalledWith({ userId: "u", projectId: 4, profilId: 1, confiance: 0.86, raison: "Coach indépendante.", statut: "propose" });
  });
  it("exclut les profils refusés et ignore un id hors catalogue", async () => {
    const d = deps({ choisir: vi.fn(async () => ({ profilId: 1, confiance: 0.9, raison: "r" })) });
    await rattacherProjet(d, { ...projet, exclus: [1] });
    const cat = (d.choisir as any).mock.calls[0][0].catalogue;
    expect(cat.map((c: any) => c.id)).toEqual([2]);
    expect(d.proposer).toHaveBeenCalled(); // id 1 exclu → traité comme « aucun »
  });
  it("confiance faible : proposition de profil pour Jeanne, comptes Instagram trouvés, rattachement en attente", async () => {
    const d = deps({ choisir: vi.fn(async () => ({ profilId: 2, confiance: 0.4, raison: "r" })) });
    expect(await rattacherProjet(d, projet)).toBe("propose_a_jeanne");
    expect(d.creerProposition).toHaveBeenCalledWith(
      { nom: "Céramistes", description: "Ateliers de céramique", criteres: { typesBusiness: ["artisanat"], cibles: [], motsCles: ["céramique"] } },
      [{ plateforme: "instagram", compte: "terre.atelier", url: "https://www.instagram.com/terre.atelier/" }, { plateforme: "instagram", compte: "argile_co", url: "https://www.instagram.com/argile_co/" }],
    );
    expect(d.enregistrer).toHaveBeenCalledWith(expect.objectContaining({ profilId: 9, statut: "en_attente" }));
  });
  it("catalogue vide : proposition directe", async () => {
    const d = deps({ catalogue: vi.fn(async () => []) });
    expect(await rattacherProjet(d, projet)).toBe("propose_a_jeanne");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("garde de dépense : rien n'est fait", async () => {
    const d = deps({ garde: vi.fn(async () => ({ refus: true })) });
    expect(await rattacherProjet(d, projet)).toBe("refus_garde");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("erreur IA : erreur, rien d'enregistré", async () => {
    const d = deps({ choisir: vi.fn(async () => { throw new Error("x"); }) });
    expect(await rattacherProjet(d, projet)).toBe("erreur");
    expect(d.enregistrer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/profils-veille/rattachement.test.ts`
Expected : FAIL.

- [ ] **Step 3 : `rattachement.ts`**

```ts
// Ranger une marque dans un profil de veille. Sûr de lui (≥ 0,7) : rattachement proposé à
// l'utilisatrice. Sinon Naya rédige un nouveau profil, que Jeanne valide avant qu'il tourne.
import { z } from "zod/v4";
import { REGLES, handlesInstagram, normaliserCompteInstagram, PLATEFORMES_LOT1 } from "@shared/profils-veille";

export const SCHEMA_CHOIX = z.object({ profilId: z.number().int().nullable(), confiance: z.number().min(0).max(1), raison: z.string() });
export const SCHEMA_PROPOSITION = z.object({
  nom: z.string().min(2), description: z.string(),
  criteres: z.object({ typesBusiness: z.array(z.string()), cibles: z.array(z.string()), motsCles: z.array(z.string()) }),
  requetes: z.array(z.string()).max(4),
});

export interface ProjetARattacher { userId: string; projectId: number; nom: string; contexte: string; exclus: number[]; rattachementId: number | null }
type Profil = { id: number; nom: string; description: string; criteres: unknown };

export interface DepsRattachement {
  garde(userId: string): Promise<unknown | null>;
  catalogue(): Promise<Profil[]>;
  choisir(i: { userId: string; projectId: number; contexte: string; catalogue: Profil[] }): Promise<z.infer<typeof SCHEMA_CHOIX>>;
  enregistrer(row: { userId: string; projectId: number; profilId: number; confiance: number; raison: string; statut: string }): Promise<void>;
  proposer(i: { userId: string; projectId: number; contexte: string }): Promise<z.infer<typeof SCHEMA_PROPOSITION>>;
  /** Liens trouvés par recherche Google pour ces requêtes (coût imputé à l'utilisatrice). */
  chercher(userId: string, requetes: string[]): Promise<string[]>;
  creerProposition(profil: { nom: string; description: string; criteres: unknown }, comptes: Array<{ plateforme: string; compte: string; url: string }>): Promise<number>;
}

export async function rattacherProjet(deps: DepsRattachement, projet: ProjetARattacher) {
  if (await deps.garde(projet.userId)) return "refus_garde" as const;
  try {
    const catalogue = (await deps.catalogue()).filter((p) => !projet.exclus.includes(p.id));
    if (catalogue.length > 0) {
      const c = await deps.choisir({ userId: projet.userId, projectId: projet.projectId, contexte: projet.contexte, catalogue });
      if (c.profilId != null && catalogue.some((p) => p.id === c.profilId) && c.confiance >= REGLES.confianceMin) {
        await deps.enregistrer({ userId: projet.userId, projectId: projet.projectId, profilId: c.profilId, confiance: c.confiance, raison: c.raison.slice(0, 300), statut: "propose" });
        return "rattache" as const;
      }
    }
    const p = await deps.proposer({ userId: projet.userId, projectId: projet.projectId, contexte: projet.contexte });
    const liens = p.requetes.length ? await deps.chercher(projet.userId, p.requetes.map((q) => `site:instagram.com ${q}`)) : [];
    const comptes = PLATEFORMES_LOT1.includes("instagram")
      ? handlesInstagram(liens).slice(0, REGLES.comptesMaxParPlateforme).map((h) => ({ plateforme: "instagram", ...normaliserCompteInstagram(h)! }))
      : [];
    const profilId = await deps.creerProposition({ nom: p.nom, description: p.description, criteres: p.criteres }, comptes);
    await deps.enregistrer({ userId: projet.userId, projectId: projet.projectId, profilId, confiance: 0, raison: "Nouveau profil proposé à Jeanne.", statut: "en_attente" });
    return "propose_a_jeanne" as const;
  } catch (e: any) {
    console.error(`[profils-veille] rattachement du projet ${projet.projectId} :`, e?.message ?? e);
    return "erreur" as const;
  }
}
```

- [ ] **Step 4 : Requêtes du rattachement dans `stockage.ts`** (imports : `profilsVeille`, `profilRattachements`, `projects`, `brandDna`, `fondations`, `ne`, `or`)

```ts
  async catalogueActif() {
    return db.select({ id: profilsVeille.id, nom: profilsVeille.nom, description: profilsVeille.description, criteres: profilsVeille.criteres })
      .from(profilsVeille).where(eq(profilsVeille.statut, "actif"));
  },
  async enregistrerRattachement(row: { userId: string; projectId: number; profilId: number; confiance: number; raison: string; statut: string }) {
    await db.insert(profilRattachements).values(row).onConflictDoUpdate({
      target: profilRattachements.projectId,
      set: { profilId: row.profilId, confiance: row.confiance, raison: row.raison, statut: row.statut, updatedAt: new Date() },
    });
  },
  async creerProposition(profil: { nom: string; description: string; criteres: unknown }, comptes: Array<{ plateforme: string; compte: string; url: string }>) {
    const [p] = await db.insert(profilsVeille).values({ ...profil, criteres: profil.criteres as any, origine: "naya", statut: "propose" }).returning({ id: profilsVeille.id });
    if (comptes.length) await db.insert(profilComptes).values(comptes.map((c) => ({ ...c, profilId: p.id, origine: "naya", statut: "propose" }))).onConflictDoNothing();
    return p.id;
  },
  /**
   * Projets actifs à (re)ranger : sans rattachement, ou dont le Brand DNA a changé depuis un
   * rattachement non confirmé (un choix de l'utilisatrice n'est jamais écrasé). 10 au plus par tour.
   */
  async projetsARattacher(userIds: string[]) {
    const out: Array<{ userId: string; projectId: number; nom: string; dna: any; fond: any; exclus: number[]; rattachementId: number | null }> = [];
    for (const userId of userIds) {
      const projets = await db.select().from(projects).where(and(eq(projects.userId, userId), eq(projects.projectStatus, "active")));
      for (const pr of projets) {
        const [dna] = await db.select().from(brandDna).where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, pr.id))).limit(1);
        if (!dna) continue;
        const [r] = await db.select().from(profilRattachements).where(eq(profilRattachements.projectId, pr.id)).limit(1);
        const aRefaire = !r || (r.statut === "refuse") || (r.statut === "propose" && dna.updatedAt && r.updatedAt && dna.updatedAt > r.updatedAt);
        if (!aRefaire) continue;
        const [fond] = await db.select().from(fondations).where(and(eq(fondations.userId, userId), eq(fondations.projectId, pr.id))).limit(1);
        out.push({ userId, projectId: pr.id, nom: pr.name, dna, fond, exclus: (r?.exclus as number[]) ?? [], rattachementId: r?.id ?? null });
        if (out.length >= 10) return out;
      }
    }
    return out;
  },
```

(Vérifier dans `shared/schema.ts` que `brandDna` a bien `updatedAt` ; sinon utiliser `createdAt` et le noter dans le commit.)

- [ ] **Step 5 : Tests et types**

Run : `npx vitest run server/services/profils-veille/ && npx tsc --noEmit`
Expected : PASS, 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add server/services/profils-veille/
git commit -m "feat(profils-veille): rattachement des projets et propositions de profils pour Jeanne"
```

---

### Task 8 : Tri par marque et bloc d'injection

**Files :**
- Create : `server/services/profils-veille/tri.ts`
- Modify : `server/services/profils-veille/stockage.ts`
- Test : `server/services/profils-veille/tri.test.ts`

**Interfaces :**
- Consumes : `REGLES`, `clesEcartees`, `tendanceVisible`, `libelleFormat` (Task 1).
- Produces :
  - `SCHEMA_TRI` (zod v4)
  - `interface DepsTri` (ci-dessous)
  - `trierPourProjet(deps, r: { userId: string; projectId: number; profilId: number; dernierTri: string | null }, semaine: string, maintenant: Date): Promise<"deja" | "refus_garde" | "ferme" | "rien" | "ok" | "erreur">`
  - `formaterBloc(tendances: Array<{ id: number; plateforme: string; typeMedia: string; structure: string; lift: number; adaptation: string }>): string`
  - `tendancesPourLeContenu(userId: string, projectId: number | null | undefined, plateformes: string[], lire?: …): Promise<string>`

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/services/profils-veille/tri.test.ts
import { describe, it, expect, vi } from "vitest";
import { trierPourProjet, formaterBloc, tendancesPourLeContenu, type DepsTri } from "./tri";

const maintenant = new Date("2026-10-19T07:00:00Z");
const r = { userId: "u", projectId: 4, profilId: 7, dernierTri: null };
const T = (id: number, cle: string, plateforme = "instagram") => ({ id, cle, plateforme, typeMedia: "carrousel", structure: "avant_apres", lift: 2, pourquoi: "p", commentAdapter: "c" });

function deps(over: Partial<DepsTri> = {}): DepsTri {
  return {
    estOuvert: vi.fn(async () => true),
    garde: vi.fn(async () => null),
    tendancesSemaine: vi.fn(async () => [T(1, "a"), T(2, "b"), T(3, "c")]),
    ecartees: vi.fn(async () => [{ cle: "b", ecarteLe: new Date("2026-10-01T00:00:00Z") }]),
    projet: vi.fn(async () => ({ nom: "Lune", plateformes: "instagram, linkedin", offre: "Coaching 3 séances", cible: "Femmes 30-45" })),
    choisir: vi.fn(async () => ({ choix: [{ tendanceId: 1, adaptation: "Ta cliente avant/après 3 séances." }, { tendanceId: 2, adaptation: "x" }, { tendanceId: 99, adaptation: "y" }] })),
    enregistrer: vi.fn(async () => {}),
    marquerTri: vi.fn(async () => {}),
    ...over,
  };
}

describe("trierPourProjet", () => {
  it("déjà trié cette semaine : rien", async () => {
    const d = deps();
    expect(await trierPourProjet(d, { ...r, dernierTri: "2026-10-19" }, "2026-10-19", maintenant)).toBe("deja");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("diffusion fermée (pas owner, variable absente) : rien, sans dépense", async () => {
    const d = deps({ estOuvert: vi.fn(async () => false) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("ferme");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("écarte les formats bloqués avant l'IA, ignore les ids inventés, au plus 5, expire à 28 jours", async () => {
    const d = deps();
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("ok");
    expect((d.choisir as any).mock.calls[0][0].tendances.map((t: any) => t.id)).toEqual([1, 3]);
    expect(d.enregistrer).toHaveBeenCalledWith([{ userId: "u", projectId: 4, tendanceId: 1, adaptation: "Ta cliente avant/après 3 séances.", statut: "nouveau", expireLe: new Date("2026-11-16T07:00:00Z") }]);
    expect(d.marquerTri).toHaveBeenCalledWith(4, "2026-10-19");
  });
  it("aucune tendance cette semaine : marqué trié, sans IA (zéro est normal)", async () => {
    const d = deps({ tendancesSemaine: vi.fn(async () => []) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("rien");
    expect(d.choisir).not.toHaveBeenCalled();
    expect(d.marquerTri).toHaveBeenCalledWith(4, "2026-10-19");
  });
  it("erreur IA : non marqué trié (un tour suivant réessaiera)", async () => {
    const d = deps({ choisir: vi.fn(async () => { throw new Error("x"); }) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("erreur");
    expect(d.marquerTri).not.toHaveBeenCalled();
  });
});

describe("injection", () => {
  it("bloc court, avec l'identifiant à renvoyer et la consigne de ne jamais copier", () => {
    const b = formaterBloc([{ id: 12, plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", lift: 3.1, adaptation: "Une cliente en 3 séances." }]);
    expect(b).toContain("[12] instagram · Carrousel avant/après — contenus forts 3,1× plus souvent");
    expect(b).toContain("Pour cette marque : Une cliente en 3 séances.");
    expect(b).toMatch(/jamais par obligation/);
    expect(b).toMatch(/Ne copie jamais/);
    expect(formaterBloc([])).toBe("");
  });
  it("tendancesPourLeContenu : seulement les tendances visibles des plateformes du post, 5 au plus", async () => {
    const lire = vi.fn(async () => [
      { id: 1, statut: "nouveau", expireLe: new Date("2026-11-01"), plateforme: "instagram", typeMedia: "carrousel", structure: "liste", lift: 2, adaptation: "a" },
      { id: 2, statut: "ecarte", expireLe: new Date("2026-11-01"), plateforme: "instagram", typeMedia: "reel", structure: "liste", lift: 2, adaptation: "b" },
      { id: 3, statut: "nouveau", expireLe: new Date("2026-11-01"), plateforme: "tiktok", typeMedia: "video", structure: "liste", lift: 2, adaptation: "c" },
      { id: 4, statut: "vu", expireLe: new Date("2026-10-01"), plateforme: "instagram", typeMedia: "image", structure: "liste", lift: 2, adaptation: "d" },
    ]);
    const b = await tendancesPourLeContenu("u", 4, ["Instagram"], lire as any, new Date("2026-10-20T00:00:00Z"));
    expect(b).toContain("[1]");
    expect(b).not.toContain("[2]");
    expect(b).not.toContain("[3]");
    expect(b).not.toContain("[4]");
    expect(await tendancesPourLeContenu("u", null, ["instagram"], lire as any)).toBe("");
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/profils-veille/tri.test.ts`
Expected : FAIL.

- [ ] **Step 3 : `tri.ts`**

```ts
// Niveau 2 : pour chaque marque, au plus 5 tendances du profil qui lui vont, avec une phrase
// d'adaptation. Et le bloc injecté UNIQUEMENT dans les appels qui écrivent du contenu.
import { z } from "zod/v4";
import { REGLES, clesEcartees, tendanceVisible, libelleFormat, type TypeMedia, type Structure } from "@shared/profils-veille";
import type { InsertTendanceProjet } from "@shared/schema";

export const SCHEMA_TRI = z.object({ choix: z.array(z.object({ tendanceId: z.number().int(), adaptation: z.string().min(1) })).max(REGLES.tendancesMaxParProjet) });

type Tendance = { id: number; cle: string; plateforme: string; typeMedia: string; structure: string; lift: number; pourquoi: string; commentAdapter: string };

export interface DepsTri {
  /** Diffusion ouverte pour cette utilisatrice (owner, ou PROFILS_VEILLE_POUR_TOUS=true). */
  estOuvert(userId: string): Promise<boolean>;
  garde(userId: string): Promise<unknown | null>;
  /** Tendances de la semaine du profil, non écartées par Jeanne. */
  tendancesSemaine(profilId: number, semaine: string): Promise<Tendance[]>;
  ecartees(projectId: number): Promise<Array<{ cle: string; ecarteLe: Date }>>;
  projet(userId: string, projectId: number): Promise<{ nom: string; plateformes: string; offre: string; cible: string }>;
  choisir(i: { userId: string; projectId: number; projet: { nom: string; plateformes: string; offre: string; cible: string }; tendances: Tendance[] }): Promise<z.infer<typeof SCHEMA_TRI>>;
  enregistrer(rows: InsertTendanceProjet[]): Promise<void>;
  marquerTri(projectId: number, semaine: string): Promise<void>;
}

export async function trierPourProjet(deps: DepsTri, r: { userId: string; projectId: number; profilId: number; dernierTri: string | null }, semaine: string, maintenant: Date) {
  if (r.dernierTri === semaine) return "deja" as const;
  if (!(await deps.estOuvert(r.userId))) return "ferme" as const;
  const bloquees = clesEcartees(await deps.ecartees(r.projectId), maintenant);
  const tendances = (await deps.tendancesSemaine(r.profilId, semaine)).filter((t) => !bloquees.has(t.cle));
  if (tendances.length === 0) { await deps.marquerTri(r.projectId, semaine); return "rien" as const; }
  if (await deps.garde(r.userId)) return "refus_garde" as const;
  try {
    const projet = await deps.projet(r.userId, r.projectId);
    const { choix } = await deps.choisir({ userId: r.userId, projectId: r.projectId, projet, tendances });
    const ids = new Set(tendances.map((t) => t.id));
    const expireLe = new Date(maintenant.getTime() + REGLES.dureeTendanceJours * 24 * 3600_000);
    const rows = choix.filter((c) => ids.has(c.tendanceId)).slice(0, REGLES.tendancesMaxParProjet)
      .map((c) => ({ userId: r.userId, projectId: r.projectId, tendanceId: c.tendanceId, adaptation: c.adaptation.slice(0, 400), statut: "nouveau", expireLe }));
    await deps.enregistrer(rows);
    await deps.marquerTri(r.projectId, semaine);
    return rows.length ? ("ok" as const) : ("rien" as const);
  } catch (e: any) {
    console.error(`[profils-veille] tri du projet ${r.projectId} :`, e?.message ?? e);
    return "erreur" as const;
  }
}

const virgule = (x: number) => x.toFixed(1).replace(".", ",");

export function formaterBloc(ts: Array<{ id: number; plateforme: string; typeMedia: string; structure: string; lift: number; adaptation: string }>): string {
  if (ts.length === 0) return "";
  return [
    "CE QUI MARCHE EN CE MOMENT DANS LE SECTEUR DE CETTE MARQUE (veille Naya, mesuré sur des marques comparables) :",
    ...ts.map((t) => `- [${t.id}] ${t.plateforme} · ${libelleFormat(t.typeMedia as TypeMedia, t.structure as Structure)} — contenus forts ${virgule(t.lift)}× plus souvent que la moyenne. Pour cette marque : ${t.adaptation}`),
    "Inspire-t'en quand c'est pertinent, jamais par obligation. Ne copie jamais un post existant.",
  ].join("\n");
}

type LigneInjection = { id: number; statut: string; expireLe: Date; plateforme: string; typeMedia: string; structure: string; lift: number; adaptation: string };

export async function tendancesPourLeContenu(
  userId: string, projectId: number | null | undefined, plateformes: string[],
  lire: (userId: string, projectId: number) => Promise<LigneInjection[]> = async (u, p) => (await import("./stockage")).stockageProfils.tendancesDuProjet(u, p),
  maintenant = new Date(),
): Promise<string> {
  if (projectId == null) return "";
  const voulues = new Set(plateformes.map((p) => p.toLowerCase()));
  try {
    const lignes = (await lire(userId, projectId))
      .filter((t) => voulues.has(t.plateforme.toLowerCase()) && tendanceVisible(t, maintenant))
      .slice(0, REGLES.tendancesMaxParProjet);
    return formaterBloc(lignes);
  } catch (e: any) {
    console.error("[profils-veille] bloc d'injection indisponible :", e?.message ?? e);
    return "";
  }
}
```

- [ ] **Step 4 : Requêtes du tri dans `stockage.ts`** (imports : `tendancesProjet`, `type InsertTendanceProjet`)

```ts
  async tendancesSemaineDuProfil(profilId: number, semaine: string) {
    return db.select({ id: profilTendances.id, cle: profilTendances.cle, plateforme: profilTendances.plateforme, typeMedia: profilTendances.typeMedia, structure: profilTendances.structure, lift: profilTendances.lift, pourquoi: profilTendances.pourquoi, commentAdapter: profilTendances.commentAdapter })
      .from(profilTendances).where(and(eq(profilTendances.profilId, profilId), eq(profilTendances.semaine, semaine), eq(profilTendances.ecarteParJeanne, false)));
  },
  async ecarteesDuProjet(projectId: number) {
    const rows = await db.select({ cle: profilTendances.cle, ecarteLe: tendancesProjet.ecarteLe }).from(tendancesProjet)
      .innerJoin(profilTendances, eq(profilTendances.id, tendancesProjet.tendanceId))
      .where(and(eq(tendancesProjet.projectId, projectId), eq(tendancesProjet.statut, "ecarte"), isNotNull(tendancesProjet.ecarteLe)));
    return rows.map((r) => ({ cle: r.cle, ecarteLe: r.ecarteLe as Date }));
  },
  async enregistrerTendancesProjet(rows: InsertTendanceProjet[]) {
    if (rows.length) await db.insert(tendancesProjet).values(rows).onConflictDoNothing();
  },
  async marquerTri(projectId: number, semaine: string) {
    await db.update(profilRattachements).set({ dernierTri: semaine }).where(eq(profilRattachements.projectId, projectId));
  },
  async tendancesDuProjet(userId: string, projectId: number) {
    return db.select({
      id: tendancesProjet.id, tendanceId: tendancesProjet.tendanceId, statut: tendancesProjet.statut, expireLe: tendancesProjet.expireLe, adaptation: tendancesProjet.adaptation, contentId: tendancesProjet.contentId,
      plateforme: profilTendances.plateforme, typeMedia: profilTendances.typeMedia, structure: profilTendances.structure, lift: profilTendances.lift,
      nbForts: profilTendances.nbForts, nbComptes: profilTendances.nbComptes, exemples: profilTendances.exemples, pourquoi: profilTendances.pourquoi,
      statutTendance: profilTendances.statut, semaine: profilTendances.semaine,
    }).from(tendancesProjet).innerJoin(profilTendances, eq(profilTendances.id, tendancesProjet.tendanceId))
      .where(and(eq(tendancesProjet.userId, userId), eq(tendancesProjet.projectId, projectId)))
      .orderBy(desc(tendancesProjet.createdAt), desc(profilTendances.lift)).limit(40);
  },
```

Note : dans `tendancesDuProjet`, `id` est l'id de `tendances_projet`. Le bloc d'injection affiche donc `[id de tendances_projet]` ; la Tâche 11 relit cet id pour poser `content.tendanceId` = `tendanceId` (id de `profil_tendances`) via `stockageProfils.tendanceProjet(userId, id)`.

- [ ] **Step 5 : Tests et types**

Run : `npx vitest run server/services/profils-veille/ && npx tsc --noEmit`
Expected : PASS, 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add server/services/profils-veille/
git commit -m "feat(profils-veille): tri par marque (5 tendances au plus) et bloc d'injection pour la création"
```

---

### Task 9 : Les vraies dépendances et le planificateur

**Files :**
- Create : `server/services/profils-veille/deps.ts`, `server/services/profils-veille/planificateur.ts`
- Modify : `server/services/profils-veille/stockage.ts`, `server/index.ts`
- Test : `server/services/profils-veille/planificateur.test.ts`

**Interfaces :**
- Consumes : `collecterProfil` (T5), `lancerAnalyse`, `finaliserAnalyse`, `SCHEMA_CLASSEMENT` (T6), `rattacherProjet`, `SCHEMA_CHOIX`, `SCHEMA_PROPOSITION` (T7), `trierPourProjet`, `SCHEMA_TRI` (T8), `genererStructure`, `soumettreLot`, `lireLot` (T3), `collecterParLot`, `instagramDataset` (T4), `REGLES`, `PLATEFORMES_LOT1`, `semaineDe`, `semaineAnalysee` (T1).
- Produces :
  - `depsCollecte`, `depsAnalyse`, `depsRattachement`, `depsTri` (instances réelles)
  - `interface DepsTour { … }` ; `tourProfilsVeille(maintenant: Date, d?: DepsTour): Promise<Record<string, number>>`
  - `scheduleProfilsVeille(): void`
  - `estOuvertPour(userId: string): Promise<boolean>`

- [ ] **Step 1 : Tests du planificateur (échouent)**

```ts
// server/services/profils-veille/planificateur.test.ts
import { describe, it, expect, vi } from "vitest";
import { tourProfilsVeille, type DepsTour } from "./planificateur";

function deps(over: Partial<DepsTour> = {}): DepsTour {
  return {
    projetsARattacher: vi.fn(async () => [{ userId: "u", projectId: 4 } as any]),
    rattacher: vi.fn(async () => "rattache"),
    profilsCollectables: vi.fn(async () => [{ id: 7, nom: "n", description: "d" }]),
    collecter: vi.fn(async () => ({ statut: "ok" }) as any),
    lancerAnalyse: vi.fn(async () => "lot_soumis" as const),
    analysesEnAttente: vi.fn(async () => [{ id: 30 } as any]),
    finaliser: vi.fn(async () => "termine" as const),
    rattachementsATrier: vi.fn(async () => [{ userId: "u", projectId: 4, profilId: 7, dernierTri: null }]),
    trier: vi.fn(async () => "ok" as const),
    purger: vi.fn(async () => 0),
    ...over,
  };
}

describe("tourProfilsVeille", () => {
  it("mercredi 6 h UTC : collecte Instagram des profils collectables, pas d'analyse", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T06:00:00Z"), d);
    expect(d.collecter).toHaveBeenCalledWith(7, "instagram", expect.any(Date));
    expect(d.lancerAnalyse).not.toHaveBeenCalled();
  });
  it("mercredi 4 h UTC : pas encore de collecte", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T04:00:00Z"), d);
    expect(d.collecter).not.toHaveBeenCalled();
  });
  it("jeudi : aucune collecte", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-15T06:00:00Z"), d);
    expect(d.collecter).not.toHaveBeenCalled();
  });
  it("dimanche 6 h UTC : analyse pour la semaine qui commence le lendemain", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-18T06:00:00Z"), d);
    expect(d.lancerAnalyse).toHaveBeenCalledWith({ id: 7, nom: "n", description: "d" }, "2026-10-19", expect.any(Date));
    expect(d.purger).toHaveBeenCalled();
  });
  it("à chaque tour : rattachements, lots en attente, tris de la semaine en cours", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-19T07:00:00Z"), d);
    expect(d.rattacher).toHaveBeenCalled();
    expect(d.finaliser).toHaveBeenCalled();
    expect(d.trier).toHaveBeenCalledWith({ userId: "u", projectId: 4, profilId: 7, dernierTri: null }, "2026-10-19", expect.any(Date));
  });
  it("une étape qui lève n'empêche pas les suivantes", async () => {
    const d = deps({ projetsARattacher: vi.fn(async () => { throw new Error("db"); }) });
    await tourProfilsVeille(new Date("2026-10-14T06:00:00Z"), d);
    expect(d.collecter).toHaveBeenCalled();
    expect(d.finaliser).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/services/profils-veille/planificateur.test.ts`
Expected : FAIL.

- [ ] **Step 3 : `planificateur.ts`**

```ts
// Le robot des profils de veille : un tour toutes les 15 minutes. Chaque étape est
// idempotente en base (unicité), donc un redémarrage ou une seconde instance ne double rien,
// et une étape manquée à l'heure est rattrapée au tour suivant du même jour.
import { REGLES, PLATEFORMES_LOT1, semaineDe, semaineAnalysee, type PlateformeVeille } from "@shared/profils-veille";

export interface DepsTour {
  projetsARattacher(): Promise<any[]>;
  rattacher(p: any): Promise<string>;
  profilsCollectables(): Promise<Array<{ id: number; nom: string; description: string }>>;
  collecter(profilId: number, plateforme: PlateformeVeille, maintenant: Date): Promise<unknown>;
  lancerAnalyse(profil: { id: number; nom: string; description: string }, semaine: string, maintenant: Date): Promise<string>;
  analysesEnAttente(): Promise<any[]>;
  finaliser(a: any): Promise<string>;
  rattachementsATrier(): Promise<Array<{ userId: string; projectId: number; profilId: number; dernierTri: string | null }>>;
  trier(r: { userId: string; projectId: number; profilId: number; dernierTri: string | null }, semaine: string, maintenant: Date): Promise<string>;
  purger(maintenant: Date): Promise<number>;
}

async function etape(nom: string, compte: Record<string, number>, f: () => Promise<number>) {
  try { compte[nom] = await f(); } catch (e: any) { console.error(`[profils-veille] étape ${nom} :`, e?.message ?? e); compte[nom] = -1; }
}

export async function tourProfilsVeille(maintenant: Date, d?: DepsTour): Promise<Record<string, number>> {
  const deps = d ?? (await import("./deps")).depsTour;
  const compte: Record<string, number> = {};
  const jour = maintenant.getUTCDay(), heure = maintenant.getUTCHours();

  await etape("rattachements", compte, async () => {
    let n = 0; for (const p of await deps.projetsARattacher()) { await deps.rattacher(p); n++; } return n;
  });
  if (REGLES.joursCollecteUtc.includes(jour) && heure >= REGLES.heureCollecteUtc) {
    await etape("collectes", compte, async () => {
      let n = 0;
      for (const p of await deps.profilsCollectables()) for (const pl of PLATEFORMES_LOT1) { await deps.collecter(p.id, pl, maintenant); n++; }
      return n;
    });
  }
  if (jour === REGLES.jourAnalyseUtc && heure >= REGLES.heureAnalyseUtc) {
    await etape("analyses", compte, async () => {
      let n = 0; for (const p of await deps.profilsCollectables()) { await deps.lancerAnalyse(p, semaineAnalysee(maintenant), maintenant); n++; } return n;
    });
    await etape("purge", compte, () => deps.purger(maintenant));
  }
  await etape("finalisations", compte, async () => {
    let n = 0; for (const a of await deps.analysesEnAttente()) { await deps.finaliser(a); n++; } return n;
  });
  await etape("tris", compte, async () => {
    let n = 0; const semaine = semaineDe(maintenant);
    for (const r of await deps.rattachementsATrier()) { await deps.trier(r, semaine, maintenant); n++; } return n;
  });
  return compte;
}

let enCours = false;
export function scheduleProfilsVeille(): void {
  const tick = async () => {
    if (enCours) return;
    enCours = true;
    try { await tourProfilsVeille(new Date()); } finally { enCours = false; }
  };
  setInterval(tick, 15 * 60_000);
  console.log("[profils-veille] robot planifié (toutes les 15 min)");
}
```

- [ ] **Step 4 : Requêtes du planificateur dans `stockage.ts`**

```ts
  /** Actif ET au moins un projet actif rattaché (propose ou confirme) : un profil vide ne coûte rien. */
  async profilsCollectables() {
    return db.selectDistinct({ id: profilsVeille.id, nom: profilsVeille.nom, description: profilsVeille.description })
      .from(profilsVeille)
      .innerJoin(profilRattachements, eq(profilRattachements.profilId, profilsVeille.id))
      .innerJoin(projects, eq(projects.id, profilRattachements.projectId))
      .where(and(eq(profilsVeille.statut, "actif"), inArray(profilRattachements.statut, ["propose", "confirme"]), eq(projects.projectStatus, "active")));
  },
  /** Rattachements actifs dont le profil a des tendances terminées pour cette semaine et pas encore triés. */
  async rattachementsATrier(semaine: string) {
    return db.selectDistinct({ userId: profilRattachements.userId, projectId: profilRattachements.projectId, profilId: profilRattachements.profilId, dernierTri: profilRattachements.dernierTri })
      .from(profilRattachements)
      .innerJoin(profilAnalyses, and(eq(profilAnalyses.profilId, profilRattachements.profilId), eq(profilAnalyses.semaine, semaine), inArray(profilAnalyses.statut, ["termine", "rien"])))
      .innerJoin(projects, eq(projects.id, profilRattachements.projectId))
      .where(and(inArray(profilRattachements.statut, ["propose", "confirme"]), eq(projects.projectStatus, "active"),
        sql`coalesce(${profilRattachements.dernierTri}, '') <> ${semaine}`));
  },
  async purgerPosts(maintenant: Date): Promise<number> {
    const limite = new Date(maintenant.getTime() - REGLES.retentionPostsJours * 24 * 3600_000);
    const r = await db.delete(profilPosts).where(lt(profilPosts.releveLe, limite)).returning({ id: profilPosts.id });
    return r.length;
  },
```

- [ ] **Step 5 : `deps.ts`**

```ts
// Les vraies dépendances du module (base, IA, Bright Data, recherche Google).
import { storage } from "../../storage";
import { CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import { SCRAPE_COST_EUR } from "../usage";
import { collecterParLot, instagramDataset } from "../brightdata-enrich";
import { chercher } from "../veille/collecte";
import { genererStructure } from "../ai/structure";
import { soumettreLot, lireLot } from "../ai/lots";
import { stockageProfils as s } from "./stockage";
import { collecterProfil, type DepsCollecte } from "./collecte";
import { lireProfilInstagram } from "./collecte/instagram";
import { lancerAnalyse, finaliserAnalyse, SCHEMA_CLASSEMENT, type DepsAnalyse } from "./analyse";
import { rattacherProjet, SCHEMA_CHOIX, SCHEMA_PROPOSITION, type DepsRattachement } from "./rattachement";
import { trierPourProjet, SCHEMA_TRI, type DepsTri } from "./tri";
import { semaineDe } from "@shared/profils-veille";
import type { DepsTour } from "./planificateur";

export async function estOuvertPour(userId: string): Promise<boolean> {
  if (process.env.PROFILS_VEILLE_POUR_TOUS === "true") return true;
  return (await storage.getUser(userId))?.role === "owner";
}

export const depsCollecte: DepsCollecte = {
  comptesSuivis: s.comptesSuivis, reserverPassage: s.reserverPassage, terminerPassage: s.terminerPassage,
  collecter: async (plateforme, urls) => {
    if (plateforme !== "instagram") return null;
    const ds = instagramDataset();
    return ds ? collecterParLot(ds, urls) : null;
  },
  lireProfil: lireProfilInstagram,
  clesExistantes: s.clesExistantes, enregistrerPosts: s.enregistrerPosts, historiqueCompte: s.historiqueCompte,
  marquerForts: s.marquerForts, majCompte: s.majCompte, depenseDuMois: s.depenseDuMois,
  coutParCompte: SCRAPE_COST_EUR,
};

const SYSTEME_CLASSEMENT =
  "Tu classes des publications de marques sur les réseaux sociaux. Pour chaque post (type de média + légende), donne sa structure et son type d'accroche, " +
  "en choisissant uniquement dans les valeurs proposées. Si rien ne correspond, « autre » avec un libellé court. Ne devine pas au-delà de ce que dit la légende.";

export const depsAnalyse: DepsAnalyse = {
  creerAnalyse: s.creerAnalyse, majAnalyse: s.majAnalyse, depenseDuMois: s.depenseDuMois,
  postsAClasser: s.postsAClasser, enregistrerFormat: s.enregistrerFormat, postsFenetre: s.postsFenetre,
  exemples: s.exemples, tendancesPrecedentes: s.tendancesPrecedentes as any, enregistrerTendances: s.enregistrerTendances,
  classer: async (posts) => {
    const { valeur, coutEur } = await genererStructure({
      schema: SCHEMA_CLASSEMENT, system: SYSTEME_CLASSEMENT, model: CLAUDE_MODELS.fast, maxTokens: 2500,
      taskKind: "classification", etape: "classement des formats",
      prompt: posts.map((p) => `#${p.id} [${p.typeMedia}] ${(p.legende ?? "(sans légende)").replace(/\s+/g, " ").slice(0, 500)}`).join("\n"),
    });
    return { resultats: valeur.posts, coutEur };
  },
  soumettre: (reqs) => soumettreLot(reqs),
  lire: (id) => lireLot(id),
  modeleRaisonnement: CLAUDE_MODELS.smart, modeleRapide: CLAUDE_MODELS.fast,
};

function contexteProjet(nom: string, dna: any, fond: any): string {
  const motivations = Array.isArray(fond?.motivations) ? fond.motivations.map((m: any) => m?.nom).filter(Boolean).join(", ") : "";
  return [
    `Marque : ${dna?.businessName || nom}`,
    dna?.businessType ? `Type de business : ${dna.businessType}` : "",
    dna?.businessDescription ? `Description : ${dna.businessDescription}` : "",
    dna?.primaryAudience ? `Cible : ${dna.primaryAudience}` : "",
    dna?.platformPriority ? `Plateformes : ${dna.platformPriority}` : "",
    fond?.offre?.nom ? `Offre d'entrée : ${fond.offre.nom}` : "",
    motivations ? `Motivations d'achat : ${motivations}` : "",
  ].filter(Boolean).join("\n");
}

export const depsRattachement: DepsRattachement = {
  garde: gardeDepense,
  catalogue: s.catalogueActif as any,
  choisir: async ({ userId, projectId, contexte, catalogue }) => (await genererStructure({
    schema: SCHEMA_CHOIX, model: CLAUDE_MODELS.fast, maxTokens: 400, taskKind: "classification", etape: "rattachement", userId, projectId,
    system: "Tu ranges une marque dans le profil de veille qui lui ressemble le plus (même type de marque, même cible). Si aucun ne lui ressemble vraiment, profilId null. Confiance entre 0 et 1, honnête. Raison en une phrase, en français.",
    prompt: `${contexte}\n\nProfils :\n${catalogue.map((p) => `#${p.id} ${p.nom} — ${p.description}`).join("\n")}`,
  })).valeur,
  enregistrer: s.enregistrerRattachement,
  proposer: async ({ userId, projectId, contexte }) => (await genererStructure({
    schema: SCHEMA_PROPOSITION, model: CLAUDE_MODELS.smart, maxTokens: 800, taskKind: "strategic_reasoning", etape: "proposition de profil", userId, projectId,
    system: "Tu définis un profil de veille : un TYPE de marque (jamais une marque précise), assez large pour regrouper des marques comparables. Nom court en français, description d'une phrase, critères, et jusqu'à 4 requêtes de recherche pour trouver des comptes Instagram de marques de ce type, en France de préférence.",
    prompt: contexte,
  })).valeur,
  chercher: async (userId, requetes) => {
    const liens: string[] = [];
    for (const q of requetes) {
      try { liens.push(...(await chercher(userId, q, { pays: "fr", langue: "fr" })).map((r) => r.link)); } catch (e: any) { console.error("[profils-veille] recherche :", e?.message); }
    }
    return liens;
  },
  creerProposition: s.creerProposition,
};

export const depsTri: DepsTri = {
  estOuvert: estOuvertPour,
  garde: gardeDepense,
  tendancesSemaine: s.tendancesSemaineDuProfil,
  ecartees: s.ecarteesDuProjet,
  projet: async (userId, projectId) => {
    const [pr, dna, fond] = await Promise.all([storage.getProject(projectId, userId), storage.getBrandDnaForProject(userId, projectId), storage.getFondations(userId, projectId)]);
    return { nom: pr?.name ?? "", plateformes: (dna as any)?.platformPriority ?? "", offre: (fond as any)?.offre?.nom ?? "", cible: (dna as any)?.primaryAudience ?? "" };
  },
  choisir: async ({ userId, projectId, projet, tendances }) => (await genererStructure({
    schema: SCHEMA_TRI, model: CLAUDE_MODELS.fast, maxTokens: 900, taskKind: "fast_generation", etape: "tri des tendances", userId, projectId,
    system: "Tu choisis, parmi des formats qui marchent dans un secteur, ceux qui vont à cette marque (au plus 5, zéro si aucun ne lui va), en tenant compte de ses plateformes, son offre et sa cible. Pour chacun, une phrase d'adaptation concrète à cette marque, en français, qui commence par un verbe. N'invente aucun chiffre ni client.",
    prompt: `Marque : ${projet.nom}\nPlateformes : ${projet.plateformes}\nOffre : ${projet.offre}\nCible : ${projet.cible}\n\nFormats :\n${tendances.map((t) => `#${t.id} ${t.plateforme} · ${t.typeMedia} ${t.structure} (×${t.lift.toFixed(1)}) — ${t.commentAdapter}`).join("\n")}`,
  })).valeur,
  enregistrer: s.enregistrerTendancesProjet,
  marquerTri: s.marquerTri,
};

export const depsTour: DepsTour = {
  projetsARattacher: async () => (await s.projetsARattacher(await storage.getActiveUserIds())).map((p) => ({ ...p, contexte: contexteProjet(p.nom, p.dna, p.fond) })),
  rattacher: (p) => rattacherProjet(depsRattachement, { userId: p.userId, projectId: p.projectId, nom: p.nom, contexte: p.contexte, exclus: p.exclus, rattachementId: p.rattachementId }),
  profilsCollectables: s.profilsCollectables,
  collecter: (id, pl, m) => collecterProfil(depsCollecte, id, pl, m),
  lancerAnalyse: (p, semaine, m) => lancerAnalyse(depsAnalyse, p, semaine, m),
  analysesEnAttente: s.analysesEnAttente,
  finaliser: (a) => finaliserAnalyse(depsAnalyse, a),
  rattachementsATrier: () => s.rattachementsATrier(semaineDe(new Date())),
  trier: (r, semaine, m) => trierPourProjet(depsTri, r, semaine, m),
  purger: s.purgerPosts,
};
```

- [ ] **Step 6 : Brancher le robot dans `server/index.ts`**

Import : `import { scheduleProfilsVeille } from "./services/profils-veille/planificateur";` puis, après `scheduleRoutines();` :

```ts
  // ─── Profils de veille : rattachement, collecte (lun/mer/ven), analyse (dim), tri (chaque tour) ──
  scheduleProfilsVeille();
```

- [ ] **Step 7 : Tests, types, suite**

Run : `npx vitest run server/services/profils-veille/ && npx tsc --noEmit && npx vitest run`
Expected : PASS, 0 erreur, suite verte.

- [ ] **Step 8 : Commit**

```bash
git add server/services/profils-veille/ server/index.ts
git commit -m "feat(profils-veille): vraies dépendances et robot toutes les 15 min"
```

---

### Task 10 : Routes admin et utilisatrice

**Files :**
- Create : `server/routes-profils-veille.ts`
- Modify : `server/routes.ts` (enregistrement), `server/services/profils-veille/stockage.ts`
- Test : `server/routes-profils-veille.test.ts`

**Interfaces :**
- Consumes : `stockageProfils` (T5–T9), `normaliserCompteInstagram`, `creneauTendance`, `REGLES`, `moisDe`, `libelleFormat` (T1), `collecterProfil`, `lancerAnalyse`, `depsCollecte`, `depsAnalyse` (T5, T6, T9), `estOuvertPour` (T9), `storage.getProject`, `storage.getUser`, `storage.createContent`, `placerTachesProductionPosts(storage, { userId, posts })`.
- Produces : `registerProfilsVeilleRoutes(app: Express): void` et les routes :
  - Admin (`owner`, sinon 403) : `GET /api/admin/profils-veille`, `POST /api/admin/profils-veille`, `PATCH /api/admin/profils-veille/:id`, `POST /api/admin/profils-veille/:id/comptes`, `PATCH /api/admin/profils-veille/comptes/:id`, `GET /api/admin/profils-veille/:id/tendances`, `PATCH /api/admin/profils-veille/tendances/:id`, `POST /api/admin/profils-veille/:id/lancer` (`{ etape: "collecte" | "analyse" }`), `GET /api/admin/profils-veille/etiquetage`, `POST /api/admin/profils-veille/etiquettes`.
  - Utilisatrice : `GET /api/profils-veille/projet/:projectId`, `POST /api/profils-veille/projet/:projectId/profil`, `POST /api/profils-veille/projet/:projectId/refuser`, `POST /api/profils-veille/projet/:projectId/suggestion`, `PATCH /api/profils-veille/tendances/:id`, `POST /api/profils-veille/tendances/:id/post`.

- [ ] **Step 1 : Tests (échouent)**

```ts
// server/routes-profils-veille.test.ts
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({ isAuthenticated: (req: any, _r: any, next: any) => { req.userId = req.headers["x-user"] || "user-1"; next(); } }));
const storageMock = {
  getUser: vi.fn(async (id: string) => ({ id, role: id === "owner-1" ? "owner" : "user" })),
  getProject: vi.fn(async (id: number, u: string) => (id === 4 && u === "user-1" ? { id: 4, userId: "user-1", name: "Lune" } : undefined)),
  createContent: vi.fn(async (row: any) => ({ id: 77, ...row })),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const s = vi.hoisted(() => ({
  rattachementDuProjet: vi.fn(async () => ({ id: 1, profilId: 7, statut: "propose", raison: "r", nomProfil: "Coachs", descriptionProfil: "d" })),
  catalogueActif: vi.fn(async () => [{ id: 7, nom: "Coachs", description: "d", criteres: {} }, { id: 8, nom: "Mode", description: "d", criteres: {} }]),
  tendancesDuProjet: vi.fn(async () => [{ id: 3, tendanceId: 12, statut: "nouveau", expireLe: new Date("2030-01-01"), plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", lift: 2, adaptation: "a", exemples: [], pourquoi: "p", nbForts: 3, nbComptes: 2 }]),
  tendanceProjet: vi.fn(async (u: string, id: number) => (u === "user-1" && id === 3 ? { id: 3, userId: "user-1", projectId: 4, tendanceId: 12, statut: "nouveau", adaptation: "Ta cliente avant/après", plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres" } : undefined)),
  majTendanceProjet: vi.fn(async () => {}),
  choisirProfil: vi.fn(async () => {}),
  refuserRattachement: vi.fn(async () => {}),
  ajouterCompte: vi.fn(async (row: any) => ({ id: 5, ...row })),
  listeAdmin: vi.fn(async () => []),
  creerProfil: vi.fn(async (row: any) => ({ id: 9, ...row })),
  majProfil: vi.fn(async (id: number, p: any) => (id === 9 ? { id, ...p } : undefined)),
  majCompteAdmin: vi.fn(async () => ({ id: 5 })),
  tendancesAdmin: vi.fn(async () => []),
  majTendanceAdmin: vi.fn(async () => ({ id: 1 })),
  aEtiqueter: vi.fn(async () => []),
  etiqueter: vi.fn(async () => {}),
  profil: vi.fn(async (id: number) => (id === 9 ? { id: 9, nom: "n", description: "d", statut: "actif" } : undefined)),
}));
vi.mock("./services/profils-veille/stockage", () => ({ stockageProfils: s }));
vi.mock("./services/profils-veille/deps", () => ({ estOuvertPour: vi.fn(async () => true), depsCollecte: {}, depsAnalyse: {} }));
const placement = vi.hoisted(() => ({ placerTachesProductionPosts: vi.fn(async () => ({ creees: 1 })) }));
vi.mock("./services/campagne/placement", () => placement);
vi.mock("./services/profils-veille/collecte", () => ({ collecterProfil: vi.fn(async () => ({ statut: "ok" })) }));
vi.mock("./services/profils-veille/analyse", () => ({ lancerAnalyse: vi.fn(async () => "rien") }));

const { registerProfilsVeilleRoutes } = await import("./routes-profils-veille");
const app = express(); app.use(express.json()); registerProfilsVeilleRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown, user = "user-1") =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-user": user }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => vi.clearAllMocks());

describe("routes utilisatrice", () => {
  it("404 sur le projet ou la tendance d'une autre", async () => {
    expect((await appel("GET", "/api/profils-veille/projet/5")).status).toBe(404);
    expect((await appel("PATCH", "/api/profils-veille/tendances/99", { statut: "garde" })).status).toBe(404);
    expect((await appel("POST", "/api/profils-veille/tendances/99/post")).status).toBe(404);
  });
  it("lit le rattachement, le catalogue et seulement les tendances visibles", async () => {
    const r = await (await appel("GET", "/api/profils-veille/projet/4")).json();
    expect(r.rattachement.nomProfil).toBe("Coachs");
    expect(r.catalogue.map((c: any) => c.id)).toEqual([7, 8]);
    expect(r.tendances.map((t: any) => t.id)).toEqual([3]);
    expect(r.ouvert).toBe(true);
  });
  it("changer de profil : seulement un profil du catalogue actif", async () => {
    expect((await appel("POST", "/api/profils-veille/projet/4/profil", { profilId: 99 })).status).toBe(400);
    expect((await appel("POST", "/api/profils-veille/projet/4/profil", { profilId: 8 })).status).toBe(200);
    expect(s.choisirProfil).toHaveBeenCalledWith("user-1", 4, 8);
  });
  it("suggérer un compte : normalisé, rattaché au profil du projet, origine suggestion", async () => {
    expect((await appel("POST", "/api/profils-veille/projet/4/suggestion", { plateforme: "instagram", saisie: "pas valide !" })).status).toBe(400);
    expect((await appel("POST", "/api/profils-veille/projet/4/suggestion", { plateforme: "instagram", saisie: "@Terre.Atelier" })).status).toBe(201);
    expect(s.ajouterCompte).toHaveBeenCalledWith({ profilId: 7, plateforme: "instagram", compte: "terre.atelier", url: "https://www.instagram.com/terre.atelier/", origine: "suggestion", suggerePar: "user-1", statut: "propose" });
  });
  it("statuts permis : vu, garde, ecarte (écarter date l'écart)", async () => {
    expect((await appel("PATCH", "/api/profils-veille/tendances/3", { statut: "utilise" })).status).toBe(400);
    expect((await appel("PATCH", "/api/profils-veille/tendances/3", { statut: "ecarte" })).status).toBe(200);
    expect(s.majTendanceProjet).toHaveBeenCalledWith(3, { statut: "ecarte", ecarteLe: expect.any(Date) });
  });
  it("En faire un post : crée un post à rédiger, relié à la tendance, et le place dans l'atelier", async () => {
    const r = await appel("POST", "/api/profils-veille/tendances/3/post");
    expect(r.status).toBe(201);
    const row = storageMock.createContent.mock.calls[0][0] as any;
    expect(row).toMatchObject({ userId: "user-1", projectId: 4, platform: "instagram", postFormat: "carousel", tendanceId: 12, tendanceProjetId: 3, contentStatus: "idea", autoPost: false });
    expect(row.body).toContain("Ta cliente avant/après");
    expect(placement.placerTachesProductionPosts).toHaveBeenCalled();
    expect(s.majTendanceProjet).toHaveBeenCalledWith(3, { statut: "utilise", contentId: 77 });
    expect((await r.json()).contentId).toBe(77);
  });
});

describe("routes admin", () => {
  it("403 sans rôle owner", async () => {
    expect((await appel("GET", "/api/admin/profils-veille")).status).toBe(403);
    expect((await appel("POST", "/api/admin/profils-veille", { nom: "x" })).status).toBe(403);
  });
  it("owner : crée un profil, refuse un nom vide, statut parmi les valeurs permises", async () => {
    expect((await appel("POST", "/api/admin/profils-veille", { nom: "" }, "owner-1")).status).toBe(400);
    expect((await appel("POST", "/api/admin/profils-veille", { nom: "Céramistes", description: "d" }, "owner-1")).status).toBe(201);
    expect((await appel("PATCH", "/api/admin/profils-veille/9", { statut: "nimporte" }, "owner-1")).status).toBe(400);
    expect((await appel("PATCH", "/api/admin/profils-veille/9", { statut: "actif" }, "owner-1")).status).toBe(200);
  });
  it("owner : refuse un 16e compte suivi sur une plateforme", async () => {
    s.listeAdmin.mockResolvedValueOnce([{ id: 9, comptes: Array.from({ length: 15 }, (_, i) => ({ id: i, plateforme: "instagram", statut: "suivi" })) }] as any);
    expect((await appel("POST", "/api/admin/profils-veille/9/comptes", { plateforme: "instagram", saisie: "@nouveau", statut: "suivi" }, "owner-1")).status).toBe(409);
  });
  it("owner : étiquette — structure et accroche du vocabulaire", async () => {
    expect((await appel("POST", "/api/admin/profils-veille/etiquettes", { postId: 1, structure: "x", accroche: "chiffre" }, "owner-1")).status).toBe(400);
    expect((await appel("POST", "/api/admin/profils-veille/etiquettes", { postId: 1, structure: "liste", accroche: "chiffre" }, "owner-1")).status).toBe(200);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run server/routes-profils-veille.test.ts`
Expected : FAIL.

- [ ] **Step 3 : Requêtes des routes dans `stockage.ts`** (imports : `profilEtiquettes`)

```ts
  async rattachementDuProjet(userId: string, projectId: number) {
    const [r] = await db.select({ id: profilRattachements.id, profilId: profilRattachements.profilId, statut: profilRattachements.statut, raison: profilRattachements.raison, nomProfil: profilsVeille.nom, descriptionProfil: profilsVeille.description, statutProfil: profilsVeille.statut })
      .from(profilRattachements).innerJoin(profilsVeille, eq(profilsVeille.id, profilRattachements.profilId))
      .where(and(eq(profilRattachements.userId, userId), eq(profilRattachements.projectId, projectId))).limit(1);
    return r;
  },
  async tendanceProjet(userId: string, id: number) {
    const [r] = await db.select({ id: tendancesProjet.id, userId: tendancesProjet.userId, projectId: tendancesProjet.projectId, tendanceId: tendancesProjet.tendanceId, statut: tendancesProjet.statut, adaptation: tendancesProjet.adaptation, plateforme: profilTendances.plateforme, typeMedia: profilTendances.typeMedia, structure: profilTendances.structure })
      .from(tendancesProjet).innerJoin(profilTendances, eq(profilTendances.id, tendancesProjet.tendanceId))
      .where(and(eq(tendancesProjet.id, id), eq(tendancesProjet.userId, userId))).limit(1);
    return r;
  },
  async majTendanceProjet(id: number, patch: Record<string, unknown>) {
    await db.update(tendancesProjet).set(patch as any).where(eq(tendancesProjet.id, id));
  },
  async choisirProfil(userId: string, projectId: number, profilId: number) {
    await db.insert(profilRattachements).values({ userId, projectId, profilId, confiance: 1, raison: "Choisi par l'utilisatrice.", statut: "confirme" })
      .onConflictDoUpdate({ target: profilRattachements.projectId, set: { profilId, statut: "confirme", raison: "Choisi par l'utilisatrice.", updatedAt: new Date() } });
  },
  async refuserRattachement(userId: string, projectId: number) {
    const [r] = await db.select().from(profilRattachements).where(and(eq(profilRattachements.userId, userId), eq(profilRattachements.projectId, projectId))).limit(1);
    if (!r) return;
    const exclus = Array.from(new Set([...(((r.exclus as number[]) ?? [])), r.profilId]));
    await db.update(profilRattachements).set({ statut: "refuse", exclus, updatedAt: new Date() }).where(eq(profilRattachements.id, r.id));
  },
  async ajouterCompte(row: { profilId: number; plateforme: string; compte: string; url: string; origine: string; suggerePar?: string | null; statut: string }) {
    const [c] = await db.insert(profilComptes).values(row).onConflictDoNothing().returning();
    return c ?? null;
  },
  async profil(id: number) {
    const [p] = await db.select().from(profilsVeille).where(eq(profilsVeille.id, id)).limit(1);
    return p;
  },
  async listeAdmin(mois: string) {
    const profils = await db.select().from(profilsVeille).orderBy(profilsVeille.statut, profilsVeille.nom);
    const out = [];
    for (const p of profils) {
      const [comptes, rattachements, passages] = await Promise.all([
        db.select().from(profilComptes).where(eq(profilComptes.profilId, p.id)).orderBy(profilComptes.plateforme, profilComptes.id),
        db.select({ id: profilRattachements.id, statut: profilRattachements.statut }).from(profilRattachements).where(eq(profilRattachements.profilId, p.id)),
        db.select().from(profilPassages).where(eq(profilPassages.profilId, p.id)).orderBy(desc(profilPassages.createdAt)).limit(6),
      ]);
      out.push({ ...p, comptes, nbProjets: rattachements.filter((r) => r.statut === "propose" || r.statut === "confirme").length, nbEnAttente: rattachements.filter((r) => r.statut === "en_attente").length, depenseMois: await this.depenseDuMois(p.id, mois), passages });
    }
    return out;
  },
  async creerProfil(row: { nom: string; description: string; criteres: unknown }) {
    const [p] = await db.insert(profilsVeille).values({ ...row, criteres: row.criteres as any, origine: "jeanne", statut: "actif" }).returning();
    return p;
  },
  async majProfil(id: number, patch: Record<string, unknown>) {
    const [p] = await db.update(profilsVeille).set({ ...patch, updatedAt: new Date() } as any).where(eq(profilsVeille.id, id)).returning();
    if (p && patch.statut === "actif") {
      // Un profil proposé validé : les projets en attente de lui deviennent rattachés.
      await db.update(profilRattachements).set({ statut: "propose", updatedAt: new Date() }).where(and(eq(profilRattachements.profilId, id), eq(profilRattachements.statut, "en_attente")));
    }
    return p;
  },
  async majCompteAdmin(id: number, patch: { statut: string }) {
    const [c] = await db.update(profilComptes).set({ ...patch, ...(patch.statut === "suivi" ? { echecsConsecutifs: 0 } : {}) }).where(eq(profilComptes.id, id)).returning();
    return c;
  },
  async tendancesAdmin(profilId: number, semaine: string) {
    return db.select().from(profilTendances).where(and(eq(profilTendances.profilId, profilId), eq(profilTendances.semaine, semaine))).orderBy(desc(profilTendances.lift));
  },
  async majTendanceAdmin(id: number, ecarteParJeanne: boolean) {
    const [t] = await db.update(profilTendances).set({ ecarteParJeanne }).where(eq(profilTendances.id, id)).returning();
    return t;
  },
  /** 40 posts récents, avec légende, pas encore étiquetés (banc d'évaluation). */
  async aEtiqueter() {
    return db.select({ id: profilPosts.id, typeMedia: profilPosts.typeMedia, legende: profilPosts.legende, url: profilPosts.url })
      .from(profilPosts).leftJoin(profilEtiquettes, eq(profilEtiquettes.postId, profilPosts.id))
      .where(and(isNull(profilEtiquettes.id), isNotNull(profilPosts.legende))).orderBy(desc(profilPosts.publieLe)).limit(40);
  },
  async etiqueter(postId: number, structure: string, accroche: string) {
    await db.insert(profilEtiquettes).values({ postId, structure, accroche }).onConflictDoUpdate({ target: profilEtiquettes.postId, set: { structure, accroche } });
  },
```

- [ ] **Step 4 : `server/routes-profils-veille.ts`**

```ts
// server/routes-profils-veille.ts — profils de veille : administration (rôle owner) et
// « Ce qui marche dans ton secteur » côté utilisatrice. Toute route utilisatrice vérifie que
// le projet ou la tendance est à elle (404 sinon, jamais une erreur SQL).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { stockageProfils as s } from "./services/profils-veille/stockage";
import { estOuvertPour, depsCollecte, depsAnalyse } from "./services/profils-veille/deps";
import { collecterProfil } from "./services/profils-veille/collecte";
import { lancerAnalyse } from "./services/profils-veille/analyse";
import { placerTachesProductionPosts } from "./services/campagne/placement";
import {
  REGLES, STRUCTURES, ACCROCHES, PLATEFORMES_VEILLE, normaliserCompteInstagram, creneauTendance, moisDe, semaineDe,
  semaineAnalysee, tendanceVisible, libelleFormat, type TypeMedia, type Structure,
} from "@shared/profils-veille";

const idDe = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const STATUTS_PROFIL = ["propose", "actif", "en_pause", "archive"];
const STATUTS_COMPTE = ["propose", "suivi", "ecarte"];
const STATUTS_TENDANCE_UTILISATRICE = ["vu", "garde", "ecarte"];
/** content.postFormat attendu par l'atelier pour chaque type de média. */
const FORMAT_POST: Record<TypeMedia, string> = { image: "feed_image", carrousel: "carousel", reel: "reel", video: "feed_video", texte: "text", document: "carousel" };
const TYPE_CONTENU: Record<TypeMedia, string> = { image: "image", carrousel: "carousel", reel: "video", video: "video", texte: "text", document: "carousel" };

async function estOwner(req: any) { return (await storage.getUser(req.userId))?.role === "owner"; }

function compteDe(plateforme: unknown, saisie: unknown) {
  if (plateforme !== "instagram" || typeof saisie !== "string") return null; // lots 2 et 3 : tiktok, linkedin
  return normaliserCompteInstagram(saisie);
}

export function registerProfilsVeilleRoutes(app: Express) {
  // ─── Utilisatrice ────────────────────────────────────────────────────────────
  app.get("/api/profils-veille/projet/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const pid = idDe(req.params.projectId);
      const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
      if (!projet) return res.status(404).json({ message: "not_found" });
      const [rattachement, catalogue, tendances, ouvert] = await Promise.all([
        s.rattachementDuProjet(req.userId, projet.id), s.catalogueActif(), s.tendancesDuProjet(req.userId, projet.id), estOuvertPour(req.userId),
      ]);
      const maintenant = new Date();
      res.json({
        ouvert,
        rattachement: rattachement ?? null,
        catalogue: catalogue.map((c: any) => ({ id: c.id, nom: c.nom, description: c.description })),
        tendances: ouvert ? tendances.filter((t: any) => tendanceVisible(t, maintenant)).map((t: any) => ({ ...t, libelle: libelleFormat(t.typeMedia as TypeMedia, t.structure as Structure) })) : [],
      });
    } catch (e: any) {
      console.error("[ProfilsVeille] lecture projet :", e?.message);
      res.status(500).json({ message: "profils_veille_read_failed" });
    }
  });

  app.post("/api/profils-veille/projet/:projectId/profil", isAuthenticated, async (req: any, res) => {
    const pid = idDe(req.params.projectId);
    const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
    if (!projet) return res.status(404).json({ message: "not_found" });
    const profilId = idDe(req.body?.profilId);
    if (!profilId || !(await s.catalogueActif()).some((c: any) => c.id === profilId)) return res.status(400).json({ message: "profil_invalide" });
    await s.choisirProfil(req.userId, projet.id, profilId);
    res.json({ ok: true });
  });

  app.post("/api/profils-veille/projet/:projectId/refuser", isAuthenticated, async (req: any, res) => {
    const pid = idDe(req.params.projectId);
    const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
    if (!projet) return res.status(404).json({ message: "not_found" });
    await s.refuserRattachement(req.userId, projet.id);
    res.json({ ok: true });
  });

  app.post("/api/profils-veille/projet/:projectId/suggestion", isAuthenticated, async (req: any, res) => {
    const pid = idDe(req.params.projectId);
    const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
    if (!projet) return res.status(404).json({ message: "not_found" });
    const r = await s.rattachementDuProjet(req.userId, projet.id);
    if (!r) return res.status(409).json({ message: "sans_profil" });
    const c = compteDe(req.body?.plateforme, req.body?.saisie);
    if (!c) return res.status(400).json({ message: "compte_invalide" });
    const cree = await s.ajouterCompte({ profilId: r.profilId, plateforme: req.body.plateforme, compte: c.compte, url: c.url, origine: "suggestion", suggerePar: req.userId, statut: "propose" });
    res.status(201).json({ compte: cree });
  });

  app.patch("/api/profils-veille/tendances/:id", isAuthenticated, async (req: any, res) => {
    const id = idDe(req.params.id);
    const t = id ? await s.tendanceProjet(req.userId, id) : undefined;
    if (!t) return res.status(404).json({ message: "not_found" });
    const statut = req.body?.statut;
    if (!STATUTS_TENDANCE_UTILISATRICE.includes(statut)) return res.status(400).json({ message: "statut_invalide" });
    await s.majTendanceProjet(t.id, statut === "ecarte" ? { statut, ecarteLe: new Date() } : { statut });
    res.json({ ok: true });
  });

  app.post("/api/profils-veille/tendances/:id/post", isAuthenticated, async (req: any, res) => {
    try {
      const id = idDe(req.params.id);
      const t = id ? await s.tendanceProjet(req.userId, id) : undefined;
      if (!t) return res.status(404).json({ message: "not_found" });
      const typeMedia = t.typeMedia as TypeMedia;
      const libelle = libelleFormat(typeMedia, t.structure as Structure);
      const cree = await storage.createContent({
        userId: req.userId, projectId: t.projectId, title: libelle, platform: t.plateforme,
        // La consigne de rédaction : l'atelier la lit dans `body` tant que le post est « à rédiger ».
        body: `Format : ${libelle} (ce qui marche en ce moment dans ton secteur). ${t.adaptation}`,
        contentType: TYPE_CONTENU[typeMedia], postFormat: FORMAT_POST[typeMedia], pillar: "tendance", goal: "visibility",
        contentStatus: "idea", autoPost: false, scheduledFor: creneauTendance(new Date()),
        tendanceId: t.tendanceId, tendanceProjetId: t.id,
      } as any);
      await placerTachesProductionPosts(storage as any, { userId: req.userId, posts: [cree as any] })
        .catch((e: any) => console.error("[ProfilsVeille] atelier du post :", e?.message ?? e));
      await s.majTendanceProjet(t.id, { statut: "utilise", contentId: cree.id });
      res.status(201).json({ contentId: cree.id, semaine: semaineDe(new Date(cree.scheduledFor as any)) });
    } catch (e: any) {
      console.error("[ProfilsVeille] en faire un post :", e?.message);
      res.status(500).json({ message: "post_failed" });
    }
  });

  // ─── Administration (owner) ──────────────────────────────────────────────────
  const admin = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    if (!(await estOwner(req))) return res.status(403).json({ message: "forbidden" });
    try { await h(req, res); } catch (e: any) { console.error("[ProfilsVeille] admin :", e?.message); res.status(500).json({ message: "admin_failed" }); }
  };

  app.get("/api/admin/profils-veille", isAuthenticated, admin(async (_req, res) => {
    res.json({ profils: await s.listeAdmin(moisDe(new Date())), plafond: REGLES.plafondEurParMois });
  }));

  app.post("/api/admin/profils-veille", isAuthenticated, admin(async (req, res) => {
    const nom = typeof req.body?.nom === "string" ? req.body.nom.trim().slice(0, 80) : "";
    if (nom.length < 2) return res.status(400).json({ message: "nom_requis" });
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 400) : "";
    res.status(201).json({ profil: await s.creerProfil({ nom, description, criteres: req.body?.criteres ?? {} }) });
  }));

  app.patch("/api/admin/profils-veille/:id", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const patch: Record<string, unknown> = {};
    if (req.body?.statut !== undefined) { if (!STATUTS_PROFIL.includes(req.body.statut)) return res.status(400).json({ message: "statut_invalide" }); patch.statut = req.body.statut; }
    if (typeof req.body?.nom === "string" && req.body.nom.trim().length >= 2) patch.nom = req.body.nom.trim().slice(0, 80);
    if (typeof req.body?.description === "string") patch.description = req.body.description.trim().slice(0, 400);
    if (req.body?.criteres && typeof req.body.criteres === "object") patch.criteres = req.body.criteres;
    const p = id ? await s.majProfil(id, patch) : undefined;
    if (!p) return res.status(404).json({ message: "not_found" });
    res.json({ profil: p });
  }));

  app.post("/api/admin/profils-veille/:id/comptes", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const c = compteDe(req.body?.plateforme, req.body?.saisie);
    if (!id || !c) return res.status(400).json({ message: "compte_invalide" });
    const statut = req.body?.statut === "suivi" ? "suivi" : "propose";
    if (statut === "suivi") {
      const p = (await s.listeAdmin(moisDe(new Date()))).find((x: any) => x.id === id);
      const suivis = (p?.comptes ?? []).filter((x: any) => x.plateforme === req.body.plateforme && x.statut === "suivi").length;
      if (suivis >= REGLES.comptesMaxParPlateforme) return res.status(409).json({ message: "plafond_comptes" });
    }
    res.status(201).json({ compte: await s.ajouterCompte({ profilId: id, plateforme: req.body.plateforme, compte: c.compte, url: c.url, origine: "jeanne", statut }) });
  }));

  app.patch("/api/admin/profils-veille/comptes/:id", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !STATUTS_COMPTE.includes(req.body?.statut)) return res.status(400).json({ message: "statut_invalide" });
    const c = await s.majCompteAdmin(id, { statut: req.body.statut });
    if (!c) return res.status(404).json({ message: "not_found" });
    res.json({ compte: c });
  }));

  app.get("/api/admin/profils-veille/:id/tendances", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const semaine = typeof req.query.semaine === "string" ? req.query.semaine : semaineDe(new Date());
    res.json({ semaine, tendances: id ? await s.tendancesAdmin(id, semaine) : [] });
  }));

  app.patch("/api/admin/profils-veille/tendances/:id", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const t = id ? await s.majTendanceAdmin(id, req.body?.ecarteParJeanne === true) : undefined;
    if (!t) return res.status(404).json({ message: "not_found" });
    res.json({ tendance: t });
  }));

  app.post("/api/admin/profils-veille/:id/lancer", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const p = id ? await s.profil(id) : undefined;
    if (!p) return res.status(404).json({ message: "not_found" });
    const maintenant = new Date();
    if (req.body?.etape === "collecte") return res.json({ resultat: await collecterProfil(depsCollecte, p.id, "instagram", maintenant) });
    if (req.body?.etape === "analyse") return res.json({ resultat: await lancerAnalyse(depsAnalyse, p, semaineAnalysee(maintenant), maintenant) });
    res.status(400).json({ message: "etape_invalide" });
  }));

  app.get("/api/admin/profils-veille/etiquetage", isAuthenticated, admin(async (_req, res) => {
    res.json({ posts: await s.aEtiqueter(), structures: STRUCTURES, accroches: ACCROCHES });
  }));

  app.post("/api/admin/profils-veille/etiquettes", isAuthenticated, admin(async (req, res) => {
    const postId = idDe(req.body?.postId);
    if (!postId || !(STRUCTURES as readonly string[]).includes(req.body?.structure) || !(ACCROCHES as readonly string[]).includes(req.body?.accroche)) return res.status(400).json({ message: "etiquette_invalide" });
    await s.etiqueter(postId, req.body.structure, req.body.accroche);
    res.json({ ok: true });
  }));
}

export { PLATEFORMES_VEILLE };
```

Note : « Lancer maintenant » ne contourne rien — `collecterProfil` réserve le passage du jour (un second clic renvoie `{ statut: "deja" }`) et respecte le plafond.

- [ ] **Step 5 : Enregistrer les routes dans `server/routes.ts`**

Import en tête, à côté de `registerVeilleRoutes` : `import { registerProfilsVeilleRoutes } from "./routes-profils-veille";` puis, après `registerVeilleRoutes(app);` : `registerProfilsVeilleRoutes(app);`

- [ ] **Step 6 : Tests, types, suite**

Run : `npx vitest run server/routes-profils-veille.test.ts && npx tsc --noEmit && npx vitest run`
Expected : PASS, 0 erreur, suite verte.

- [ ] **Step 7 : Commit**

```bash
git add server/routes-profils-veille.ts server/routes-profils-veille.test.ts server/routes.ts server/services/profils-veille/stockage.ts
git commit -m "feat(profils-veille): routes admin (owner) et utilisatrice — rattachement, tendances, En faire un post"
```

---

### Task 11 : L'atelier et les autres générateurs reçoivent les tendances

**Files :**
- Modify : `shared/atelier.ts` (`etatPost`), `server/services/atelier/redaction.ts`, `server/services/atelier/deps.ts`, `server/services/openai.ts` (`generateContent`, `generateCampaignContent`), `server/routes.ts` (régénération `POST /api/content/:id/regenerate`), `server/services/refus-post/remplacement.ts`
- Test : `shared/atelier.test.ts`, `server/services/atelier/redaction.test.ts` (ajouts)

**Interfaces :**
- Consumes : `tendancesPourLeContenu(userId, projectId, plateformes)` (T8), `extraireTendance(texte)` (T1), `stockageProfils.tendanceProjet` (T10).
- Produces :
  - `etatPost` accepte `tendanceProjetId?: number | null` : un post issu d'une tendance (hors campagne) dont le `body` est la consigne est « à rédiger ».
  - `PostARediger.tendanceProjetId?: number | null` ; `DepsRedaction.ia(userId, projectId, prompt, opts?: { plateformes: string[] }): Promise<string>` ; `DepsRedaction.lierTendance(id: number, userId: string, tendanceProjetId: number): Promise<void>`.

- [ ] **Step 1 : Tests (échouent)**

Dans `shared/atelier.test.ts`, sous `describe("etatPost"…)` :

```ts
  it("un post créé depuis une tendance (hors campagne) avec sa consigne dans body est « à rédiger »", () => {
    expect(etatPost({ campaignId: null, tendanceProjetId: 3, body: "Format : Carrousel avant/après…" })).toBe("a_rediger");
    expect(etatPost({ campaignId: null, tendanceProjetId: 3, body: "x", consigne: "Format…" })).toBe("brouillon");
  });
```

Dans `server/services/atelier/redaction.test.ts` (suivre les mocks de deps existants du fichier ; `depsTest()` désigne la fabrique de deps déjà présente — l'étendre avec `lierTendance: vi.fn(async () => {})`) :

```ts
  it("rédige un post issu d'une tendance (hors campagne) et transmet la plateforme pour l'injection", async () => {
    const deps = depsTest({ lirePost: vi.fn(async () => ({ id: 5, projectId: 4, campaignId: null, tendanceProjetId: 3, platform: "instagram", postFormat: "carousel", title: "Carrousel avant/après", body: "Format : … Ta cliente", consigne: null, contentStatus: "idea", autoPost: false })) });
    const r = await redigerPost(deps, "u", 5);
    expect(r.statut).toBe("redige");
    expect((deps.ia as any).mock.calls[0][3]).toEqual({ plateformes: ["instagram"] });
  });
  it("lit puis retire la ligne TENDANCE: <id> et relie le post à la tendance", async () => {
    const deps = depsTest({ ia: vi.fn(async () => "LÉGENDE :\nMon texte\nSLIDES :\n1. a\n\nTENDANCE: 3") });
    const r = await redigerPost(deps, "u", 1);
    expect(r).toMatchObject({ statut: "redige" });
    expect((r as any).body).not.toContain("TENDANCE");
    expect(deps.lierTendance).toHaveBeenCalledWith(1, "u", 3);
  });
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx vitest run shared/atelier.test.ts server/services/atelier/redaction.test.ts`
Expected : FAIL sur les nouveaux cas.

- [ ] **Step 3 : `etatPost` (shared/atelier.ts)**

Ajouter `tendanceProjetId?: number | null;` au type du paramètre, et remplacer la ligne du post manuel par :

```ts
  // Un post manuel : son texte est celui de l'utilisatrice, pas une consigne à rédiger. Un post
  // créé depuis une tendance (« En faire un post ») porte, lui, une consigne : il est à rédiger.
  if (p.campaignId === null && p.tendanceProjetId == null && (p.body ?? "").trim()) return "brouillon";
```

- [ ] **Step 4 : `redaction.ts`**

- `PostARediger` : ajouter `tendanceProjetId?: number | null;`.
- `DepsRedaction` : `ia(userId: string, projectId: number | null, prompt: string, opts?: { plateformes: string[] }): Promise<string>;` et `lierTendance(id: number, userId: string, tendanceProjetId: number): Promise<void>;`.
- `consigneRedaction` : ajouter dans les règles, juste avant « Réponds uniquement… » :

```ts
    "- Si tu t'inspires d'un format de la liste « Ce qui marche en ce moment dans le secteur », termine par une ligne seule : TENDANCE: <numéro entre crochets>. Sinon, n'ajoute rien.",
```

- Dans `ecrire`, remplacer la première ligne du `try` par :

```ts
    const sortie = extraireTendance(nettoyerTexte(await deps.ia(userId, post.projectId ?? null, prompt, { plateformes: post.platform ? [post.platform] : [] })));
    const brut = sortie.texte;
```

puis, juste avant `return { statut: "redige", body };` :

```ts
    if (sortie.tendanceId != null) await deps.lierTendance(post.id, userId, sortie.tendanceId).catch(() => {});
```

(import : `import { extraireTendance } from "@shared/profils-veille";`)

- `redigerPost` : remplacer `if (post.campaignId == null || …` par `if ((post.campaignId == null && post.tendanceProjetId == null) || !modifiable(post) || etatPost(post) !== "a_rediger") return { statut: "deja" };`

- [ ] **Step 5 : `atelier/deps.ts`**

```ts
  ia: async (userId, projectId, prompt, opts) => callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1500,
    additionalSystemContext: await tendancesPourLeContenu(userId, projectId, opts?.plateformes ?? []),
  }),
  async lierTendance(id, userId, tendanceProjetId) {
    const t = await stockageProfils.tendanceProjet(userId, tendanceProjetId);
    if (t) await db.update(content).set({ tendanceId: t.tendanceId }).where(and(eq(content.id, id), eq(content.userId, userId)));
  },
```

(imports : `tendancesPourLeContenu` de `../profils-veille/tri`, `stockageProfils` de `../profils-veille/stockage`.)

Remarque : la voix utilisée par l'atelier (voix de Naya au lieu de la voix de la marque) est un défaut relevé par l'audit du 14 oct. ; il n'est **pas** traité dans ce lot.

- [ ] **Step 6 : Les autres générateurs** (injection seulement, pas de `TENDANCE:`)

`server/services/openai.ts`, `generateContent` — dans l'appel `callClaudeWithContext`, ajouter :

```ts
      additionalSystemContext: [/* valeur existante s'il y en a une */ await tendancesPourLeContenu(request.userId, projectId, [request.platform])].filter(Boolean).join("\n\n"),
```

`generateCampaignContent` — ajouter le bloc à la fin du message utilisateur :

```ts
  const tendances = await tendancesPourLeContenu(request.userId, request.projectId ?? null, (strategy.channels || []).map((c) => c.platform));
  // …
    messages: [{ role: 'user', content: prompt + buildCampaignBrandContext(request.brandDna) + (tendances ? `\n\n${tendances}` : "") }],
```

`server/routes.ts`, route de régénération (`POST /api/content/:id/regenerate`, appel `callClaudeWithContext` vers la ligne 7395) — ajouter `additionalSystemContext: await tendancesPourLeContenu(req.userId, existing.projectId ?? null, [existing.platform])` (en le concaténant à la valeur existante s'il y en a une).

`server/services/refus-post/remplacement.ts` — même ajout dans son `callClaudeWithContext`, avec `[post.platform ?? ""]`.

Import dans chaque fichier : `import { tendancesPourLeContenu } from "./profils-veille/tri";` (chemin relatif selon le fichier).

- [ ] **Step 7 : Tests, types, suite**

Run : `npx vitest run && npx tsc --noEmit`
Expected : vert, 0 erreur. Si un test existant de ces générateurs vérifie l'objet exact passé à `callClaudeWithContext`, mocker `tendancesPourLeContenu` (`vi.mock(".../profils-veille/tri", () => ({ tendancesPourLeContenu: vi.fn(async () => "") }))`) et adapter l'attendu (`additionalSystemContext` vide ou absent selon la concaténation choisie).

- [ ] **Step 8 : Commit**

```bash
git add shared/atelier.ts shared/atelier.test.ts server/services/atelier/ server/services/openai.ts server/routes.ts server/services/refus-post/remplacement.ts
git commit -m "feat(profils-veille): l'atelier rédige les posts issus d'une tendance ; tendances injectées dans la création de contenu"
```

---

### Task 12 : L'interface

**Files :**
- Create : `client/src/components/tendances-secteur.tsx`, `client/src/pages/admin-profils-veille.tsx`
- Modify : `client/src/pages/veille.tsx` (`VeilleProjet`), `client/src/pages/dashboard.tsx`, `client/src/App.tsx`, `client/src/components/sidebar.tsx` (lien owner), `client/src/locales/fr.ts`, `client/src/locales/en.ts`
- Test : cliquets existants `client/src/locales/*.test.ts` (jsx-guard, keys-exist, locales)

**Interfaces :**
- Consumes : routes de la Tâche 10.
- Produces : `TendancesSecteur({ projectId, compact? })`, page `AdminProfilsVeille`, route `/admin/profils-veille`.

- [ ] **Step 1 : Clés de traduction** (même structure dans `fr.ts` et `en.ts`, au premier niveau de l'objet)

```ts
 tendancesSecteur: {
  titre: "Ce qui marche dans ton secteur",
  suivi: "Naya suit pour toi les marques « {{profil}} ».",
  enAttente: "Naya prépare un profil de veille pour ta marque. Il sera actif dès qu'il aura été vérifié.",
  aucunProfil: "Pas encore de profil de veille pour cette marque.",
  pasToi: "Ce n'est pas toi ?",
  choisir: "Choisir un autre profil",
  aucunDesDeux: "Aucun ne me correspond",
  suggerer: "Suggérer un compte que tu admires",
  suggererPlaceholder: "@compte Instagram",
  suggestionOk: "Merci, ce compte sera vérifié.",
  suggestionKo: "Ce compte n'est pas reconnu.",
  rien: "Rien de net cette semaine dans ton secteur.",
  ferme: "Bientôt disponible.",
  mesure: "Contenus forts {{lift}}× plus souvent que la moyenne ({{forts}} posts, {{comptes}} marques, 14 derniers jours).",
  pourquoi: "Pourquoi ça marche (hypothèse)",
  pourToi: "Pour toi",
  exemples: "Exemples",
  enFaireUnPost: "En faire un post",
  garder: "Garder",
  garde: "Gardée",
  ecarter: "Écarter",
  postCree: "Post créé : il t'attend dans l'atelier.",
  ouvrirAtelier: "Ouvrir l'atelier",
  carteLundi: "Les formats qui marchent cette semaine dans ton secteur",
  voir: "Voir",
 },
 adminProfils: {
  titre: "Profils de veille",
  nouveau: "Nouveau profil",
  nom: "Nom",
  description: "Description",
  creer: "Créer",
  statut: { propose: "Proposé", actif: "Actif", en_pause: "En pause", archive: "Archivé" },
  activer: "Activer",
  pause: "Mettre en pause",
  archiver: "Archiver",
  comptes: "Comptes suivis",
  ajouterCompte: "Ajouter un compte",
  suivre: "Suivre",
  ecarter: "Écarter",
  compteStatut: { propose: "Proposé", suivi: "Suivi", ecarte: "Écarté", injoignable: "Injoignable" },
  origine: { naya: "Naya", jeanne: "Toi", suggestion: "Suggestion" },
  projets: "{{n}} marque(s) rattachée(s)",
  enAttente: "{{n}} marque(s) en attente",
  depense: "{{eur}} € ce mois / {{plafond}} €",
  passages: "Derniers passages",
  lancerCollecte: "Collecter maintenant",
  lancerAnalyse: "Analyser maintenant",
  tendances: "Tendances de la semaine",
  ecarterTendance: "Ne pas diffuser",
  diffuser: "Diffuser",
  etiquetage: "Banc d'évaluation : étiqueter des posts",
  etiquetageAide: "Pour chaque post, choisis la structure et l'accroche. Naya sera comparée à toi avant d'être ouverte à tous.",
  structure: "Structure",
  accroche: "Accroche",
  enregistrer: "Enregistrer",
  plafondComptes: "15 comptes suivis au plus par plateforme.",
  interdit: "Réservé à l'administration.",
 },
```

En anglais (`en.ts`), traduire chaque valeur (ex. `titre: "What works in your industry"`, `rien: "Nothing clear in your industry this week."`, `enFaireUnPost: "Turn into a post"`…).

- [ ] **Step 2 : `client/src/components/tendances-secteur.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { TrendingUp, ExternalLink, Pin, X, PenLine } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tendance = { id: number; statut: string; libelle: string; plateforme: string; lift: number; nbForts: number; nbComptes: number; exemples: string[]; pourquoi: string; adaptation: string };
type Donnees = {
  ouvert: boolean;
  rattachement: { profilId: number; statut: string; nomProfil: string } | null;
  catalogue: Array<{ id: number; nom: string }>;
  tendances: Tendance[];
};

export function TendancesSecteur({ projectId, compact = false }: { projectId: number; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const cle = `/api/profils-veille/projet/${projectId}`;
  const { data } = useQuery<Donnees>({ queryKey: [cle] });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [cle] });
  const [choix, setChoix] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [postCree, setPostCree] = useState<string | null>(null);

  const statut = useMutation({ mutationFn: ({ id, s }: { id: number; s: string }) => apiRequest("PATCH", `/api/profils-veille/tendances/${id}`, { statut: s }), onSuccess: rafraichir });
  const enPost = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/profils-veille/tendances/${id}/post`).then((r) => r.json()),
    onSuccess: (r: { semaine: string }) => { setPostCree(r.semaine); rafraichir(); toast({ title: t("tendancesSecteur.postCree") }); },
  });
  const changer = useMutation({ mutationFn: (profilId: number) => apiRequest("POST", `${cle}/profil`, { profilId }), onSuccess: () => { setChoix(false); rafraichir(); } });
  const refuser = useMutation({ mutationFn: () => apiRequest("POST", `${cle}/refuser`), onSuccess: () => { setChoix(false); rafraichir(); } });
  const suggerer = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/suggestion`, { plateforme: "instagram", saisie }),
    onSuccess: () => { setSaisie(""); toast({ title: t("tendancesSecteur.suggestionOk") }); },
    onError: () => toast({ title: t("tendancesSecteur.suggestionKo"), variant: "destructive" }),
  });

  if (!data) return null;
  if (compact) {
    if (!data.ouvert || data.tendances.length === 0) return null;
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4" />{t("tendancesSecteur.carteLundi")}</div>
          <Link href={`/projects/${projectId}?onglet=veille`}><Button size="sm" variant="outline">{t("tendancesSecteur.voir")}</Button></Link>
        </CardContent>
      </Card>
    );
  }

  const nombre = (x: number) => x.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />{t("tendancesSecteur.titre")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!data.rattachement && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.aucunProfil")}</p>}
        {data.rattachement?.statut === "en_attente" && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.enAttente")}</p>}
        {data.rattachement && data.rattachement.statut !== "en_attente" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("tendancesSecteur.suivi", { profil: data.rattachement.nomProfil })}</span>
            <Button size="sm" variant="ghost" onClick={() => setChoix(!choix)}>{t("tendancesSecteur.pasToi")}</Button>
          </div>
        )}
        {choix && (
          <div className="flex flex-wrap gap-2">
            {data.catalogue.filter((c) => c.id !== data.rattachement?.profilId).map((c) => (
              <Button key={c.id} size="sm" variant="outline" onClick={() => changer.mutate(c.id)}>{c.nom}</Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => refuser.mutate()}>{t("tendancesSecteur.aucunDesDeux")}</Button>
          </div>
        )}
        {data.rattachement && data.rattachement.statut !== "en_attente" && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) suggerer.mutate(); }}>
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder={t("tendancesSecteur.suggererPlaceholder")} className="max-w-xs" />
            <Button size="sm" variant="outline" type="submit">{t("tendancesSecteur.suggerer")}</Button>
          </form>
        )}

        {!data.ouvert && data.rattachement && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.ferme")}</p>}
        {data.ouvert && data.rattachement && data.tendances.length === 0 && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.rien")}</p>}
        {postCree && <Link href={`/atelier?semaine=${postCree}`}><Button size="sm">{t("tendancesSecteur.ouvrirAtelier")}</Button></Link>}

        {data.tendances.map((tend) => (
          <div key={tend.id} className="rounded-lg border p-4 space-y-2" onMouseEnter={() => tend.statut === "nouveau" && statut.mutate({ id: tend.id, s: "vu" })}>
            <div className="font-medium">{tend.libelle} · {tend.plateforme}</div>
            <div className="text-xs text-muted-foreground">{t("tendancesSecteur.mesure", { lift: nombre(tend.lift), forts: tend.nbForts, comptes: tend.nbComptes })}</div>
            <div className="text-sm"><span className="font-medium">{t("tendancesSecteur.pourToi")} : </span>{tend.adaptation}</div>
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("tendancesSecteur.pourquoi")}</summary><p className="mt-1">{tend.pourquoi}</p></details>
            {tend.exemples.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-muted-foreground">{t("tendancesSecteur.exemples")} :</span>
                {tend.exemples.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">{i + 1}<ExternalLink className="h-3 w-3" /></a>)}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => enPost.mutate(tend.id)} disabled={enPost.isPending}><PenLine className="mr-1 h-4 w-4" />{t("tendancesSecteur.enFaireUnPost")}</Button>
              <Button size="sm" variant="outline" onClick={() => statut.mutate({ id: tend.id, s: "garde" })} disabled={tend.statut === "garde"}><Pin className="mr-1 h-4 w-4" />{tend.statut === "garde" ? t("tendancesSecteur.garde") : t("tendancesSecteur.garder")}</Button>
              <Button size="sm" variant="ghost" onClick={() => statut.mutate({ id: tend.id, s: "ecarte" })}><X className="mr-1 h-4 w-4" />{t("tendancesSecteur.ecarter")}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3 : Brancher dans l'onglet Veille et le tableau de bord**

`client/src/pages/veille.tsx`, dans le `return` de `VeilleProjet`, en premier enfant du conteneur : `<TendancesSecteur projectId={projectId} />` (import `import { TendancesSecteur } from "@/components/tendances-secteur";`).

`client/src/pages/dashboard.tsx` : le lundi seulement, une carte pour le projet actif. Repérer la variable du projet actif déjà utilisée par la page (ex. `activeProjectId`), puis dans la colonne principale :

```tsx
{new Date().getDay() === 1 && activeProjectId != null && <TendancesSecteur projectId={activeProjectId} compact />}
```

(Si la page n'a pas de projet actif nommé ainsi, utiliser celui du hook `useActiveProject` existant ; vérifier par `grep -n "activeProject" client/src/pages/dashboard.tsx`.)

- [ ] **Step 4 : Page d'administration `client/src/pages/admin-profils-veille.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Compte = { id: number; plateforme: string; compte: string; url: string; statut: string; origine: string };
type Profil = { id: number; nom: string; description: string; statut: string; origine: string; comptes: Compte[]; nbProjets: number; nbEnAttente: number; depenseMois: number; passages: Array<{ id: number; jour: string; statut: string; postsNouveaux: number; echecs: number; erreur: string | null }> };
const CLE = ["/api/admin/profils-veille"];

export default function AdminProfilsVeille({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const estOwner = (user as any)?.role === "owner";
  const { data } = useQuery<{ profils: Profil[]; plafond: number }>({ queryKey: CLE, enabled: estOwner });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: CLE });
  const [nom, setNom] = useState(""); const [description, setDescription] = useState("");
  const creer = useMutation({ mutationFn: () => apiRequest("POST", "/api/admin/profils-veille", { nom, description }), onSuccess: () => { setNom(""); setDescription(""); rafraichir(); } });
  const majProfil = useMutation({ mutationFn: ({ id, statut }: { id: number; statut: string }) => apiRequest("PATCH", `/api/admin/profils-veille/${id}`, { statut }), onSuccess: rafraichir });
  const majCompte = useMutation({ mutationFn: ({ id, statut }: { id: number; statut: string }) => apiRequest("PATCH", `/api/admin/profils-veille/comptes/${id}`, { statut }), onSuccess: rafraichir });
  const lancer = useMutation({ mutationFn: ({ id, etape }: { id: number; etape: string }) => apiRequest("POST", `/api/admin/profils-veille/${id}/lancer`, { etape }, { timeoutMs: 600_000 }), onSuccess: rafraichir });

  if (!estOwner) return <div className="p-8">{t("adminProfils.interdit")}</div>;
  return (
    <div className="flex h-screen">
      <Sidebar onSearchClick={onSearchClick} />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <h1 className="text-2xl font-semibold">{t("adminProfils.titre")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("adminProfils.nouveau")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t("adminProfils.nom")} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("adminProfils.description")} />
            <Button onClick={() => creer.mutate()} disabled={nom.trim().length < 2}>{t("adminProfils.creer")}</Button>
          </CardContent>
        </Card>
        {data?.profils.map((p) => <CarteProfil key={p.id} p={p} plafond={data.plafond} onStatut={(statut) => majProfil.mutate({ id: p.id, statut })} onCompte={(id, statut) => majCompte.mutate({ id, statut })} onLancer={(etape) => lancer.mutate({ id: p.id, etape })} onRafraichir={rafraichir} />)}
        <Etiquetage />
      </main>
    </div>
  );
}

function CarteProfil({ p, plafond, onStatut, onCompte, onLancer, onRafraichir }: { p: Profil; plafond: number; onStatut: (s: string) => void; onCompte: (id: number, s: string) => void; onLancer: (e: string) => void; onRafraichir: () => void }) {
  const { t } = useTranslation();
  const [saisie, setSaisie] = useState("");
  const ajouter = useMutation({ mutationFn: () => apiRequest("POST", `/api/admin/profils-veille/${p.id}/comptes`, { plateforme: "instagram", saisie, statut: "suivi" }), onSuccess: () => { setSaisie(""); onRafraichir(); } });
  const { data: tend } = useQuery<{ tendances: Array<{ id: number; plateforme: string; typeMedia: string; structure: string; lift: number; pourquoi: string; ecarteParJeanne: boolean }> }>({ queryKey: [`/api/admin/profils-veille/${p.id}/tendances`] });
  const diffuser = useMutation({ mutationFn: ({ id, ecarte }: { id: number; ecarte: boolean }) => apiRequest("PATCH", `/api/admin/profils-veille/tendances/${id}`, { ecarteParJeanne: ecarte }), onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/admin/profils-veille/${p.id}/tendances`] }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>{p.nom} · {t(`adminProfils.statut.${p.statut}`)}</span>
          <span className="text-sm font-normal">{t("adminProfils.depense", { eur: p.depenseMois.toFixed(2), plafond })}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{p.description}</p>
        <p>{t("adminProfils.projets", { n: p.nbProjets })}{p.nbEnAttente ? ` · ${t("adminProfils.enAttente", { n: p.nbEnAttente })}` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {p.statut !== "actif" && <Button size="sm" onClick={() => onStatut("actif")}>{t("adminProfils.activer")}</Button>}
          {p.statut === "actif" && <Button size="sm" variant="outline" onClick={() => onStatut("en_pause")}>{t("adminProfils.pause")}</Button>}
          <Button size="sm" variant="ghost" onClick={() => onStatut("archive")}>{t("adminProfils.archiver")}</Button>
          <Button size="sm" variant="outline" onClick={() => onLancer("collecte")}>{t("adminProfils.lancerCollecte")}</Button>
          <Button size="sm" variant="outline" onClick={() => onLancer("analyse")}>{t("adminProfils.lancerAnalyse")}</Button>
        </div>
        <div>
          <div className="font-medium">{t("adminProfils.comptes")}</div>
          <p className="text-xs text-muted-foreground">{t("adminProfils.plafondComptes")}</p>
          <ul className="mt-1 space-y-1">
            {p.comptes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <a href={c.url} target="_blank" rel="noreferrer" className="underline">@{c.compte}</a>
                <span className="text-xs text-muted-foreground">{t(`adminProfils.compteStatut.${c.statut}`)} · {t(`adminProfils.origine.${c.origine}`)}</span>
                {c.statut !== "suivi" && <Button size="sm" variant="outline" onClick={() => onCompte(c.id, "suivi")}>{t("adminProfils.suivre")}</Button>}
                {c.statut !== "ecarte" && <Button size="sm" variant="ghost" onClick={() => onCompte(c.id, "ecarte")}>{t("adminProfils.ecarter")}</Button>}
              </li>
            ))}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) ajouter.mutate(); }}>
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="@compte" className="max-w-xs" />
            <Button size="sm" type="submit">{t("adminProfils.ajouterCompte")}</Button>
          </form>
        </div>
        <div>
          <div className="font-medium">{t("adminProfils.passages")}</div>
          <ul className="text-xs">{p.passages.map((x) => <li key={x.id}>{x.jour} · {x.statut} · +{x.postsNouveaux} · {x.echecs}{x.erreur ? ` · ${x.erreur}` : ""}</li>)}</ul>
        </div>
        <div>
          <div className="font-medium">{t("adminProfils.tendances")}</div>
          <ul className="space-y-1">
            {tend?.tendances.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <span>{x.plateforme} · {x.typeMedia} {x.structure} · ×{x.lift.toFixed(1)}</span>
                <Button size="sm" variant="ghost" onClick={() => diffuser.mutate({ id: x.id, ecarte: !x.ecarteParJeanne })}>{x.ecarteParJeanne ? t("adminProfils.diffuser") : t("adminProfils.ecarterTendance")}</Button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Etiquetage() {
  const { t } = useTranslation();
  const { data } = useQuery<{ posts: Array<{ id: number; typeMedia: string; legende: string; url: string }>; structures: string[]; accroches: string[] }>({ queryKey: ["/api/admin/profils-veille/etiquetage"] });
  const [choix, setChoix] = useState<Record<number, { structure?: string; accroche?: string }>>({});
  const enregistrer = useMutation({
    mutationFn: (postId: number) => apiRequest("POST", "/api/admin/profils-veille/etiquettes", { postId, ...choix[postId] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/profils-veille/etiquetage"] }),
  });
  if (!data || data.posts.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("adminProfils.etiquetage")}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("adminProfils.etiquetageAide")}</p>
        {data.posts.map((p) => (
          <div key={p.id} className="rounded border p-3 space-y-2">
            <a href={p.url} target="_blank" rel="noreferrer" className="text-xs underline">{p.typeMedia}</a>
            <p>{p.legende}</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label={t("adminProfils.structure")} value={choix[p.id]?.structure ?? ""} onChange={(e) => setChoix({ ...choix, [p.id]: { ...choix[p.id], structure: e.target.value } })}>
                <option value="">{t("adminProfils.structure")}</option>
                {data.structures.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label={t("adminProfils.accroche")} value={choix[p.id]?.accroche ?? ""} onChange={(e) => setChoix({ ...choix, [p.id]: { ...choix[p.id], accroche: e.target.value } })}>
                <option value="">{t("adminProfils.accroche")}</option>
                {data.accroches.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <Button size="sm" disabled={!choix[p.id]?.structure || !choix[p.id]?.accroche} onClick={() => enregistrer.mutate(p.id)}>{t("adminProfils.enregistrer")}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

Note jsx-guard : le texte `"@compte"` du placeholder et les valeurs techniques (`{s}`, `{a}`, plateforme) ne sont pas de la langue ; si le cliquet les signale, remplacer le placeholder par `t("tendancesSecteur.suggererPlaceholder")`.

- [ ] **Step 5 : Route et lien**

`client/src/App.tsx` : `import AdminProfilsVeille from "@/pages/admin-profils-veille";` puis, à côté de `/savoir` :

```tsx
 <Route path="/admin/profils-veille">
 {() => <AdminProfilsVeille onSearchClick={openSearch} />}
 </Route>
```

`client/src/components/sidebar.tsx` : à l'endroit où apparaît le lien « Savoir » réservé au rôle owner, ajouter un lien `/admin/profils-veille` libellé `t("adminProfils.titre")` sous la même condition (`grep -n "savoir" client/src/components/sidebar.tsx`).

- [ ] **Step 6 : Cliquets, types, build**

Run : `npx vitest run client/ && npx tsc --noEmit && npm run build`
Expected : vert (jsx-guard, clés présentes en FR et EN), 0 erreur, build OK.

- [ ] **Step 7 : Vérifier dans le navigateur**

Lancer l'app en dev, se connecter avec le compte owner de dev, ouvrir `/admin/profils-veille` : créer un profil « Test », ajouter 2 comptes Instagram publics en suivi, activer. Ouvrir un projet → onglet Veille : la carte « Ce qui marche dans ton secteur » s'affiche (sans tendance : « Pas encore de profil » ou « Rien de net cette semaine »). Aucune erreur dans la console.

- [ ] **Step 8 : Commit**

```bash
git add client/
git commit -m "feat(profils-veille): « Ce qui marche dans ton secteur » (onglet Veille, carte du lundi) et administration des profils"
```

---

### Task 13 : Banc d'évaluation du classement

**Files :**
- Create : `scripts/evaluer-classement.ts`
- Modify : `server/services/profils-veille/stockage.ts`

**Interfaces :**
- Consumes : `depsAnalyse.classer` (T9), table `profil_etiquettes` (T2).
- Produces : `stockageProfils.postsEtiquetes(): Promise<Array<{ id: number; typeMedia: TypeMedia; legende: string | null; structure: string; accroche: string }>>` ; le script affiche le taux d'accord et sort en code 1 sous 75 %.

- [ ] **Step 1 : Requête**

```ts
  async postsEtiquetes() {
    return db.select({ id: profilPosts.id, typeMedia: profilPosts.typeMedia, legende: profilPosts.legende, structure: profilEtiquettes.structure, accroche: profilEtiquettes.accroche })
      .from(profilEtiquettes).innerJoin(profilPosts, eq(profilPosts.id, profilEtiquettes.postId)) as any;
  },
```

- [ ] **Step 2 : `scripts/evaluer-classement.ts`**

```ts
// Banc d'évaluation du classement des formats : compare Naya aux étiquettes posées par Jeanne.
// Usage : npx tsx scripts/evaluer-classement.ts — coûte quelques centimes (modèle rapide).
// Seuil : 75 % d'accord sur la structure avant d'ouvrir le lot 1 à toutes (PROFILS_VEILLE_POUR_TOUS=true).
import { stockageProfils } from "../server/services/profils-veille/stockage";
import { depsAnalyse } from "../server/services/profils-veille/deps";

const SEUIL = 0.75;
const posts = await stockageProfils.postsEtiquetes();
if (posts.length < 40) { console.error(`Seulement ${posts.length} posts étiquetés : il en faut 40.`); process.exit(1); }
let accordStructure = 0, accordAccroche = 0;
const desaccords: string[] = [];
for (let i = 0; i < posts.length; i += 20) {
  const lot = posts.slice(i, i + 20);
  const { resultats } = await depsAnalyse.classer(lot.map((p) => ({ id: p.id, typeMedia: p.typeMedia, legende: p.legende })));
  for (const p of lot) {
    const r = resultats.find((x) => x.id === p.id);
    if (r?.structure === p.structure) accordStructure++; else desaccords.push(`#${p.id} toi=${p.structure} naya=${r?.structure ?? "—"} « ${(p.legende ?? "").slice(0, 80)} »`);
    if (r?.accroche === p.accroche) accordAccroche++;
  }
}
const taux = accordStructure / posts.length;
console.log(`Structure : ${(taux * 100).toFixed(0)} % d'accord (${accordStructure}/${posts.length})`);
console.log(`Accroche : ${((accordAccroche / posts.length) * 100).toFixed(0)} % d'accord`);
if (desaccords.length) console.log("Désaccords :\n" + desaccords.join("\n"));
process.exit(taux >= SEUIL ? 0 : 1);
```

- [ ] **Step 3 : Types**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 4 : Commit**

```bash
git add scripts/evaluer-classement.ts server/services/profils-veille/stockage.ts
git commit -m "feat(profils-veille): banc d'évaluation du classement (40 posts étiquetés, seuil 75 %)"
```

Exécution réelle (après que Jeanne a étiqueté 40 posts dans l'admin) : `npx tsx scripts/evaluer-classement.ts`. Sous 75 % : relire les désaccords, ajuster `SYSTEME_CLASSEMENT` (Task 9) ou le vocabulaire (Task 1, avec tests), relancer. Ne pas poser `PROFILS_VEILLE_POUR_TOUS=true` avant d'avoir passé le seuil.

---

### Task 14 : Vérification finale

- [ ] **Step 1 : Tout est vert**

Run : `npx tsc --noEmit && npx vitest run && npm run build`
Expected : 0 erreur, suite verte, build OK.

- [ ] **Step 2 : Essai de bout en bout sur la base de dev (≈ 0,05 €)**

1. Dans l'admin : profil « Test » actif avec 3 à 5 comptes Instagram publics suivis ; rattacher un projet de dev (onglet Veille → choisir « Test »).
2. « Collecter maintenant » → un passage `ok`, des posts dans `profil_posts` (vérifier : `select count(*), count(engagement), count(fort) from profil_posts where profil_id = <id>;`). Un second clic → `{ statut: "deja" }`.
3. « Analyser maintenant » → statut `rien` (peu de données : normal) ou `lot_soumis`. Si `lot_soumis`, attendre la fin du lot (jusqu'à quelques heures) ; le tour suivant passe l'analyse `termine` et écrit les tendances.
4. Vérifier que le coût du mois du profil dans l'admin a bougé et reste très sous 10 €.

- [ ] **Step 3 : Relecture indépendante de la branche** (superpowers:requesting-code-review), en insistant sur la section Review Focus.

- [ ] **Step 4 : Ce qui reste à Jeanne (hors code)**

- Créer ses premiers profils et valider leurs 15 comptes Instagram.
- Étiqueter 40 posts, lancer le banc, puis poser `PROFILS_VEILLE_POUR_TOUS=true` sur Railway.
- Appliquer la migration 0031 en production elle-même (sauvegarde Neon avant, sortie de la commande sous les yeux).
- Lot 2 (TikTok) et lot 3 (LinkedIn) : nouveaux plans, une fois le coût réel du lot 1 mesuré sur un mois.

---

## Écarts assumés par rapport à la spec (lot 1)

- **Pas de table `profil_depenses`** : la dépense du mois d'un profil est la somme de `profil_passages.cout_eur` et `profil_analyses.cout_eur` du mois (`stockageProfils.depenseDuMois`). Même plafond, une table de moins.
- **Libellés « autre » récurrents proposés à Jeanne** (spec §3, étape 1) : les libellés sont enregistrés (`profil_posts.format.autreLibelle`) mais leur proposition dans l'admin est reportée au lot 2.
- **Identifiant de tendance renvoyé par la rédaction** : seulement dans l'atelier (`TENDANCE: <id>`). Les autres générateurs reçoivent le bloc mais ne relient pas le post à la tendance.
- **Ouverture progressive** : la diffusion aux utilisatrices passe par `PROFILS_VEILLE_POUR_TOUS`, posée après le banc d'évaluation (la spec demandait le banc « avant d'ouvrir le lot 1 aux utilisatrices » sans dire comment).
- **Avant ouverture (`PROFILS_VEILLE_POUR_TOUS`)** : langue du compte dans le tri et la rédaction, et libellés traduits côté client (formats, structures). Le lot 1 est en français seulement.
- **Ligne « Format inspiré de : … » dans l'atelier** : non construite. Le post est relié à sa tendance (`content.tendance_id`) mais l'atelier ne l'affiche pas encore.
- **`profil_comptes.suggere_par` sans `ON DELETE SET NULL`** : à corriger dans une prochaine migration (bloque la suppression d'une utilisatrice ayant suggéré un compte). Voir `MIGRATIONS.md`, section `0031`.
