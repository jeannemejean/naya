# Reprise intelligente des tâches non faites — 26 oct. 2026

## Le constat

« Valider la semaine — 26 oct. » posée le mardi 27, l'atelier de la même semaine le
mercredi 28, et l'atelier de la semaine du 12 oct. (reporté 7 fois) le même mardi. Rien de
tout ça n'a été décidé : deux reports aveugles (`rolloverStaleTasks` à 6 h,
`runEndOfDayRollover` à 19 h) poussaient chaque soir toute tâche non faite au jour ouvré
suivant, par priorité, sans rien savoir de son échéance, de son ordre, ni de ce qu'elle
servait. L'atelier de la semaine du 26 avait pour échéance le 23 : il est passé au-delà.

Jeanne (26 oct.) : « je ne veux pas que les tâches soient simplement poussées. Je veux que
Naya les reprenne par rapport aux objectifs et au fonctionnement de l'utilisateur, les
modifie et les replace dans le calendrier, pour qu'on arrive toujours à l'objectif. »

Arbitrages de Jeanne :
- Naya agit **seule**, et le lendemain une carte « Ce que j'ai repris » liste chaque
  changement avec son pourquoi et un bouton Annuler.
- Une tâche qui ne sert plus est **archivée** (jamais supprimée), restaurable en un clic.

## Le passage de reprise (`server/services/reprise/`)

Un seul passage remplace les deux reports. Il tourne le soir (fin de journée : ce qui
reste est repris dès le prochain jour ouvré), le matin (filet : ce qui reste dans le
passé, sur aujourd'hui) et au redémarrage de la planification.

1. **Tri** (`tri.ts`, pur) — chaque tâche en retard a un propriétaire :
   - **rituel** : l'occurrence manquée est archivée, le rituel revient à sa date ;
   - **validation de prospection**, **jalon** : déjà gérés ailleurs, intouchés ;
   - **étape d'un post** : archivée si le post est parti ou sa date passée ; sinon
     replacée avant son échéance (`echeanceTache`), sans être réécrite ;
   - **atelier / valider la semaine** : archivés si la semaine n'a plus de post à
     produire ; sinon replacés dans l'ordre — les parties d'abord, la validation après
     (le lendemain si la date du premier post le permet). Les semaines dont l'ordre est
     cassé sont aussi remises d'aplomb, même sans tâche en retard ;
   - **libre** : tout le reste, confié à Naya.
2. **Décision** (`decision.ts`) — un appel structuré (zod, `genererStructure`) reçoit le
   contexte complet (`buildNayaContext` : objectifs et leurs échéances, jalons, profil de
   fonctionnement), les tâches libres (reports, ancienneté, projet, objectif), la charge
   des 10 prochains jours ouvrés et ce qui a été fait la semaine passée. Pour chaque tâche :
   `garder`, `reformuler`, `decouper` (2 à 5 sous-tâches), `fusionner` (avec d'autres
   tâches de la liste) ou `abandonner`, avec une priorité, une date « au plus tard » tirée
   de l'objectif, et une raison d'une phrase adressée à l'utilisatrice. La réponse est
   normalisée (chaque tâche exactement une fois, ids inconnus ignorés, bornes de durée).
   **Sans IA** (panne, budget atteint) : tout est gardé, le placement reste intelligent.
3. **Placement** (`placement.ts`, pur) — par échéance puis priorité, au premier jour
   ouvré qui a la place (trou réel dans la journée, plafond de tâches de
   `maxTasksForDay`, jours off exclus), jamais après l'échéance quand c'est possible. Les
   sous-tâches se suivent. Puis `fixOverlappingTasks` re-tasse et rétablit les invariants.
4. **Journal** (`reprises_taches`) — une ligne par tâche touchée : action, raison, état
   avant / après, tâches créées ou absorbées. Il nourrit la carte du matin et l'annulation.

## Ce qui disparaît

- Le report aveugle et son plafond de 8 (les tâches au-delà restaient dans le passé).
- Les relances « On la reformule, on la garde, ou on l'abandonne ? » : Naya tranche.
- Une tâche `auto` reportée sur un jour n'empêche plus la génération de ce jour
  (`capaciteRestanteDuJour`) : elle y prend sa place, sans plus.

## Vérifié sur une copie de la production (26 oct., branches Neon d'essai)

- Matin : les quatre tâches d'atelier des semaines du 12 et du 19 oct. archivées (plus de
  post à produire) ; « Valider la semaine — 26 oct. » replacée après son atelier.
- Soir simulé (les 5 tâches libres du jour non faites), sans avis de Naya (clé locale
  invalide : le secours a joué) : toutes replacées entre le 27 et le 29, aucune journée
  au-delà du 30 modifiée.
- Deux défauts trouvés par l'essai, corrigés :
  - le seul plafond en nombre de tâches renvoyait des tâches au 6 et au 10 nov. alors que
    la semaine avait des trous → une tâche reprise reste dans les 5 jours ouvrés qui
    viennent dès qu'une journée a un vrai trou ;
  - la grille ignorait l'agenda : la vérification en base décalait une tâche à 17 h 35
    (fin de journée 18 h) et le re-tassage la poussait jusqu'au 17 nov. → l'agenda entre
    dans la grille, et un créneau qui finit après la journée est refusé (jour suivant).
- Non vérifié sur données réelles : la qualité des décisions du modèle (reformuler,
  découper, fusionner, abandonner). Couvert par les tests ; à relire dans le journal
  `reprises_taches` après le premier passage du soir en production.

## Les posts jamais partis (ajout du 26 oct., après mise en ligne)

Constaté par Jeanne le jour même : neuf posts du 14 au 23 oct. (brouillons ou validés)
restaient datés de la semaine passée. Choix de Jeanne : Naya décide seule.

- Étape 0 du passage, avant le tri : chaque post daté d'avant le jour de reprise, jamais
  parti (un mois en arrière au plus), est **reprogrammé** (il sert encore sa campagne) ou
  **retiré du calendrier** (date effacée, ses étapes archivées ; « Restaurer » le remet
  le lendemain à son heure). Avis du modèle (`posts.ts`, `SCHEMA_POSTS`) ; sans avis, tout
  est reprogrammé.
- Jour d'un post reprogrammé : un jour travaillé, au plus tôt deux jours après la reprise
  pour un brouillon (le temps de l'atelier et de la validation), un pour un post validé ;
  un post par plateforme et par jour ; la série garde son ordre ; l'heure d'origine (Paris).
- L'atelier des semaines qui reçoivent ces posts est posé ou ajusté (`placerAteliers`).
- Dans une journée, les parties d'atelier se suivent et la validation vient en dernier
  (`ordreAtelierDansLaJournee`) : le re-tassage, qui range par heure, ne le savait pas.
- Le journal porte une tâche OU un post (`reprises_taches.content_id`, migration 0034).

Essai sur copie de la production : 9 posts reprogrammés du mar. 27 oct. au lun. 9 nov.,
en semaine ; les ateliers des semaines du 12 et du 19 oct. archivés ; ceux du 26 oct. et du
2 nov. dans l'ordre (parties puis validation).
