---
name: prospection
description: >
  Skill de prospection intelligente multi-campagnes. Lit les campagnes actives
  définies par l'utilisateur, trouve des prospects qualifiés via LinkedIn et le
  web, réalise un audit de marque structuré, génère des messages personnalisés
  selon la voix de l'entreprise et le canal, et dépose tout dans le CRM.
  Entièrement piloté par le Brand DNA de l'utilisateur — s'adapte automatiquement
  à n'importe quel secteur, cible ou offre.
triggers:
  - "lancer la prospection"
  - "trouver des prospects"
  - "chercher des clients"
  - "nouvelle campagne de prospection"
  - "prospecter aujourd'hui"
---

# Skill Prospection — Naya

## Philosophie

La prospection efficace ne part pas d'un secteur. Elle part d'une configuration de marque et d'un signal d'achat. Un prospect sans signal est du bruit. Un prospect avec un signal clair, au bon moment, vaut dix autres.

Ce skill s'exécute en lisant les campagnes actives de l'utilisateur dans Naya, puis en cherchant des profils qui correspondent à la fois au secteur cible et à au moins un signal d'achat identifiable. Il n'invente rien. Il observe, qualifie, et prépare.

---

## Prérequis — Brand DNA

Avant d'exécuter ce skill, vérifier que le Brand DNA de l'utilisateur contient :

| Champ Brand DNA       | Utilisation dans le skill                                      |
|-----------------------|----------------------------------------------------------------|
| `businessName`        | Signature des messages                                         |
| `founderName`         | Signature personnelle (LinkedIn = compte perso)                |
| `sector`              | Filtrage des campagnes et des profils                          |
| `offers`              | Proposition de valeur dans les messages                        |
| `targetAudience`      | Paramètres de recherche LinkedIn / web                         |
| `voiceTone`           | Ton des messages (naturel, expert, proche, etc.)               |
| `positioningStatement`| Angle utilisé dans le message 2 (suivi)                        |

Si le Brand DNA est incomplet, demander à l'utilisateur de compléter les sections manquantes avant de lancer.

---

## Architecture du système

### 1. Base Campagnes

Chaque utilisateur définit ses campagnes de prospection. Une campagne est un segment de ciblage avec sa propre logique de message.

**Champs d'une campagne :**

| Champ                   | Type     | Description                                                                 |
|-------------------------|----------|-----------------------------------------------------------------------------|
| `name`                  | string   | Nom lisible (ex : "Vignobles - Tourisme international")                    |
| `status`                | select   | Active / En pause / Terminée                                                |
| `targetSector`          | string   | Secteur(s) visé(s) (ex : "Viticulture, Oenotourisme")                      |
| `digitalLevel`          | select   | Fort / Faible / Tous — niveau de maturité digitale attendu                 |
| `channel`               | select   | LinkedIn / Email / LinkedIn + Email                                         |
| `jmdOffer` (ou `offer`) | select   | L'offre proposée (libre, définie par l'utilisateur)                        |
| `prospectsPerDay`       | number   | Nombre de prospects à trouver par exécution                                 |
| `buyingSignals`         | text     | Description des signaux d'achat à rechercher                               |
| `campaignBrief`         | text     | Ce que l'utilisateur propose à ce segment, en une phrase                    |
| `messageAngle`          | text     | Angle du message d'approche pour cette campagne                             |

### 2. CRM Prospects

Chaque prospect trouvé génère une fiche dans le CRM de l'utilisateur.

**Champs minimaux d'une fiche prospect :**

| Champ               | Description                                               |
|---------------------|-----------------------------------------------------------|
| `name`              | Prénom + nom                                              |
| `company`           | Nom de la marque / entreprise                             |
| `role`              | Titre exact                                               |
| `sector`            | Secteur détecté                                           |
| `linkedinUrl`       | URL profil LinkedIn                                       |
| `instagramUrl`      | URL compte Instagram (si trouvé)                          |
| `email`             | Adresse email (si canal Email)                            |
| `strategicNotes`    | Fiche audit en 6 sections                                 |
| `message1`          | Message de connexion / premier contact                    |
| `message2`          | Message de suivi avec angle concret                       |
| `message3`          | Message de clôture court                                  |
| `campaign`          | Relation vers la campagne d'origine                       |
| `priority`          | Chaud / Tiède / Froid                                     |
| `stage`             | Étape dans le pipeline                                    |
| `firstContactDate`  | Date d'ajout                                              |

**Étapes du pipeline :**
`Identifié` → `Messages prêts` → `Connexion envoyée` → `Connecté` → `Suivi 1 envoyé` → `Suivi 2 envoyé` → `En discussion` → `Proposition envoyée` → `Signé` / `Sans suite`

---

## Process d'exécution — 5 étapes

### ÉTAPE 1 — Lire les campagnes actives

Récupérer toutes les campagnes dont `status = "Active"` pour cet utilisateur.

