# Metricool observé avec REA (23 nov. 2026)

But : s'inspirer du planificateur de Metricool pour Naya, via les API officielles des réseaux. Aucune API
privée de Metricool n'est ni ne sera utilisée.

Méthode : navigateur Chrome séparé (profil vide, sans session ni mot de passe) sur app.metricool.com/login ;
REA `inspect_web_page` puis `analyze_web_bundle` (Evidence ev_d07d4488…). 14 scripts publics de
static.metricool.com analysés sans lacune d'analyse. Le code du planificateur derrière la connexion n'a pas
été chargé (3 routes seulement) ; le modèle de données et les textes du planificateur sont en revanche
présents dans le cœur (2,4 Mo).

## Modèle d'un post programmé (champs observés)
draft, publishNow, autoPublish, publishOn, date, timezone, status, networks, media, text par réseau
(facebook, instagram, twitter, bluesky, threads…), firstCommentText, link, linkShortener, smartlinks,
tags, postLanguages, isSpoiler, replyControl / replySettings (Threads, X), shareAsInstagramStory,
showReelOnFeed, boost, notes / hasUnreadNotes, libraryPost, useTemplate, publishErrors, warnings.

## Modules du planificateur (clés de texte « planner »)
calendar, instagramFeed (aperçu grille), library (bibliothèque de posts), savedTexts, deletedPosts
(restauration), duplicateOtherBrands, bulkActions, notes, notifications, previews, history / postHistory,
approvalStatus, reviewers, reviewPortals (portail de validation sans compte), autolists.

## Autolists (créneaux récurrents)
autolistData : type, name, link, criteria, approvalCriteria / approvalEvents / approvalStatus, adresse
(street, city, state, country, latitude, longitude), instagramStoryTheme, shareAsInstagramStory, isSpoiler.

## Validation
approvalCriteria (un seul / tous / optionnel), reviewers par utilisateur ou par e-mail, portails de revue,
statut et historique d'approbation, « enregistrer sans validation » avec confirmation.

## Réglages par réseau
bestTimesNetworks (+ opacité / échelle de la carte de chaleur), altTextSupportedNetworks,
hashtagDiscoverySupportedNetworks, networkImageRestrictions (maxImageSize, maxWidth, maxHeight, maxMbSize),
threadsMaxPosts, twitterTaggableMediaTypes, publishableNetworksConnectors.
Formats spéciaux : linkedinPost / linkedinCarousel (document) / linkedinPoll, Google Business (gmbTypePost,
gmbTypePhoto), TikTok disableDuet, Instagram productTags, collaborators, audioName, documentTitle, pinterestBoard.

## Non observé (derrière la connexion)
Logique de calcul de la meilleure heure, écrans du planificateur, appels serveur du planificateur.
