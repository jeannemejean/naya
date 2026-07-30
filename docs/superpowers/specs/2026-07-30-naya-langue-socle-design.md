# Socle de langue — une seule langue, portée par le compte

Date : 2026-07-30
Statut : spec validée, plan à écrire
Sous-projet 1 sur 3 (voir « Découpage » en fin de document)

## Le problème

Naya mélange le français et l'anglais sur le même écran, dans les deux sens. Trois causes distinctes, indépendantes les unes des autres :

1. **L'app s'ouvre en anglais.** `client/src/lib/i18n.ts:14` initialise la langue à `localStorage.getItem('naya_language') || 'en'`. Sans cache local, le défaut est l'anglais — alors que le CLAUDE.md pose le français comme langue par défaut et que la préférence en base de Jeanne est `fr`.
2. **La langue du compte n'est jamais lue.** Le champ `userPreferences.language` existe (`shared/schema.ts:150`, défaut `fr`), le sélecteur de la sidebar l'écrit déjà (`client/src/components/sidebar.tsx:53-63` → `PATCH /api/preferences`), et l'IA le lit déjà (`server/services/naya-context.ts:202`). Mais **rien ne le relit au démarrage de l'interface.** Un nouveau navigateur ignore donc la langue du compte.
3. **Le repli entre langues masque les trous.** `fallbackLng: 'en'` : toute clé absente du dictionnaire français s'affiche silencieusement en anglais. Le mélange est structurel et invisible.

À quoi s'ajoute le texte que le serveur renvoie et que le client affiche brut. Les erreurs d'authentification sont écrites en anglais (`"Invalid email or password"`, `"Email already registered"`, `routes.ts:882-955`) et `client/src/components/auth-dialog.tsx:58,93` les affiche telles quelles : **en français, l'écran de connexion parle anglais.**

## Périmètre

Dans le périmètre :

- La langue devient une donnée du compte, lue au démarrage de l'interface web.
- Le français devient la langue par défaut.
- Le repli silencieux entre langues est supprimé, remplacé par un test de complétude.
- Les messages du serveur **effectivement affichés à l'écran** passent par des codes traduits côté client.

Hors périmètre, explicitement :

- Les 886 lignes de texte français écrit en dur, réparties sur 60 fichiers du client web → sous-projet 2.
- La langue de génération de l'IA, la traduction avec mémoire du contenu déjà stocké, la langue de campagne du contenu sortant, la transcription Whisper figée sur `fr` (`routes.ts:3181`) → sous-projet 3.
- L'app mobile, qui n'a aucun i18n → plus tard, non planifié.

Ce sous-projet ne rendra donc pas l'app bilingue. Il construit la seule chose qui manque pour que quoi que ce soit puisse « suivre la langue » : une langue à suivre.

## État constaté

Mesures prises sur le dépôt et sur la base de production le 2026-07-29 :

| Constat | Valeur |
|---|---|
| Clés dans chaque dictionnaire | 1142, jeux strictement identiques entre `fr.ts` et `en.ts` |
| Valeurs identiques FR/EN | 39, dont la grande majorité légitimes (`Action`, `Email`, `Client`, `Blog`…) |
| Composants `.tsx` hors `ui/` | 76, dont 30 utilisent `useTranslation` |
| Fichiers contenant du français en dur | 60, pour 886 lignes |
| `userPreferences.language` en production | `fr` pour les deux comptes existants |

Le dictionnaire n'est pas le problème : il est symétrique et sain. Le problème est que la majorité de l'interface ne passe pas par lui.

## Design

### 1. La langue vit sur le compte

`GET /api/auth/user` (`server/routes.ts:975`) est déjà appelé au chargement par `useAuth`. On y ajoute le champ `language`, lu depuis `userPreferences` avec le défaut `fr`. Aucune requête supplémentaire au démarrage.

Le hook `useAuth` expose `language` au même titre que `hasAccess` ou `aiBlocked`.

### 2. L'interface se synchronise sur le compte

Un hook dédié, `useLanguageSync`, monté une seule fois près de la racine de l'app :

- dès que `/api/auth/user` répond, si `user.language` diffère de `i18n.language`, il appelle `i18n.changeLanguage(user.language)` ;
- le compte gagne toujours contre le `localStorage`.

Le `localStorage` n'est pas supprimé. Il garde deux rôles : éviter un clignotement de langue pendant la première requête, et servir la landing publique où il n'y a pas de compte.

`client/src/lib/i18n.ts` : le défaut passe de `'en'` à `'fr'`.

### 3. Le repli entre langues est supprimé

`fallbackLng: false`. Une clé absente affiche son nom (`dashboard.title`) au lieu de basculer silencieusement dans l'autre langue. C'est laid, visible, et corrigé dans la minute — là où le repli actuel produit un mélange que personne ne remarque.

Ce qui rend cette suppression sûre, c'est le test de complétude décrit plus bas : il garantit que les deux dictionnaires portent exactement le même jeu de clés, donc qu'une clé manquante ne peut pas atteindre la production.

### 4. Les deux autres sélecteurs de langue

