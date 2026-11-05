# Agent omniscient (lot 1) — points reportés

Relevés par les relectures, jugés non bloquants. À reprendre au lot 2 ou au fil de l'eau.

- Task 1: minor (deferred): majProposition sans condition statut → double validation concurrente possible — À PORTER EN T9 (update conditionnel statut='en_attente')
- Task 1: minor (deferred): empreinte typée unknown ; index unique (source,source_id) sans user_id (ids serial globaux, commenter en T4)
- Task 2: minor (deferred): getMilestone non scopé dans creerTache (jalon d'une autre accepté s'il n'est pas locked) — non exploitable par l'agent en lot 1 (creer_tache n'expose pas milestoneId) ; à trier en revue finale
- Task 2: minor (deferred → T7): décocher ne remet pas completedAt à null ; l'annulation T7 doit restaurer completedAt depuis avant
- Task 2: minor (deferred): pas de test service du décalage de créneau ni de fixOverlappingTasks sur PATCH
- Task 3: minor (deferred → T4): dates depuis/jusqua non validées (une date invalide du modèle fait échouer toute la recherche) ; ORDER BY sur updated_at nullable (NULLS first)
- Task 3: minor (deferred): plafond 30/source par date avant score ; jointure projects non scopée ; date de lire = updatedAt de la dernière créée ; tests filtres sur 2/8 sources ; archivées incluses ; conversations ignorées si projetId
- Task 4: minor (deferred, à signaler à Jeanne): les embeddings (mémoire existante ET nouvel indexeur) ne passent pas par recordSpend/logInvocation — coût OpenAI de fond non compté dans les budgets
- Task 4: minor (deferred): refus inconnu traité comme panne globale (ligne en tête de file) ; Set misDeCote en mémoire
- Task 5: minor (deferred): appelerClaudeAvecOutils sans garde provider anthropic ; échec d'appel API non journalisé ; règle marque-sujet (ne pas demander de marque pour rythme/énergie) perdue dans consignes ; test "sans fin" mockReset fragile ; texte intermédiaire du modèle perdu
- Task 5: fix round 1 implementer DONE 56ca45e ; re-review dispatched. minor (deferred): buildNayaContext lit le projet sans userId pour les autres appelants
- Task 6: minor (deferred): consulter_contenus filtre après le plafond de 100 (note trompeuse) ; mesures limitées à 24 mois ; noms de projet au-delà de 200 projets
- Task 7: minor (deferred): double annulation concurrente (claim conditionnel annulee_at IS NULL) — même motif que T1/T9 ; écritures multi-lignes non atomiques ; creer_liste sans validation de types ; handlers qui lèvent en phase d'écriture ; pas de test HTTP de la route annuler
- Task 7: fix round 1 implementer DONE 5d6bfd9 ; re-review dispatched. minor (deferred): annuler un déplacement ne remet pas les tâches décalées par fixOverlappingTasks
- Task 8: minor (deferred): aller-retour retrieveMemories testé seulement pour cap (founder/savoir non) ; fake db fragile (else = null_seul) ; souvenir savoir+projet invisible sous une autre marque
- Task 9: minor (deferred): outil retiré du registre laisse la proposition en_attente ; deplacer_taches accepte une date passée ; saisir_mesure sans garde objet sur champs ; confirmer_jalon et creer_projet empreintes partielles
- Task 10: minor (deferred): historique rechargé ne connaît pas l'état final (Annuler/Valider réaffichés → 409 propre) ; Ajuster annule aussi les propositions rechargées ; boutons non grisés en direct à l'expiration ; 2 chaînes FR en dur préexistantes dans onError
- Task 11: minor (deferred): clés à invalider écrites 3 fois ; Ajuster fire-and-forget ; boutons non grisés en direct ; pas de test (pas de runner mobile)
