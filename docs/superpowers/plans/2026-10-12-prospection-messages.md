# Messages de prospection qui sonnent juste — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer la rédaction de prospection actuelle par une rédaction « stratège puis rédacteur » : preuves réelles, doctrine unique, structures de séquence fiables, brief par prospect, contrôle qualité bloquant, apprentissage par les corrections.

**Architecture :**
- La logique décisionnelle vit dans des modules purs et testés sous `server/services/prospection/` : doctrine, qualité, structures, brief, exemples, preuves.
- Les appels IA restent dans des fonctions minces qui consomment ces modules.
- Tout passe par `buildNayaContext`, dans un nouveau mode `tiers`.

**Tech Stack :** Express + TypeScript, Drizzle (PostgreSQL Neon), vitest, React + react-query + shadcn/ui, react-i18next.

**Spec :** `docs/superpowers/specs/2026-10-12-prospection-messages-design.md`

## Global Constraints

- Tout appel IA passe par `buildNayaContext` (CLAUDE.md). La rédaction de prospection utilise `{ destinataire: 'tiers' }`.
- Migrations : `npx drizzle-kit generate`, relecture du SQL, `npm run db:migrate` **sur la branche Neon de dev uniquement**. Jamais `drizzle-kit push`. Production : étape manuelle avec Jeanne.
- Aucun `git push` : un push redéploie la production.
- Ne jamais déclencher de génération ni d'envoi réel contre la base de production.
- Aucun tiret long (—, –) dans un message produit.
- `npx tsc --noEmit` doit rester à zéro erreur, et `npm test` doit rester vert.
- Les textes d'interface passent par `t()`, en FR et EN.
- Les modèles : `CLAUDE_MODELS.smart` pour la rédaction et le brief, `CLAUDE_MODELS.fast` pour la relecture et l'extraction des règles.

## Review Focus

1. **Projet sans aucune preuve validée.** Les messages sont rédigés sans preuve et sans en inventer. Aucun lien ne doit apparaître.
2. **Prospect sans déclencheur et sans note.** Aucun message n'est rédigé : état « à compléter », jamais de message creux.
3. **Message édité à la main qui viole une règle.** Il est envoyé quand même, avec un avertissement seulement.
4. **Relecture IA en panne ou au JSON illisible.** Le message n'est pas bloqué par la panne de la relecture.
5. **Séquence ancienne sans `role`, avec des conditions `if_opened`.** Elle continue de fonctionner à l'identique.

---

### Task 1 : schéma, migration, stockage

**Files :**
- Modify : `shared/schema.ts`
  - nouvelles tables `projectProofs`, `prospectionMessageFeedback`, `prospectionLearnedRules` ;
  - nouvelles colonnes `leads.prospectBrief` (jsonb), `campaignSequenceSteps.role` (text, nullable), `leadStepMessages.qualite` (text, défaut `'ok'`), `leadStepMessages.defauts` (jsonb).
- Create : `migrations/0020_*.sql` (généré puis relu).
- Modify : `server/storage.ts`, interface + implémentation :
  - preuves : `getProjectProofs(userId, projectId, status?)`, `createProjectProof`, `updateProjectProof(id, userId, patch)`, `deleteProjectProof(id, userId)` ;
  - feedback : `addMessageFeedback(row)`, `getMessageFeedback(userId, projectId, opts)`, `markFeedbackReplied(userId, leadId)`, `countFeedbackSince(userId, projectId, sinceId)` ;
  - règles apprises : `getLearnedRules(userId, projectId, statut?)`, `createLearnedRule`, `updateLearnedRule(id, userId, patch)`, `deleteLearnedRule`.
  - `upsertLeadStepMessage` accepte aussi `qualite` et `defauts`.
  - `saveSequencePlan` et `replaceSequenceSteps` acceptent `role`.

**Interfaces produites :**
- types `ProjectProof`, `InsertProjectProof`, `ProspectionMessageFeedback`, `ProspectionLearnedRule` (inférés Drizzle).

- [ ] Ajouter les tables et colonnes, toutes nullables ou avec une valeur par défaut.
- [ ] `npx drizzle-kit generate`, relire le SQL : uniquement des `CREATE TABLE` et des `ADD COLUMN`, aucun `DROP`.
- [ ] Vérifier que le `DATABASE_URL` local pointe sur la branche de dev, puis `npm run db:migrate`.
- [ ] Méthodes de stockage. Chaque lecture et écriture filtre sur `userId`.
- [ ] `npx tsc --noEmit`, puis commit.

### Task 2 : doctrine (pure)