Pour chaque campagne active, noter :
- Son secteur cible
- Son niveau digital attendu
- Son canal (LinkedIn, Email, ou les deux)
- Son nombre de prospects par jour
- Ses signaux d'achat
- Son angle de message

### ÉTAPE 2 — Trouver les prospects

**Pour les campagnes mode / beauté / lifestyle / luxe / B2C premium :**

Utiliser LinkedIn Search avec les critères :
- Titres : Fondateur, Fondatrice, CEO, Co-fondateur, Directeur Général, Directrice Générale, Président, Présidente, Gérant
- Secteurs : ceux définis dans la campagne
- Localisation : pays de l'utilisateur (Brand DNA → `targetMarket`)
- Taille d'entreprise : 1-50 employés (maison indépendante)

**Pour les campagnes B2B / artisanat / tourisme / local :**

Utiliser une recherche web ciblée pour trouver des entreprises correspondant au profil.
Exemples de requêtes :
- `"[secteur] [localisation] contact visite"`
- `site:tripadvisor.com "[secteur]" "[region]"`
- Annuaires spécialisés selon le secteur

**Segmentation par niveau digital :**

| Niveau digital | Critère de sélection                                      | Offre cible             |
|----------------|-----------------------------------------------------------|-------------------------|
| Fort           | +5 000 abonnés LinkedIn ou Instagram actif et régulier    | Campagne thématique     |
| Faible         | Présence digitale sous-développée vs niveau d'activité    | Refonte communication   |
| Tous           | Pas de filtre sur la présence digitale                    | Selon campagne          |

### ÉTAPE 3 — Qualifier chaque prospect

Pour chaque candidat, vérifier :

1. **Signal d'achat identifiable** : au moins un parmi ceux définis dans la campagne.
   Exemples universels de signaux :
   - Ouverture d'un nouveau lieu ou point de vente
   - Lancement de produit ou collection
   - Anniversaire de l'entreprise (5 ans, 10 ans)
   - Nouvelle distribution ou partenariat
   - Levée de fonds récente
   - Recrutement en cours sur un poste communication / marketing
   - Fondateur qui augmente sa fréquence de publication LinkedIn
   - Site web uniquement dans une langue (opportunité de localisation)

2. **Indépendance** : la marque n'est pas une filiale de grand groupe.

3. **Niveau digital** : correspond à ce qu'attend la campagne (Fort / Faible / Tous).

4. **Doublon** : le prospect n'est pas déjà dans le CRM de l'utilisateur.

Éliminer tout prospect qui ne passe pas ces 4 filtres.

### ÉTAPE 4 — Audit de marque

Pour chaque prospect retenu, rédiger une fiche structurée en 6 sections dans `strategicNotes` :

```
1. CONTEXTE MARQUE
   Histoire, positionnement, produits/services, stade de développement,
   ancienneté, géographie.

2. AUDIENCE
   Qui elle touche. Canaux utilisés. Volume estimé (abonnés, portée).
   Profil type du client.

3. CONTENU
   Ce qu'elle publie. Fréquence. Formats. Ton. Sujets récurrents.
   Ce qui performe le mieux vs ce qui sous-performe.

4. POSITIONNEMENT
   Ce qui la différencie. Son angle distinctif.
   Ce que ses concurrents ne font pas.

5. ENJEUX
   2-3 défis communication identifiables et documentables.
   Pas d'opinion — des observations factuelles.

6. ANGLE [NOM AGENCE / UTILISATEUR]
   L'accroche ou le concept spécifique que l'utilisateur pourrait utiliser.
   Ancré dans les données. Lié à la campagne active.
```

### ÉTAPE 5 — Rédiger les messages

#### Principes communs à tous les messages

