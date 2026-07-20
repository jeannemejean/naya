# Design — Refonte Outreach : séquences visuelles, aperçu par prospect, canal intelligent

> Spec de conception validée avec Jeanne (20 juillet 2026). Refonte complète de la page Outreach
> (prospection) pour la rendre visuelle et user-friendly, en s'inspirant des meilleures pratiques UX
> (Lemlist) **tout en préservant le moat de Naya : des messages sur-mesure par prospect.**
> Ce document décrit le *quoi* et le *pourquoi*. Le découpage d'exécution en découle (writing-plans).

---

## 0. Principe directeur (à ne jamais perdre de vue)

**La qualité de la prospection Naya vient du message sur-mesure par prospect** — pas d'un template à trous.
En prod aujourd'hui, chaque lead reçoit un message d'ouverture unique, écrit à partir de son audit
(ex. *« Petit Bivouac, le nom seul crée déjà une pause… Jeanne »*). C'est ça qu'il faut protéger et étendre.

Le modèle cible réconcilie ce moat avec une vraie « vision de séquence » :

> **Une campagne = un PLAN de séquence partagé + des MESSAGES sur-mesure par prospect.**
>
> - Le **plan** est commun et visible : la suite d'étapes, chacune avec son **canal**, son **timing**,
>   ses **branches conditionnelles** et son **intention** (« invitation d'ouverture », « email de valeur »…).
>   C'est ce que Naya conçoit intelligemment et que Jeanne peut ajuster.
> - Le **texte** de chaque étape reste **bespoke, généré par Naya pour chaque prospect** à partir de son
>   audit + l'ADN de marque. Jamais un template à variables.
> - Les messages des **étapes de relance sont générés au dernier moment** (juste avant l'envoi, et
>   seulement si le prospect n'a pas répondu) → sur-mesure total sans exploser le budget IA, et ça colle
>   à la logique conditionnelle.

---

## 1. Décisions actées (brainstorming)

| # | Décision | Choix |
|---|----------|-------|
| 1 | Modèle de canal | **Multicanal AVEC logique conditionnelle** (email + LinkedIn, branches) |
| 2 | Personnalisation | **Plan partagé + texte bespoke par prospect** (pas de template à variables) |
| 3 | Périmètre visuel | **Refonte complète de la page** (campagne, séquence, aperçu, kanban, fiche lead, nav) |
| 4 | Architecture campagne | **Espace de travail à 4 sous-onglets** : Séquence · Prospects · Aperçu · Résultats |
| 5 | Livraison | **Avec le moteur conditionnel dès le départ** (pas de report en V2) |

Recherche à l'appui (Lemlist & benchmarks 2026) : email seul ~3,4 % de réponses, LinkedIn seul ~5-11 %,
**multicanal coordonné ×2-3** (jusqu'à 15-25 %). Best practice : démarrer souvent par un canal à forte
portée puis relancer sur l'autre, avec des branches conditionnelles.

---

## 2. Langage visuel (patte JMD/Naya)

Ancré dans les tokens réels (`client/src/index.css`, `:root`). **Pas de dark mode** (palette unique claire).

- Fonds : crème `#F7F4EC` (background), cartes `#FAFAF5`. Texte : olive foncé `#2B2D1C`, muted `#5C6040`.
- Bordures : olive 12 % `rgba(43,45,28,0.12)`. Radius 6px. Police Inter.
- Boutons sombres = `bg-primary` (olive `#2B2D1C`) → texte `text-primary-foreground` (clair).
  ⚠️ Ne jamais remettre `.text-white` dans l'override non scopé d'`index.css` (piège connu).
- **Codage des canaux par couleur** (réutilise la mini-palette déjà définie, aucune couleur importée) :
  - **LinkedIn** → bleu salvia `#7D8FA8` (`--chart-2` / `--accent`)
  - **Email** → jaune soufre `#D4C97A` (`--chart-1`)
  - **Bounce / alerte** → mauve poudré `#9E7E87` (`--destructive`)
  - **Neutre / terminé** → olive `#2B2D1C` / `#5C6040`
- Composants : shadcn/ui existants (Tabs, Select, Dialog, Sheet, AlertDialog, Badge, Progress…).

---

## 3. Architecture de l'information

Aujourd'hui : page plate à 2 onglets (Pipeline kanban global + liste de campagnes). `client/src/pages/outreach.tsx`
est un **monolithe de ~1667 lignes** (tous les sous-composants inline). La refonte le décompose.

**Cible — deux niveaux :**

1. **Accueil Outreach** — 2 entrées :
   - **Campagnes** : grille de cartes campagne (santé, canal(aux), nb prospects, avancement, mini-stats).
   - **Pipeline** : le kanban CRM global (tous prospects, toutes campagnes) — repensé (§7).
2. **Espace de travail campagne** (clic sur une carte) — 4 sous-onglets :
   - **Séquence** — le plan visuel (§4)
   - **Prospects** — l'audience de la campagne (liste/kanban restreint, sourcing, enrichissement)
   - **Aperçu** — la séquence rendue avec de vrais prospects (§5)
   - **Résultats** — analytics par étape et par canal (§8)

**Décomposition fichiers** (sortir du monolithe) : `client/src/pages/outreach/` avec
`OutreachHome.tsx`, `CampaignCard.tsx`, `CampaignWorkspace.tsx`, `SequencePlan.tsx`, `SequenceStepCard.tsx`,
`SequencePreview.tsx`, `PipelineBoard.tsx`, `LeadCard.tsx`, `LeadDetail.tsx`, `AuditView.tsx`, `LeadFinderDialog.tsx`.
Chaque composant a une responsabilité unique et testable.

---

## 4. Le plan de séquence visuel (sous-onglet Séquence)

**Timeline verticale** (rail Lemlist), sobre, aux codes JMD. Chaque nœud = une étape.

```
  Plan conçu par Naya ✦   « J'ai démarré par LinkedIn : ta cible y est très
                            active et peu réceptive au cold email. »       [Repenser (IA)]

  ●─ [in] J+0   Invitation d'ouverture              · LinkedIn
  │            intention : accroche sur le nom de marque
  │
  ●─ [@] J+3    Email de valeur                      · Email        ⑃ si invitation NON acceptée
  │            intention : 1 insight tiré de l'audit
  │
  ●─ [in] J+6   Message de relance courte            · LinkedIn     ⑃ si invitation acceptée
              intention : ouverture d'une conversation      [+ ajouter une étape]
```

- Un nœud affiche : **icône + couleur du canal**, **timing** (J+n après l'étape précédente), **intention**
  de l'étape (courte phrase), et le cas échéant un **badge de condition** (la branche qui déclenche l'étape).
- **Le texte du message n'apparaît pas ici** (il est par prospect) — l'intention tient lieu de résumé.
  Ça garde le plan **stable et lisible**.
- Édition : segmented control pour changer le canal, champ intention, timing, réordonner (drag),
  ajouter/supprimer une étape, définir la condition d'une étape (§6).
- **En-tête** : bandeau « Plan conçu par Naya » + sa justification (éditable), bouton **Repenser (IA)**
  qui régénère le plan complet (canaux + timing + branches + intentions).

---

## 5. L'aperçu par vrai prospect (sous-onglet Aperçu) — demande n°1 de Jeanne

Deux volets :

- **Gauche** : liste des vrais prospects de la campagne (recherche, score hot/warm/cold, bouton
  « Prospect au hasard »).
- **Droite** : la séquence de *ce* prospect rendue avec ses **vrais messages sur-mesure**, étape par étape,
  dans la timeline (canal + timing + texte réel signé Jeanne).

```
  Aperçu — Fred Renaud · Petit Bivouac                        [Prospect au hasard ⟳]

  [in] J+0  Invitation LinkedIn
       « Petit Bivouac, le nom seul crée déjà une pause. Curieuse de savoir si
         c'était voulu dès le départ ou si le sens s'est imposé après. Jeanne »
                                                          [Régénérer] [Éditer] [Copier]
  [@]  J+3  Email de valeur   · objet : « Le nom que vous n'avez pas eu à expliquer »
       « … »                                              [Régénérer] [Éditer] [Copier]
```

- Chaque message est généré par le pipeline bespoke (audit + ADN de marque + intention de l'étape).
- Pour l'aperçu, on **génère à la demande** les messages des étapes suivantes du prospect choisi
  (mise en cache pour ne pas régénérer à chaque ouverture).
- **CTA** en bas : **Lancer la campagne** (enrôle tous les prospects, active le worker) une fois convaincue.
  Garde-fous d'envoi existants conservés (kill-switch `PROSPECTION_SENDING_ENABLED`, plafonds jour,
  fenêtre horaire, plafond de coût IA).

---

## 6. Intelligence de canal + moteur conditionnel

### 6.1 Génération du plan par Naya (remplace l'existant codé en dur)

Aujourd'hui `generateSequence` (`server/services/prospection.ts:302`) est **codé en dur « 3 emails »** et
ignore le canal de la campagne. On le remplace par un générateur qui **décide le mix email/LinkedIn, le
timing et les branches** à partir de l'audience (ICP, secteur, B2B/B2C, présence LinkedIn de la cible) et
produit une **justification** courte. Il réutilise l'intelligence de canal déjà présente dans
`generateChannelMessage` (`server/services/prospection-pipeline.ts`, qui sait déjà faire du LinkedIn).

Sortie = un **plan structuré** (étapes : canal, delayDays, intention, condition), **pas** de texte de message.

### 6.2 Génération du texte, par prospect, au dernier moment

Le texte de chaque étape est produit par le pipeline bespoke (extension de `generateChannelMessage` à
« une étape d'intention donnée ») :
- **Étape 1** : peut être pré-générée à l'enrôlement (comme aujourd'hui le message d'ouverture).
- **Étapes suivantes** : générées **juste avant l'envoi**, uniquement si la branche est prise et le prospect
  n'a pas répondu → sur-mesure sans coût inutile. Soumis au plafond de coût IA par utilisateur existant.
- L'ancien concept `bodyTemplate`/`subjectTemplate` à `{{variables}}` est **déprécié** au profit de
  l'intention + génération bespoke. `renderTemplate`/`leadVars` (`server/services/personalization.ts`)
  restent utiles pour de menues substitutions (prénom, société) mais ne portent plus le corps du message.

### 6.3 Modèle de branches — « conditions sur les étapes »

Plutôt qu'un graphe complexe, chaque étape porte une **condition d'exécution** (gate) évaluée par le worker.
Ça couvre les patterns Lemlist (« si pas ouvert → LinkedIn », « si invitation acceptée → message ») sans
réécrire un moteur de graphe.

Extensions du schéma `campaign_sequence_steps` (`shared/schema.ts:1364`) — **additives** :
- `intention text` (remplace l'usage de `bodyTemplate` pour porter l'angle de l'étape ; `bodyTemplate`
  conservé nullable pour rétrocompat, plus alimenté par l'IA).
- `condition text` — enum : `always` (défaut) | `if_opened` | `if_not_opened` | `if_clicked` |
  `if_invite_accepted` | `if_invite_not_accepted`. Évaluée par rapport aux signaux accumulés du prospect.
- (Le « si répondu → stop » et « si bounce → stop » sont des **règles globales**, pas des conditions
  d'étape.)

### 6.4 Signaux disponibles (ce sur quoi on peut brancher)

| Signal | Source | État |
|--------|--------|------|
| Email **ouvert** / **cliqué** | Webhook SendGrid → `outreach_messages.opened_at/clicked_at` | Webhook existant ; **open-tracking à activer dans le dashboard SendGrid** (dépendance §9) |
| Email **bounce** → stop | Webhook SendGrid → `bounced_at` | Existant |
| Prospect **a répondu** → stop | stop-on-reply (PATCH lead → stade engagé) | Existant |
| Invitation LinkedIn **acceptée / connecté** | **Nouveau** : polling Unipile (statut de relation) | À construire (§9) |

### 6.5 Réécriture du worker d'envoi

`server/services/prospection-sender.ts` (aujourd'hui **linéaire** : `currentStep` + `nextRunAt`, delayDays
après la précédente) évolue pour, à chaque tick et pour chaque prospect actif :
1. déterminer la **prochaine étape éligible** = la première étape non envoyée dont la **condition est vraie**
   au vu des signaux du prospect (sauter les étapes dont la condition est fausse) ;
2. si la prochaine étape dépend d'un signal encore indéterminé (ex. invitation en attente), **attendre**
   (re-planifier `nextRunAt`) jusqu'à résolution ou expiration (timeout par étape) ;
3. générer le texte bespoke de l'étape (§6.2), l'envoyer sur son canal, journaliser ;
4. appliquer les **règles globales** de stop (répondu / bounce) avant tout envoi.

`lead_sequence_state` (`shared/schema.ts:1380`) est étendu au besoin (ex. suivi du dernier signal évalué,
horodatage d'attente de branche). Un **poller Unipile** met à jour l'état « invitation acceptée » des
prospects en attente sur une branche LinkedIn.

Tout reste sous le **kill-switch** `PROSPECTION_SENDING_ENABLED` et les garde-fous existants (plafonds
quotidiens email/LinkedIn, fenêtre horaire, plafond de coût IA, footer conformité).

---

## 7. Kanban Pipeline & fiche prospect repensés

- **Kanban** (`PipelineBoard`) : cartes plus claires, **icône + couleur du canal courant**, **« étape 2/4 »**
  (avancement du prospect dans sa séquence), **prochaine action + date**, mini-barre de progression.
  On conserve le drag & drop (migration possible vers dnd-kit pour la fluidité ; sinon HTML5 nettoyé).
  Les 10 stages restent, mais l'affichage relie visuellement le prospect à l'étape de séquence.
- **Fiche prospect** (`LeadDetail`) : 3 onglets **Profil · Audit · Séquence**.
  - **Audit** : aujourd'hui le JSON brut est dumpé → on le **rend structuré** (`AuditView` : contexte,
    observations, angle recommandé…). Gros gain de lisibilité.
  - **Séquence** : les étapes de *ce* lead avec leur statut (envoyé / ouvert / en attente de branche…).

---

## 8. Résultats (analytics)

Étend `CampaignAnalytics` existant (`/api/prospection/campaigns/:id/analytics`) :
- taux par **étape** (envoyés / ouverts / cliqués / répondus / bounces) et par **canal** (email vs LinkedIn),
- lecture de l'efficacité des **branches** (quelle proportion passe par LinkedIn faute d'ouverture, etc.).
Affiché dans le sous-onglet Résultats et en résumé sur la carte campagne.

---

## 9. Dépendances & risques

- **SendGrid open-tracking** : les branches `if_opened`/`if_not_opened` exigent que le **suivi d'ouverture
  soit activé dans le dashboard SendGrid** (le webhook `/api/sendgrid/webhook` existe déjà). À activer +
  documenter. Sans ça, ces branches se comportent comme `if_not_opened` par défaut (dégradation sûre).
- **Unipile — détection d'acceptation d'invitation** : nouveau poller à écrire (statut de relation via
  l'API Unipile). Risque : latence/limites d'API. Fallback : timeout de branche → poursuivre sur l'autre voie.
- **Coût IA** : la génération bespoke par étape est bornée par la génération **au dernier moment** + le
  **plafond de coût par utilisateur** existant (`server/services/usage.ts`). À surveiller sur les grosses
  campagnes.
- **Sécurité prod** : aucun envoi réel déclenché pendant le dev ; kill-switch respecté ; tests d'envoi
  toujours vers soi-même. (Cf. incident passé : ne jamais tester une fonction sortante via la file de prod.)
- **Rétrocompat données** : migrations **additives** uniquement (nouveaux champs nullable), appliquées via
  `drizzle-kit generate` → relecture → `migrate` sur dev **puis** prod. Pas de `db:push` sur prod.

---

## 10. Hors périmètre (YAGNI)

- Pas de nouveau canal au-delà d'email + LinkedIn (pas de SMS/WhatsApp).
- Pas d'A/B testing des messages (Vague ultérieure éventuelle).
- Pas de refonte du sourcing/enrichissement (Bright Data, ICP) — on réutilise l'existant tel quel.
- Pas de graphe de branches arbitraire : on s'en tient aux **conditions sur étapes** (§6.3).
- Pas de refonte de l'onboarding ni des réglages d'expéditeur (on garde `ProspectionSenderCard` & co).

---

## 11. Critères de succès

1. Jeanne **voit** le plan d'une campagne d'un coup d'œil (canaux, timing, branches) — sa « vraie vision ».
2. Elle peut **prévisualiser la séquence d'un vrai prospect** avec de vrais messages sur-mesure avant de lancer.
3. Naya **choisit intelligemment** les canaux (plus de « tout email ») et **explique** son choix ; Jeanne surcharge.
4. Le **multicanal conditionnel** s'exécute réellement (email + LinkedIn, branches si-ouvert / si-accepté).
5. La **qualité sur-mesure** des messages est **préservée** (aucune régression vers du template à trous).
6. La page entière est **cohérente visuellement** (patte JMD) et **plus user-friendly**.

---

## 12. Découpage d'implémentation (indicatif — détaillé dans le plan)

1. **Données & schéma** : champs additifs `intention`, `condition` sur `campaign_sequence_steps` ;
   extensions `lead_sequence_state` ; migrations additives dev+prod.
2. **Génération du plan (IA)** : remplacer `generateSequence` (canal intelligent + branches + intentions +
   justification) ; endpoint de (re)génération de plan.
3. **Génération bespoke par étape** : étendre `generateChannelMessage` à « intention d'étape » ; génération
   au dernier moment + cache ; endpoint d'aperçu par prospect.
4. **Worker conditionnel** : réécrire `prospection-sender.ts` (éligibilité par condition, attente de branche,
   règles de stop) ; **poller Unipile** (acceptation d'invitation) ; activer open-tracking SendGrid.
5. **UI — décomposer le monolithe** : `outreach/` (Home, CampaignCard, CampaignWorkspace + 4 sous-onglets).
6. **UI — Séquence** : timeline visuelle + éditeur (canal, timing, intention, condition, réordonner).
7. **UI — Aperçu** : deux volets, rendu des vrais messages, régénérer/éditer/copier, Lancer la campagne.
8. **UI — Pipeline & fiche** : cartes avec canal+avancement, `AuditView` structuré, onglet Séquence du lead.
9. **UI — Résultats** : analytics par étape/canal/branche.
10. **Tests** : conditions du worker (purs), génération de plan (mock IA), rendu d'aperçu, garde-fous d'envoi.
