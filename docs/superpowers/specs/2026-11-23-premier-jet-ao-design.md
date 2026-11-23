# Premier jet de réponse aux appels d'offres, dans Naya

Date : 23 nov. 2026. Décisions prises par Claude (Jeanne a délégué : « je te laisse prendre toutes ces décisions »).

## Pourquoi

La routine Claude « Veille appels d'offres JMD » (trig_01MREfNB295RpZqi8XCKkvCR, 6 h 49) fait encore une chose que Naya ne fait pas : l'étape 5, un premier jet de réponse (mémoire technique) pour les meilleurs avis. C'est la dernière marche avant de pouvoir arrêter la routine. Les AO doivent vivre dans Naya, pas dans Notion.

## Constat qui oriente le design

Les 4 avis « fort » ouverts au 23 nov. ont tous le bloquant « Capacités à vérifier dans le RC ». La règle de Jeanne (14/10) dit : pas de premier jet tant que le RC n'a pas été lu ou que Jeanne n'a pas validé. Naya ne lit pas les DCE (profils acheteurs, téléchargements, comptes). Donc la règle automatique seule ne produirait presque rien. Le déclencheur principal est un bouton.

## Ce qui est construit

1. **Bouton « Préparer le premier jet »** dans le détail d'un AO (page Appels d'offres). Il vaut validation de Jeanne. Une zone facultative permet de coller le RC ou le cadre de mémoire technique (texte, 60 000 caractères max). Refusé pour un AO écarté, perdu, gagné ou déposé, et pour un AO dont la date limite est passée. « Refaire » remplace le jet précédent.
2. **Passage automatique** après la veille du matin : au plus 2 avis par jour, mêmes conditions que la routine : score fort, statut repéré, pas de premier jet, au moins 10 jours avant la date limite, aucun bloquant d'écart (hors périmètre, capacités) ni « à vérifier dans le RC ». Les plus proches de leur date limite d'abord.
3. **Génération** : l'avis complet est relu à la source (BOAMP API opendatasoft par idweb, TED API officielle par numéro de publication) ; à défaut, les champs en base (objet, critères, pièces, résumé). Contexte : profil JMD (repris de la qualification) + extrait de l'ADN de marque. Sortie structurée validée (zod) puis assemblée en Markdown par le code :
   - titre « AO [Acheteur] · [objet court] · JMD » ;
   - encadré « Structure provisoire : règlement de consultation non consulté, à recaler sur le RC » si aucun RC n'a été collé (forcé par le code, pas laissé au modèle) ;
   - rubriques calées sur le RC collé (intitulés et ordre exacts) ou, à défaut, sur les critères de l'avis, volume proportionnel à la pondération ;
   - contenu : compréhension du besoin, méthodologie et phasage, équipe (Jeanne Mejean en direction de projet, réseau de créateurs), moyens, planning type, démarche environnementale si critère, références ; tout ce qui n'est pas connu devient « [À COMPLÉTER : ...] » ; jamais de référence, chiffre, nom, attestation ou prix inventés ; pas d'offre financière ;
   - dernière partie « Checklist de dépôt » (cases à cocher) : candidature, offre, dépôt (plateforme, date et heure), ce que Jeanne doit fournir ;
   - « Points à vérifier ».
   - Règles de rédaction : aucun tiret long ni demi-cadratin (nettoyé par le code), « Jeanne Mejean » sans accent (corrigé par le code).
4. **Enregistrement** : texte dans `premier_jet` (colonne existante, auparavant un lien Notion/Claude Design). Le statut passe à « premier jet prêt » seulement s'il était « repéré » (un AO déjà en rédaction le reste). Puis les jalons de l'AO sont resynchronisés comme pour un changement de statut (le statut premier_jet_pret ouvre déjà le jalon « Décider »).
5. **Affichage** : dans le détail, une section « Premier jet » rend le Markdown (titres, listes, cases, gras), avec « Copier » et « Télécharger (.md) ». Un ancien premier jet qui est un lien reste affiché comme lien.

## Exécution

Génération en arrière-plan (2 à 3 min) : POST répond 202, la page interroge l'état toutes les 3 s (même modèle que le lancement manuel de la veille). Un seul premier jet à la fois par utilisatrice. État en mémoire : un redémarrage l'oublie, la page le dit. Coût imputé et journalisé via genererStructure.

## Hors champ

- Lecture automatique du DCE, PDF, design Claude Design. Le Markdown se copie dans le document de son choix.
- Arrêt de la routine Notion : proposé à Jeanne une fois ceci en ligne.
- Ouverture à d'autres utilisatrices : le profil JMD est propre à Jeanne (même avertissement que la qualification) ; le passage automatique ne tourne que pour VEILLE_AO_USERS.