**Files :**
- Create : `server/services/prospection/doctrine.ts`
- Test : `server/services/prospection/doctrine.test.ts`

**Interfaces produites :**
```ts
export type RoleTouche = "invitation" | "premier_message" | "email_ouverture" | "relance" | "cloture";
export const LIMITES: Record<RoleTouche, { canal: "linkedin" | "email"; maxCaracteres?: number; motsMin?: number; motsMax?: number }>;
export const OBJET_MOTS = { min: 2, max: 5 };
export const TICS_INTERDITS: string[];          // formules IA et clichés (minuscules, sans accents)
export const MOTIFS_QUESTION_REFLEXION: RegExp[];
export const MOTIFS_TRACKING: RegExp[];
export function blocDoctrine(role: RoleTouche, canal: "linkedin" | "email"): string;
```

- [ ] Tests :
  - `blocDoctrine` contient les 8 règles, la règle du rôle et la limite exacte ;
  - `TICS_INTERDITS` contient « résonner », « regard extérieur », « je me permets » ;
  - les motifs de question attrapent « Comment pensez-vous l'équilibre entre héritage et renouveau ? » mais pas « Je vous l'envoie ? ».
- [ ] Implémenter, faire passer les tests, commit.

### Task 3 : qualité, couche 1 (pure)

**Files :**
- Create : `server/services/prospection/qualite.ts`
- Test : `server/services/prospection/qualite.test.ts`

**Interfaces produites :**
```ts
export type CodeDefaut = "trop_long" | "trop_court" | "objet" | "tic" | "question_reflexion" | "tracking" | "lien_inconnu" | "placeholder" | "tiret" | "genre" | "sans_entreprise" | "flatterie" | "compliment_retourne";
export interface Defaut { code: CodeDefaut; raison: string }
export function controlerMessage(m: { role: RoleTouche; canal: "linkedin"|"email"; body: string; subject?: string|null }, ctx: { entreprise?: string|null; liensAutorises: string[]; premiereTouche: boolean }): Defaut[];
```
Elle réutilise `defautsDuMessage` de `prospection-message-quality.ts` (compliment retourné, formules creuses).

- [ ] Tests négatifs, avec les phrases de la séquence Sneha :
  - « …m'a frappée. Comment pensez-vous l'équilibre entre héritage et renouveau ? Jeanne » → `question_reflexion`, `genre`, `sans_entreprise` (entreprise : « Estée Lauder ») ;
  - « Vous avez jeté un œil à mon message précédent… » → `tracking` ;
  - l'objet « Parfum et désir : ce que la saison dit avant les mots » → `objet` ;
  - « …pour voir si ce que je fais peut résonner avec ce que vous construisez » → `tic` ;
  - « regardez https://x.y » avec `liensAutorises: []` → `lien_inconnu` ;
  - « [prénom] » → `placeholder` ;
  - « — » → `tiret`.
- [ ] Test positif : « Bonjour Sneha, je dirige JMD, on accompagne des maisons de beauté sur leurs contenus. Le lancement de Daisy Wild chez Marc Jacobs m'a donné une idée de série courte pour vous. Je vous l'envoie ? Jeanne », avec entreprise « Marc Jacobs » → aucun défaut.
- [ ] Implémenter, faire passer les tests, commit.

### Task 4 : structures de séquence et plan d'intentions

**Files :**
- Create : `server/services/prospection/sequence-structures.ts`, plus son test.
- Modify : `server/services/sequence-plan.ts` : `generateSequencePlan` remplit les intentions d'une structure.
- Modify : `server/services/sequence-message.ts` : rôle lu sur `step.role`, avec repli sur `roleEtapeLinkedin`.
- Modify : route `POST /api/prospection/campaigns/:id/generate-sequence` (sert aussi de « Reconstruire »), qui sauvegarde `role` ; `PUT .../sequence` accepte `role`.

**Interfaces produites :**
```ts
export type NomStructure = "linkedin_first" | "email_first" | "linkedin_only";
export interface Emplacement { channel: "linkedin"|"email"; delayDays: number; condition: StepCondition; role: RoleTouche }
export function structurePour(channel: string | null | undefined): NomStructure;
export function emplacements(nom: NomStructure): Emplacement[];
export function ajusterDelais(base: Emplacement[], proposes: Array<number|undefined>): Emplacement[]; // ±50 %, ≥1 jour entre deux touches (sauf la 1re)
export function verifierStructure(e: Emplacement[]): string[]; // [] = valide
```