- Ton naturel, humain, curieux. Jamais commercial.
- Ancré dans des données observables sur le prospect.
- Signé du prénom du fondateur (pas du nom de l'agence) sur LinkedIn.
- Pas de tirets longs (—). Phrases courtes.
- Pas de "Je me permets de vous contacter". Pas d'"En tant qu'expert".
- La valeur est dans l'observation, pas dans l'autoproclamation.

#### Canal LinkedIn — Séquence en 3 messages

**Message 1 — Note de connexion (max 200 caractères)**

Objectif : créer un lien humain, déclencher une connexion acceptée.

Structure :
1. Une observation spécifique à leur marque ou situation (pas générique)
2. Une question de curiosité sincère

Ce qui fonctionne :
- Référencer quelque chose de concret (un post, un produit, un signal)
- Montrer qu'on a regardé, pas juste scrapé
- Finir sur une vraie question (pas rhétorique)

Ce qui ne fonctionne pas :
- "J'ai vu votre profil et j'ai été impressionné"
- Parler de soi en premier
- Mentionner une offre commerciale

Signature : `[Prénom Fondateur]`

---

**Message 2 — Suivi après connexion acceptée**

Objectif : montrer la profondeur de l'analyse, proposer un angle de valeur concret.

Structure :
1. Observation factuelle précise (donnée de l'audit)
2. Ce que cette observation révèle (la tension, le paradoxe, l'opportunité)
3. Ce que l'utilisateur propose concrètement pour ce prospect

Pour les campagnes **"Offre complète"** (ex : refonte communication) :
Proposer l'angle stratégique principal ancré dans les enjeux identifiés.

Pour les campagnes **"Campagne thématique"** (digital déjà fort) :
Entrer par un temps fort commercial. Ne pas proposer une refonte. Proposer une campagne unique, testable, sans engagement long terme.

Longueur : 5-8 phrases. Pas de liste. Pas de gras.

Signature : `[Prénom Fondateur]`

---

**Message 3 — Clôture**

Objectif : fermer sans pression, laisser une porte ouverte.

Structure : 2-3 phrases max.
Ton : "Peut-être que ce n'est pas le bon moment. Pas de souci. Je reste disponible si ça change."

Ne jamais relancer avec une offre. Ne jamais mettre de lien. Ne jamais deadline.

Signature : `[Prénom Fondateur]`

---

#### Canal Email

Objectif : un email court qui capte l'attention du bon décideur.

Structure :
1. Observation factuelle sur leur activité (pas un compliment générique)
2. Le gap identifié (formulé comme une question ou un constat neutre)
3. Ce que l'utilisateur propose — en une phrase concrète
4. Question ouverte simple pour déclencher la réponse

Longueur : 6-8 phrases. Objet : factuel, pas accrocheur.

Signature : `[Prénom Fondateur] / [Nom Agence]`

---

## Adaptation automatique au Brand DNA

Ce skill lit le Brand DNA de l'utilisateur pour personnaliser :

| Paramètre Brand DNA    | Effet sur le skill                                                   |
|------------------------|----------------------------------------------------------------------|
| `founderName`          | Signature de tous les messages                                       |
| `businessName`         | Signature email, mention dans les messages si pertinent              |
| `voiceTone`            | Calibrage du ton (plus formel, plus chaleureux, plus expert, etc.)  |
| `targetAudience`       | Filtre de qualification des prospects                                |
| `offers`               | Proposition de valeur dans le message 2                              |
| `positioningStatement` | Angle utilisé pour différencier dans le message 2                    |
| `targetMarket`         | Localisation géographique de la recherche LinkedIn / web             |
| `sector`               | Cohérence de ciblage entre les campagnes et le cœur de métier        |

**Exemple d'adaptation sectorielle :**

| Secteur utilisateur   | Type de prospects visés            | Canal privilégié | Offre type                    |
|-----------------------|------------------------------------|------------------|-------------------------------|
| Agence communication  | Fondateurs de marques indépendantes | LinkedIn         | Refonte com / campagne        |
| Agence tourisme       | Hôtels, domaines, expériences      | Email            | Stratégie internationale      |
| Agence RH             | DRH / fondateurs en croissance     | LinkedIn         | Recrutement / marque employeur|
| Coach business        | Entrepreneurs solo                 | LinkedIn         | Accompagnement individuel     |
| Studio design         | Startups en phase de lancement     | LinkedIn + Email | Identité visuelle             |

---

## Règles d'exécution

1. **Pas de prospect sans signal d'achat.** Un signal identifiable est obligatoire.
2. **Pas de doublon.** Vérifier le CRM avant d'ajouter.
3. **Respecter le nombre de prospects par campagne.** Ne pas dépasser `prospectsPerDay`.
4. **Les 3 messages rédigés avant la première action.** Tout doit être prêt dans le CRM avant que l'utilisateur envoie quoi que ce soit.
5. **L'utilisateur envoie manuellement.** Ce skill prépare, il n'envoie jamais.
6. **Signature LinkedIn = prénom fondateur.** Jamais le nom de l'agence seul.
7. **Signature email = prénom fondateur / nom agence.** Les deux.
8. **Langue des messages = langue du marché cible.** Pas forcément la langue de l'interface.

---

## Sorties attendues par exécution

Pour chaque campagne active, livrer dans le CRM :

- N nouvelles fiches prospects (`N = prospectsPerDay` de la campagne)
- Chaque fiche contient : audit 6 sections + 3 messages rédigés (LinkedIn) ou email + `stage = Identifié`
- Les prospects sont reliés à leur campagne d'origine

---

## Intégration Naya

Ce skill peut être déclenché :

- **Manuellement** : depuis le tableau de bord ou la page Campagnes
- **En automatique** : via une tâche planifiée quotidienne (ex : chaque matin à 8h)
- **Depuis le Campaign Engine** : quand une campagne passe au statut "Active", une première exécution est proposée

Les prospects créés alimentent directement le pipeline commercial de l'utilisateur. L'évolution du pipeline (Connecté → En discussion → Signé) peut alimenter les **Business Memories** de Naya (décisions, leçons, pivots) et améliorer les prochaines générations de messages.
