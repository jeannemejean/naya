// Vérification des deux couples prompt/parseur créés par le chantier
// `2026-10-01-naya-saisie-manuelle`, contre le VRAI modèle.
//
// Ce script N'ÉCRIT RIEN EN BASE. Il n'appelle que le modèle Anthropic, directement via
// `AnthropicProvider` (server/services/ai/providers/anthropic.ts) — PAS via
// `callClaude`/`callClaudeDetailed` de `server/services/claude.ts`, qui déclenchent deux
// écritures réelles en passant (`recordSpend` dans `server/services/usage.ts`,
// `logInvocation` dans `server/services/ai/invocation-log.ts`). Utiliser l'adaptateur
// aurait donc violé la contrainte même en ne « lisant » jamais la base.
//
// `PROMPT_COLLISION_LOT` et `parseVerdictLot` ne vivent que dans
// `server/services/brand-links/collision.ts`, qui importe `../../db` en tête de
// fichier. Cet import crée un `pg.Pool` (paresseux : aucune connexion TCP tant
// qu'aucune requête n'est émise — voir `server/db.ts:48`), mais n'exécute AUCUNE
// requête. Ce script n'appelle jamais `detecterCollision`, `detecterCollisionLot`, ni
// aucune fonction de ce fichier qui touche `content`/`projects`/`projectLinks` : seuls
// la constante de prompt et le parseur pur sont utilisés.
//
// Exécution : npx tsx scripts/verifier-import.ts
import "dotenv/config";
import { AnthropicProvider } from "../server/services/ai/providers/anthropic";
import { route } from "../server/services/ai/router";
import {
  PROMPT_EXTRACTION, construireMessageExtraction, parsePostsExtraits,
  resoudreDate, mesurerCouverture, type PostExtrait,
} from "../server/services/content-import/parse";
import { PROMPT_COLLISION_LOT, parseVerdictLot } from "../server/services/brand-links/collision";

const provider = new AnthropicProvider();
const MODELE_SMART = route("strategic_reasoning").model;   // CLAUDE_MODELS.smart
const MODELE_FAST = route("fast_generation").model;        // CLAUDE_MODELS.fast — "classification" route au même modèle

function ligne(titre: string) {
  console.log(`\n${"=".repeat(10)} ${titre} ${"=".repeat(10)}\n`);
}