- [ ] Tests :
  - les trois structures passent `verifierStructure` ;
  - aucune utilise `if_opened`, `if_not_opened` ou `if_clicked` ;
  - toute étape LinkedIn qui n'est pas la première a la condition `if_invite_accepted`, ou suit une étape qui l'a sur la même branche ;
  - 5 touches au plus par branche ;
  - `structurePour('email') === 'email_first'`, `'linkedin'` → `linkedin_only`, `'both'` ou null → `linkedin_first` ;
  - `ajusterDelais` borne les délais aberrants.
- [ ] Le prompt de `generateSequencePlan` reçoit `campaignBrief`, `offer`, `targetSector`, `messageAngle` et l'ADN **du projet** (`getBrandDnaForProject`), et ne renvoie que `{ intentions: string[], delais?: number[] }`. Il passe par `callClaudeWithContext` en mode `tiers`.
- [ ] Test de `parseSequencePlan` adapté : JSON partiel → intentions par défaut tirées du rôle.
- [ ] Implémenter, faire passer les tests, commit.

### Task 5 : mode `tiers` de `buildNayaContext`

**Files :**
- Modify : `server/services/naya-context.ts`, avec un 4ᵉ paramètre `options?: { destinataire?: 'utilisatrice' | 'tiers' }`.
- Modify : `server/services/claude.ts`, `callClaudeWithContext` accepte `destinataire`. En mode `tiers`, le system prompt remplace `NAYA_SYSTEM_VOICE` par `VOIX_TIERS(prenom)`.
- Test : `server/services/naya-context-tiers.test.ts` (storage mocké, comme les tests existants).

**Contenu du mode `tiers` :**
- Gardé : l'identité business (ADN projet), le projet (nom, positionnement), la mémoire pertinente avec le fil `savoir` seulement et un plafond, la langue.
- Retiré : les objectifs et l'« Instruction absolue », les jalons, l'archétype, l'énergie, les behavior patterns, la mémoire récente, la revue du jour.

- [ ] Test : en mode `tiers`, le contexte ne contient pas « Instruction absolue », « Niveau d'énergie » ni « La revue du jour », mais contient « Identité business ».
- [ ] Test de non-régression : le mode par défaut contient toujours « Niveau d'énergie ».
- [ ] Implémenter, faire passer les tests, commit.

### Task 6 : bibliothèque de preuves (serveur)

**Files :**
- Create : `server/services/prospection/preuves.ts` (pur), plus son test.
- Create : `server/services/prospection/preuves-suggestion.ts` (IA).
- Create : `server/routes-preuves.ts`, enregistré depuis `server/routes.ts` comme `routes-programmation.ts`.
- Test : `server/routes-preuves.test.ts`.

**Interfaces produites :**
```ts
export function texteDePreuve(p: ProjectProof): string;   // respecte citable ; jamais le nom si citable=false
export function liensDePreuve(p: ProjectProof | null): string[];
export function dedoublonnerPropositions(existantes: ProjectProof[], nouvelles: Array<Partial<ProjectProof>>): Array<Partial<ProjectProof>>;
export async function suggererPreuves(userId: string, projectId: number): Promise<{ creees: number; sourcesEchouees: string[] }>;
```

**Routes :**
- `GET /api/projects/:id/proofs`
- `POST /api/projects/:id/proofs`
- `PATCH /api/projects/:id/proofs/:proofId`
- `DELETE /api/projects/:id/proofs/:proofId`
- `POST /api/projects/:id/proofs/suggest`

Toutes vérifient la propriété du projet (404 sinon) et valident les champs : longueurs plafonnées, `status` et `source` parmi les valeurs admises, `url` en http(s) uniquement.

**Sources de suggestion :**
- le site : `brandDna.website` ou le champ site du projet, via `scrapeAsMarkdown` ;
- les 30 derniers posts publiés du projet ;
- les entrées mémoire `savoir` du projet.

Le modèle extrait des preuves **explicitement présentes dans le texte**, sans rien inventer : statut `proposed`, source renseignée. Si toutes les sources échouent : 502 `sources_indisponibles`.

- [ ] Tests purs :
  - `texteDePreuve` avec `citable=false` ne contient pas `clientLabel` mais un type de client générique ;
  - `liensDePreuve` sur `null` renvoie `[]` ;
  - le dédoublonnage ignore la casse et les accents.
- [ ] Tests de routes : 404 pour le projet d'un autre utilisateur, 400 sur un `status` inconnu, une URL `javascript:` refusée.
- [ ] Implémenter, faire passer les tests, commit.

### Task 7 : brief par prospect