- **Onboarding** (`client/src/pages/onboarding.tsx:312`) : l'utilisateur est déjà connecté, le sélecteur doit donc persister sur le compte. Il reçoit la même mutation que la sidebar. La logique commune est extraite dans un hook `useLanguageToggle` pour qu'il n'existe qu'un seul chemin d'écriture.
- **Landing** (`client/src/pages/landing.tsx:116`) : aucun compte à ce stade, le sélecteur reste sur le `localStorage` seul. Comportement inchangé, hors du défaut qui passe au français.

### 5. Les messages du serveur

Règle : **l'interface n'affiche jamais un texte venu du serveur.** Le serveur renvoie un code stable en `snake_case` ; le client affiche la clé `errors.<code>`. Le champ `message` reste dans la réponse pour les journaux et le débogage, mais aucun composant ne le rend à l'écran.

Cette convention existe déjà dans le code — `ai_monthly_limit_reached` est lu comme un code par `NayaCompanion.tsx:315` et `ProjectSummaryBar.tsx:137`, `already_registered` par `landing.tsx:23`. On la généralise au lieu d'en inventer une.

Quatre endroits affichent aujourd'hui du texte serveur brut. Ce sont les seuls concernés par ce sous-projet :

| Fichier | Endpoints consommés |
|---|---|
| `components/auth-dialog.tsx:58` | `POST /api/auth/register` |
| `components/auth-dialog.tsx:93` | `POST /api/auth/login` |
| `pages/settings.tsx:205` | `GET /api/social/oauth/:platform/url` |
| `pages/content-calendar.tsx:373` | `POST /api/content/:id/publish` |

Les endpoints correspondants passent aux codes ; les clés `errors.*` sont ajoutées aux deux dictionnaires. Les autres `res.status(500).json({ message })` du serveur, qui ne remontent nulle part à l'écran, ne sont pas touchés : les convertir serait du bruit sans effet visible.

## Vérification

Tests automatisés :

1. **Complétude des dictionnaires** — les jeux de clés de `fr.ts` et `en.ts` sont identiques. Échoue à la moindre asymétrie. C'est ce test qui autorise la suppression du repli.
2. **Langue par défaut** — sans `localStorage` et sans compte, la langue résolue est `fr`.
3. **Synchronisation** — compte en `en`, cache local en `fr` : après réponse de `/api/auth/user`, la langue active est `en`.
4. **Codes d'erreur** — les endpoints d'authentification renvoient les codes attendus, et chaque code émis possède sa clé dans les deux dictionnaires.

Vérification manuelle, à faire sur le dev local avant déploiement :

- navigation privée, sans cache → l'app s'ouvre en français ;
- bascule en anglais, rechargement → toujours en anglais ;
- ouverture dans un autre navigateur → anglais, puisque la langue vient du compte et non du poste ;
- échec de connexion volontaire avec un mauvais mot de passe → message en français.

## Risques

**Le test de complétude peut échouer d'entrée.** Les deux dictionnaires sont symétriques aujourd'hui (1142 clés de chaque côté, vérifié), donc il devrait passer immédiatement. S'il échoue, on corrige les clés manquantes dans le même lot — c'est précisément ce qu'il est censé attraper.

**Retirer le repli peut exposer des clés manquantes non détectées** appelées dynamiquement (`t(variable)`), que le test statique ne voit pas. Mitigation : parcourir manuellement les écrans principaux dans les deux langues pendant la vérification, et chercher les appels `t()` à argument non littéral pour les traiter à la main.

**Aucune migration de base.** Le champ `language` existe déjà avec son défaut. Rien à appliquer sur la production avant le code.

## Découpage d'ensemble

Ce document couvre le sous-projet 1. Les deux suivants auront leur propre spec :

**2 — L'interface web.** Les 886 chaînes en dur sur 60 fichiers, converties par lots — dashboard et planning, puis outreach, puis réglages, puis le reste — avec validation visuelle à chaque lot. Plus un garde-fou automatique : un test qui échoue si un composant contient du texte en dur. Sans ce garde-fou, le problème reviendra ; c'est exactement comme il est apparu, tout le travail récent ayant été écrit hors i18n sans que rien ne l'empêche.

**3 — L'IA et la traduction avec mémoire.** Brancher la langue du compte dans la quinzaine de services qui court-circuitent `buildNayaContext`, débloquer la transcription Whisper, et construire le mécanisme traduire-une-fois-garder-les-deux-versions pour les titres de tâches, le brief quotidien et le Companion. Plus une langue propre aux campagnes pour le contenu sortant.

## Décisions actées avec Jeanne

- **Périmètre global** : web + messages serveur + contenu généré par l'IA. Le mobile est reporté.
- **Source de vérité** : un seul réglage, porté par le compte. Pas de réglage séparé interface / IA.
- **Contenu déjà généré et stocké** : traduction avec mémoire, pas régénération. On traduit une fois, on garde les deux versions, les bascules suivantes sont instantanées et gratuites. Le contenu original n'est jamais écrasé.
- **Ce que Jeanne a écrit elle-même** (noms de projets, notes, objectifs, briefs client) n'est jamais traduit ni régénéré.
- **Contenu sortant** (messages de prospection, publications sociales) : sa langue appartient à la campagne, français par défaut, et ne suit jamais le réglage d'affichage. Un basculement d'interface ne doit pas réécrire en anglais un message destiné à un prospect français.