// Formate un Date en AAAA-MM-JJ à partir de ses composants LOCAUX, jamais via
// `toISOString()` : le commentaire de `resoudreDate` (parse.ts) prouve qu'à Paris
// (UTC+2) `toISOString()` recule la date d'un jour pour un minuit local. Un script de
// vérification qui tomberait dans ce piège en lisant ses propres logs conclurait à une
// date « fausse » là où `resoudreDate` a rendu la bonne.
function formaterLocal(d: Date): string {
  const a = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${a}-${m}-${j}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION 1 — extraction d'un calendrier collé
// ─────────────────────────────────────────────────────────────────────────────────────

const AUJOURDHUI = new Date(2026, 9, 2); // vendredi 2 octobre 2026 — ancre fixe, reproductible

// Calendrier de contenu réaliste. Dix posts, dont :
// - des jours précis résolubles (6, 8, 16, 21, 23, 27 octobre) ;
// - une mention de période NON résoluble en un jour ("Semaine du 12") ;
// - plusieurs posts sans aucune date ;
// - une plateforme explicite (LinkedIn), une autre (TikTok), une autre (newsletter), et
//   plusieurs posts qui n'en nomment aucune ;
// - un pilier éditorial explicite ("Preuve sociale", "Expertise", "Transparence"), et
//   plusieurs posts qui n'en nomment aucun.
const TEXTE_CALENDRIER = `Calendrier de contenu — octobre

1. Mardi 6 octobre : post LinkedIn sur le pilier "Preuve sociale" — on partage le témoignage de Claire, cliente SaaS, qui a doublé son taux de réponse grâce à notre méthode de prospection. Objectif : générer des leads qualifiés.

2. Jeudi 8 octobre : carousel Instagram — "5 erreurs qui tuent ton taux d'ouverture email". Pilier : Expertise.

3. Semaine du 12 : série de posts sur le lancement de la nouvelle offre d'accompagnement premium. On n'a pas encore fixé les jours exacts, à répartir sur la semaine selon l'actu.

4. Vendredi 16 octobre : vidéo courte pour TikTok où Jeanne répond à la question "Pourquoi la prospection LinkedIn marche encore en 2026 ?"

5. Un post sur la refonte de notre process d'onboarding client — pas encore de date fixée, à caler selon l'avancement du design.

6. Mercredi 21 octobre : newsletter mensuelle récapitulant les résultats du mois pour nos clients, avec un focus sur le pilier "Transparence".

7. Idée en vrac : interview croisée avec un client sur sa transformation digitale, objectif = asseoir notre crédibilité auprès de prospects hésitants.

8. Vendredi 23 octobre : post sur notre méthode de qualification des leads, pour montrer notre expertise technique.

9. Un contenu sur les coulisses de l'agence — une journée type de l'équipe, pour humaniser la marque.

10. Mardi 27 octobre : article détaillé sur l'évolution des algorithmes LinkedIn en 2026.`;

async function verifierExtraction() {
  ligne("VÉRIFICATION 1 — EXTRACTION");

  console.log(`Modèle appelé : ${MODELE_SMART} (taskKind strategic_reasoning dans importerTexte)`);
  console.log(`Texte collé (${TEXTE_CALENDRIER.length} caractères, 10 posts attendus) :\n`);
  console.log(TEXTE_CALENDRIER);

  const message = construireMessageExtraction(TEXTE_CALENDRIER, AUJOURDHUI);

  const { text: raw, stopReason } = await provider.generate(
    { system: PROMPT_EXTRACTION, messages: [{ role: "user", content: message }], maxTokens: 16000 },
    MODELE_SMART,
  );

  ligne("RÉPONSE BRUTE DU MODÈLE (extraction)");
  console.log(raw);
  console.log(`\n[stopReason = ${stopReason ?? "(absent)"}]`);

  const posts = parsePostsExtraits(raw);

  ligne("RÉSULTAT DE parsePostsExtraits");
  if (posts === null) {
    console.log("null — réponse jugée ILLISIBLE par le parseur. C'est une panne, pas un résultat.");
    return;
  }
  console.log(`${posts.length} post(s) retenu(s) sur 10 attendus dans le texte.\n`);

  posts.forEach((p, i) => {
    const d = resoudreDate(p.date, AUJOURDHUI);
    console.log(`--- Post ${i + 1} ---`);
    console.log(`titre       : ${JSON.stringify(p.titre)}`);
    console.log(`corps       : ${JSON.stringify(p.corps.slice(0, 80))}${p.corps.length > 80 ? "…" : ""}`);
    console.log(`plateforme  : ${JSON.stringify(p.plateforme)}`);
    console.log(`type        : ${JSON.stringify(p.type)}`);
    console.log(`pilier      : ${JSON.stringify(p.pilier)}`);
    console.log(`objectif    : ${JSON.stringify(p.objectif)}`);
    console.log(`date (brute): ${JSON.stringify(p.date)}  →  resoudreDate : ${d ? formaterLocal(d) : "null"}`);
    console.log();
  });

  // Vérification explicite : un champ textuel "null" (la CHAÎNE) serait une valeur
  // réelle pour parsePostsExtraits — il NE la convertit PAS en null JS. Si le modèle a
  // recopié ce mot, ce serait visible ici.
  const champsSuspects: string[] = [];
  for (const [i, p] of posts.entries()) {
    (["plateforme", "type", "pilier", "objectif", "date"] as const).forEach((champ) => {
      if (p[champ] === "null" || p[champ] === "Null" || p[champ] === "NULL") {
        champsSuspects.push(`post ${i + 1}.${champ} = la CHAÎNE ${JSON.stringify(p[champ])}`);
      }
    });
  }
  ligne("CHAÎNE \"null\" LITTÉRALE ?");
  if (champsSuspects.length === 0) {
    console.log("Aucune. Les champs absents reviennent bien en `null` JSON (ou sont omis), jamais en chaîne \"null\".");
  } else {
    console.log("TROUVÉ — ceci est le défaut exact décrit dans le brief :");
    champsSuspects.forEach((s) => console.log(`  - ${s}`));
  }

  ligne("« SEMAINE DU 12 » A-T-ELLE PRODUIT UNE DATE ?");
  // On ne cherche PAS la phrase littérale "semaine du 12" dans le corps : le prompt
  // demande d'extraire, et le modèle peut légitimement laisser tomber le préfixe de
  // date du texte source (c'est lui qui porte l'information non résoluble, pas le
  // contenu du post) — constaté : le corps rendu commence directement par "série de
  // posts sur le lancement...", sans "Semaine du 12 :". On identifie donc le post par
  // un marqueur de CONTENU unique à cette entrée du calendrier ("accompagnement
  // premium" n'apparaît dans aucun autre post du texte).
  const postSemaine = posts.find((p) => /accompagnement premium/i.test(p.corps) || /accompagnement premium/i.test(p.titre));
  if (!postSemaine) {
    console.log("Aucun post retrouvé ne porte sur l'offre d'accompagnement premium (le post \"Semaine du 12\" du texte source) — voir la liste ci-dessus : ce post a peut-être été omis par l'extraction.");
  } else {
    const d = resoudreDate(postSemaine.date, AUJOURDHUI);
    console.log(`Post trouvé (titre : ${JSON.stringify(postSemaine.titre)}). Champ date brut = ${JSON.stringify(postSemaine.date)} → resoudreDate = ${d ? formaterLocal(d) : "null"}.`);
    console.log(d === null ? "CONFORME : aucune date n'est posée sur une période non résoluble." : "NON CONFORME : une date a été posée sur une période qui ne désigne pas un jour précis.");
  }

  const couverture = mesurerCouverture(posts, TEXTE_CALENDRIER);
  ligne("COUVERTURE");
  console.log(`mesurerCouverture = ${couverture.toFixed(3)} (texte extrait / texte collé).`);
  console.log(couverture > 1.2
    ? "Nettement supérieure à 1 : le modèle a probablement RÉÉCRIT au lieu d'extraire."
    : "Dans une plage normale pour une extraction fidèle (pas de réécriture massive détectée).");

  console.log(`\nBilan nombre de posts : ${posts.length} trouvés / 10 attendus dans le texte.`);
  if (posts.length !== 10) {
    console.log("ÉCART — voir la liste ci-dessus pour identifier quel(s) post(s) manque(nt) et pourquoi (fusion de deux entrées, entrée jugée non-post, etc).");
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION 2 — verdict de collision en lot
// ─────────────────────────────────────────────────────────────────────────────────────

// Forme EXACTE construite par `detecterCollisionLot` : deux listes étiquetées "Nouveau
// contenu : " / "Déjà programmé : ", avec de VRAIS identifiants numériques des deux
// côtés (reproduit à la main ici, pas de DB touchée).
//
// Nouveaux contenus 501 et 502. Voisins déjà programmés 301, 302, 303.
// - 501 (lancement de l'offre premium côté agence) recoupe VRAIMENT l'angle de 301
//   (même offre, même angle, côté marque personnelle) : collision attendue.
// - 502 (recrutement d'une alternante) ne recoupe RIEN de ce qui est déjà programmé :
//   aucune collision attendue pour ce couple.
const NOUVEAUX_CONTENUS = [
  { id: 501, titre: "On ouvre les portes de l'accompagnement premium", corps: "À partir du 12, on ouvre 5 places pour notre accompagnement premium : 3 mois, suivi individuel, méthode de prospection LinkedIn complète. On ne le refera pas avant janvier." },
  { id: 502, titre: "On recrute une alternante", corps: "L'agence cherche une alternante en communication digitale pour la rentrée. Profil junior, envie d'apprendre, contrat de 12 à 24 mois. Candidatures ouvertes jusqu'à fin octobre." },
];
const VOISINS_PROGRAMMES = [
  { id: 301, titre: "La méthode premium arrive", corps: "Dès le 12 octobre, 5 places s'ouvrent pour un accompagnement individuel de 3 mois sur la prospection LinkedIn. On ne relance pas cette offre avant l'année prochaine." },
  { id: 302, titre: "Pourquoi on a changé notre logo", corps: "Petit retour sur la refonte de notre identité visuelle cet été, et pourquoi ce choix de couleurs." },
  { id: 303, titre: "3 conseils pour relancer un prospect froid", corps: "Un prospect qui ne répond plus depuis 3 semaines n'est pas forcément perdu. Voici comment le relancer sans être lourd." },
];

function construirePromptLot() {
  const listeNouveaux = NOUVEAUX_CONTENUS
    .map((p) => `Nouveau contenu : ${p.id}\nTitre : ${p.titre}\n${p.corps}`)
    .join("\n\n");
  const listeVoisins = VOISINS_PROGRAMMES
    .map((v) => `Déjà programmé : ${v.id}\nTitre : ${v.titre}\n${v.corps}`)
    .join("\n\n");
  return `NOUVEAUX CONTENUS\n${listeNouveaux}\n\nDÉJÀ PROGRAMMÉ SUR LA MARQUE LIÉE\n${listeVoisins}`;
}

async function verifierCollisionLot() {
  ligne("VÉRIFICATION 2 — COLLISION DE LOT");

  console.log(`Modèle appelé : ${MODELE_FAST} (taskKind classification dans detecterCollisionLot)`);
  const messageUtilisateur = construirePromptLot();
  console.log("\nMessage utilisateur envoyé :\n");
  console.log(messageUtilisateur);
  console.log(`\nCollision attendue : 501 ↔ 301 (même offre, même angle). Aucune collision attendue pour 502.`);

  const { text: raw, stopReason } = await provider.generate(
    { system: PROMPT_COLLISION_LOT, messages: [{ role: "user", content: messageUtilisateur }], maxTokens: 2000 },
    MODELE_FAST,
  );

  ligne("RÉPONSE BRUTE DU MODÈLE (collision lot)");
  console.log(raw);
  console.log(`\n[stopReason = ${stopReason ?? "(absent)"}]`);

  const idsNouveaux = new Set(NOUVEAUX_CONTENUS.map((p) => p.id));
  const idsVoisins = new Set(VOISINS_PROGRAMMES.map((v) => v.id));
  const couples = parseVerdictLot(raw, idsNouveaux, idsVoisins);

  ligne("RÉSULTAT DE parseVerdictLot");
  console.log(`idsNouveaux passés au parseur : ${[...idsNouveaux].join(", ")}`);
  console.log(`idsVoisins passés au parseur  : ${[...idsVoisins].join(", ")}`);
  console.log(`${couples.length} couple(s) retenu(s) :`);
  couples.forEach((c) => console.log(`  - nouveauId=${c.nouveauId} ↔ contenuId=${c.contenuId} — ${JSON.stringify(c.pourquoi)}`));

  const a501_301 = couples.some((c) => c.nouveauId === 501 && c.contenuId === 301);
  const faussePositive502 = couples.some((c) => c.nouveauId === 502);

  ligne("VERDICT");
  console.log(a501_301
    ? "CONFORME : la collision réelle 501 ↔ 301 a été trouvée ET acceptée par le parseur."
    : "ÉCART : la collision attendue 501 ↔ 301 n'apparaît PAS dans le résultat parsé — regarder la réponse brute ci-dessus pour savoir si le modèle l'a manquée, ou si le parseur l'a rejetée malgré une réponse correcte.");
  console.log(faussePositive502
    ? "ÉCART : une collision a été rapportée pour 502, qui ne recoupe pourtant rien."
    : "CONFORME : aucune collision rapportée pour 502 (attendu, puisqu'il ne recoupe rien).");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY absente de l'environnement. Rien n'a été appelé.");
    process.exit(1);
  }
  console.log("Script de vérification — AUCUNE écriture en base. DATABASE_URL (si présente) n'est lue par aucun code ici exécuté.");
  await verifierExtraction();
  await verifierCollisionLot();
  ligne("FIN");
}

main().catch((err) => {
  console.error("Échec du script :", err);
  process.exit(1);
});