**Files :**
- Create : `server/services/prospection/brief.ts`, plus son test.
- Modify : `server/services/prospection-pipeline.ts` :
  - `generateAudit` passe à `callClaudeWithContext` en mode `tiers` ;
  - après la qualification, appel à `genererBrief` puis écriture de `prospectBrief`.

**Interfaces produites :**
```ts
export interface BriefProspect {
  declencheur: { fait: string; source: string; url?: string; date?: string } | null;
  preuveId: number | null;
  raison: string;
  proposition: { type: "preuve" | "idee" | "echange"; contenu: string };
  angles: string[];
  langue: string;
  registre: "vous" | "tu";
  genereLe: string;
  edite: boolean;
}
export function parseBrief(raw: string, preuvesValides: number[], nbTouches: number): BriefProspect;  // pur : preuveId hors liste → null ; angles dédoublonnés et complétés
export function angleDeTouche(brief: BriefProspect, indexTouche: number): string;
export function briefActionnable(brief: BriefProspect | null): boolean;   // declencheur non nul
export async function genererBrief(userId: string, args: { lead: any; campaign: any; projectId: number | null; enrichText: string; audit: Record<string,string>; nbTouches: number }): Promise<BriefProspect>;
```

**Comportement :**
- Actualité : un seul `serpSearch` Google News sur `lead.company` quand `serpConfigured()`, journalisé dans `prospection_usage` (`bright_data_search`). Un échec ne bloque pas le brief.
- `lead.notes` non vide et sans déclencheur trouvé → la note devient le déclencheur (`source: 'note'`).

- [ ] Tests purs :
  - `parseBrief` avec un `preuveId` inconnu → `null` ;
  - JSON illisible → brief avec `declencheur: null` ;
  - angles en double → dédoublonnés ;
  - `angleDeTouche` au-delà de la liste → dernier angle ;
  - `briefActionnable(null) === false`.
- [ ] Implémenter, faire passer les tests, commit.

### Task 8 : rédaction unique + contrôle qualité

**Files :**
- Create : `server/services/prospection/relecture.ts` (couche 2, IA légère).
- Create : `server/services/prospection/exemples.ts` (pur : sélection des exemples), plus son test.
- Modify : `server/services/sequence-message.ts`. `buildStepPrompt` est réécrit autour de :
  - `blocDoctrine` ;
  - le brief et `angleDeTouche` ;
  - `texteDePreuve` ;
  - les exemples ;
  - les consignes (globales + campagne + règles apprises acceptées) ;
  - les textes antérieurs.
- Modify : `generateStepMessage` :
  - lit le brief ; sans brief actionnable, lève `BriefIncompletError` (le moteur et l'aperçu l'interceptent) ;
  - boucle couche 1 + couche 2 avec une réécriture ;
  - en cas d'échec persistant, met en cache avec `qualite: 'a_revoir'` et `defauts` ;
  - `StepMessageResult` gagne `aRevoir?: boolean` et `defauts?: Defaut[]` ;
  - appelle `callClaudeWithContext` avec `destinataire: 'tiers'`.
- Modify : `server/services/prospection-pipeline.ts` :
  - suppression de `generateChannelMessage` ;
  - `enrichProspects` rédige la première touche LinkedIn et la première touche email via `redigerTouche` ;
  - les textes sont copiés dans `linkedinMessage` et `emailMessage` ;
  - `stage` passe à `messages_ready` seulement si le brief est actionnable, sinon `a_completer` (nouvelle valeur affichée, sans effet sur les gardes).
- Tests : `sequence-message.test.ts` existant adapté, `exemples.test.ts`.

**Interfaces produites :**
```ts
export function choisirExemples(fb: ProspectionMessageFeedback[], role: RoleTouche, max = 4): string[];   // priorité aRepondu > modifie > colle (original null) > valide_tel_quel ; récents d'abord
export async function relire(args: { userId: string; projectId: number|null; role: RoleTouche; body: string; subject?: string|null; brief: BriefProspect }): Promise<Defaut[]>; // panne → []
export async function redigerTouche(userId: string, args: { lead: any; campaign: any; role: RoleTouche; canal: "linkedin"|"email"; previousTexts: string[]; instructions: string; founderName: string; projectName: string }): Promise<{ subject: string|null; body: string; defauts: Defaut[]; aRevoir: boolean }>;
```

- [ ] Tests de `buildStepPrompt` :
  - il contient le bloc doctrine et l'angle de la touche ;
  - il contient la preuve résolue (sans le nom si `citable=false`) et les exemples ;
  - il ne contient plus « Termine par UNE seule question ouverte » ni « jamais commercial ».
- [ ] Tests de `choisirExemples` : priorités, filtre par rôle, `max` respecté.
- [ ] Test de `relire` : réponse non JSON → `[]`.
- [ ] Implémenter, faire passer tous les tests de prospection, commit.

### Task 9 : moteur d'envoi

**Files :**
- Modify : `server/services/prospection-sender.ts`, plus son test existant.

**Comportement :**
- `gen.aRevoir` et message non édité → rien n'est envoyé, l'étape reste en attente. On réutilise la garde existante (`setLeadSequenceGuard`) avec `RAISON_A_REVOIR`, et le prochain essai est repoussé de `TROP_PROCHE_RETRY_BACKOFF_MS`.
- `BriefIncompletError` → même traitement, avec `RAISON_BRIEF_INCOMPLET`.

- [ ] Test : un message `a_revoir` non édité n'appelle ni SendGrid ni Unipile.
- [ ] Test : un message édité est envoyé.
- [ ] Implémenter, faire passer les tests, commit.

### Task 10 : édition, feedback, règles apprises

**Files :**
- Create : `server/routes-prospection-apprentissage.ts`, plus son test.
- Create : `server/services/prospection/regles-apprises.ts` (extraction IA ; parse pur testé).
- Modify : `PATCH /api/leads/:id`. Quand `linkedinMessage` ou `emailMessage` change, le texte est recopié dans le cache de la première touche du canal avec `edited: true`, et une ligne de feedback `modifie` est écrite.
- Modify : `POST /api/leads/:id/validate`. Pour chaque message de première touche non édité, une ligne de feedback `valide_tel_quel` est écrite.
- Modify : la détection de réponse. Là où `repliedAt` est posé (`linkedin-sync.ts`, webhook SendGrid ou réponses), appel de `markFeedbackReplied`.

**Routes :**
- `PUT /api/leads/:id/step-messages/:stepId` `{ subject?, body }` → `edited: true`, feedback `modifie`.
- `POST /api/leads/:id/step-messages/:stepId/ecarter` `{ raison, texte? }` → feedback `ecarte`, cache supprimé ; la prochaine génération réécrit.
- `PATCH /api/leads/:id/brief` → brief modifié, `edite: true`, et le cache non édité du prospect est invalidé.
- `GET /api/projects/:id/learned-rules` et `PATCH /api/projects/:id/learned-rules/:ruleId` `{ statut, texte? }`.
- `POST /api/projects/:id/example-messages` `{ role, body }` → feedback `modifie` avec `original: null`.

**Déclencheur d'extraction :** après chaque écriture `modifie` ou `ecarte`, si 10 nouvelles lignes ont été écrites depuis la dernière extraction, `extraireRegles` crée de 1 à 5 règles `proposee`. L'appel est asynchrone et ne bloque jamais la requête.

- [ ] Tests :
  - propriété vérifiée (404) ;
  - la raison d'écart est validée ;
  - un message collé apparaît dans `choisirExemples` ;
  - `parseRegles` ignore les règles vides et en garde 5 au plus.
- [ ] Implémenter, faire passer les tests, commit.

### Task 11 : interface

**Files :**
- Create : `client/src/pages/project/PreuvesPanel.tsx`, ajouté dans `ProjectPage.tsx`.
- Modify :
  - `client/src/pages/project/useProjectPage.ts` (hooks preuves) ;
  - `client/src/pages/outreach/LeadDetail.tsx` (bloc « Brief » modifiable, défauts et badge « À revoir ») ;
  - `client/src/pages/outreach/PreviewTab.tsx` (badge « À revoir » avec raisons, actions Régénérer et Écarter) ;
  - `client/src/pages/outreach/types.ts` et `client/src/pages/outreach/useOutreach.ts` (hooks : brief, step-messages, écarter, règles apprises, exemples).
- Create : `client/src/pages/outreach/ApprentissagePanel.tsx`, affiché dans `CampaignWorkspace.tsx` : règles proposées (accepter, modifier, refuser), messages collés, rappel « bibliothèque de preuves vide ».
- Modify : `SequenceTab.tsx`, avec le bouton « Reconstruire avec les nouvelles structures » (appelle `generate-sequence`).
- Modify : les locales FR et EN.

- [ ] `npx tsc --noEmit`, `npm test`, `npm run build`, puis commit.

### Task 12 : vérification finale

- [ ] `npm test` vert, `npx tsc --noEmit` à zéro, `npm run build` OK.
- [ ] Revue de toute la branche par un relecteur indépendant, puis correction des points confirmés.
- [ ] Récapitulatif pour Jeanne : ce qui est fait, la migration à appliquer en production (étape manuelle), le push à décider.
