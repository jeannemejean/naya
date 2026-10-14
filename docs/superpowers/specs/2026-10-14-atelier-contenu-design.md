# L'atelier de contenu — design

> Retour de Jeanne (14 oct. 2026) : « les tâches liées à la création de contenu ne sont pas hyper bien faites, l'utilisateur va passer sa journée à créer des posts ». Étudier les bonnes pratiques, rendre Naya intuitif.
> Choix de Jeanne : **approche A** (l'atelier de la semaine), **Naya publie seule** ce qui est validé, rythme de la partie 1 validé (« parfait, continue jusqu'à la fin »).

## Constat

- Un post de campagne = 3 à 5 tâches éparpillées sur 3 à 4 jours (Rédiger J-2, Visuel J-1, Relire J-1, Publier J0). 3 à 4 posts/semaine ≈ 12 à 16 petites tâches de contenu qui tombent tous les jours, sans plafond.
- La tâche « Rédiger le texte » s'ouvre sur une consigne d'une phrase : page blanche. Naya ne rédige qu'à la demande, dans le calendrier, post par post.
- Aucun moyen de faire plusieurs posts d'affilée.

## Bonnes pratiques retenues

1. **Une session par semaine** (60–90 min pour 3 à 7 posts) plutôt que du contenu tous les jours : coût de bascule (Gloria Mark, Sophie Leroy, « maker's schedule » de Paul Graham).
2. **Grouper par mode** : écrire les textes à la suite, puis les visuels ; **relire plus tard**, à froid, en une passe courte.
3. **L'outil pré-rédige dans la voix de la marque** ; la personne corrige plutôt que d'écrire (Hootsuite OwlyWriter, Typefully).
4. **Un seul écran par post** : texte modifiable sur place, visuels, date ; trois gestes — Valider / Corriger / Refaire avec une consigne courte (« plus court ») ; clavier pour enchaîner (Typefully, Kontentino, Planable).
5. **Validé = programmé**, jamais de publication sans validation humaine (Planable).

## 1. Le rythme (validé)

Pour chaque semaine (lundi → dimanche, heure de Paris) qui contient des posts à produire :

| Tâche | Jour | Durée |
|---|---|---|
| **Atelier contenu — semaine du 19 oct.** | 3 jours travaillés avant le premier post de la semaine ; jamais avant aujourd'hui ; jamais après la veille travaillée du premier post | somme des durées des posts (ci-dessous). Au-delà de 90 min : découpée en parties ≤ 90 min, sur les jours travaillés suivants (« (1/2) », « (2/2) ») |
| **Valider la semaine — 19 oct.** | le jour travaillé après la dernière partie, s'il reste avant la veille du premier post ; sinon pas de tâche (l'atelier vaut validation) | 5 min + 2 min par post, 20 min au plus |
| Tourner / Monter (vidéo seulement) | inchangé (J-3, J-2), jamais avant l'atelier | inchangé |

Durée d'un post dans l'atelier (texte pré-rédigé à relire + visuel) : image 15, texte 10, carrousel 30, vidéo (script) 15, story 10, long 45 minutes.

- Les tâches « Rédiger », « Préparer le visuel », « Structurer », « Rédiger les slides », « Designer les slides », « Écrire le script », « Préparer la story », « Construire le plan », « Mettre en forme », « Relire et valider » et « Publier » **ne sont plus créées**.
- Les tâches d'atelier sont des tâches ordinaires du planning (re-tassage, report) avec une **échéance** : la veille travaillée du premier post ; le re-tassage ne les pousse pas au-delà.
- **Une semaine, un atelier**, tous projets confondus (le mode agence y voit ses clients groupés par projet).
- Idempotent : relancer le placement ne crée pas de doublon ; un post ajouté à une semaine dont l'atelier est déjà fait crée un petit atelier de rattrapage ; un post ajouté avant l'atelier en allonge la durée.

## 2. L'écran de l'atelier

Adresse `/atelier?semaine=2026-10-19` (l'état est dans l'URL, ouvrable depuis une tâche, une notification, le calendrier).

- **En-tête** : « Semaine du 19 octobre », progression « 2 sur 5 validés », bouton « Tout valider » (posts prêts sans manque).
- **Colonne gauche** : la liste des posts (jour, heure, réseau, projet, pastille d'état : à rédiger / brouillon / validé / il manque…). Clic ou ↑↓ pour naviguer.
- **Centre, un post à la fois** :
  - la consigne du plan en petit (« L'idée : … ») ;
  - le texte, **modifiable sur place** (zone de texte, enregistrement automatique après une pause de frappe) ;
  - « Refaire » avec puces de consigne : *Plus court*, *Plus percutant*, *Plus personnel*, *Autre angle*, + champ libre ;
  - les visuels : dépôt (glisser-déposer ou bouton), ordre (composant existant) ;
  - le format (image / texte seul / carrousel / vidéo / story) modifiable : passer en « texte seul » lève l'exigence de visuel ;
  - jour et heure de publication modifiables ;
  - **Valider** (⌘/Ctrl + Entrée) : programme le post et passe au suivant non validé. Ce qui empêche de valider est dit en clair (« Ajoute un visuel : Instagram en exige un »).
- **Rédaction par Naya** : à l'ouverture, chaque post encore « à rédiger » est rédigé (3 en parallèle), avec squelette « Naya rédige… ». La rédaction démarre aussi en arrière-plan dès que l'atelier est posé dans le planning. Un post n'est jamais rédigé deux fois sans demande (« Refaire »).
- Fin : quand tout est validé, écran « Ta semaine est prête » et l'atelier (toutes ses parties) et la validation sont cochés.

Raccourcis : ⌘/Ctrl+Entrée valider, Alt+↓ / Alt+↑ post suivant / précédent (hors saisie : ↓ ↑ ou j k).

## 3. Valider un post

- **Validé** = `content_status = 'ready'`.
- Avec un compte connecté et sans problème de programmation → programmé (`auto_post = true`, comme le bouton « Programmer » du calendrier) : Naya le publie seule à son heure.
- Sans compte connecté pour ce réseau (`compte_absent`, `compte_expire`, `plateforme_non_supportee`) → validé quand même, **non programmé**, et une tâche « Publier — <titre> » de 5 min est posée le jour J à l'heure du post (le texte est prêt à copier dans la tâche).
- Manques bloquants (le post ne serait pas celui prévu) : texte vide ; date passée ; format image/story sans visuel ; carrousel avec moins de 2 visuels ; vidéo sans vidéo. Pour une vidéo, le script se valide dans l'atelier comme brouillon ; la validation finale se fait quand la vidéo est déposée (atelier, tâche « Monter », ou « Valider la semaine »).
- Valider un post archive ses anciennes tâches d'écran non faites (Rédiger, Visuel, Relire, Publier…) : elles n'ont plus d'objet. Tourner / Monter restent.
- « Dévalider » (annuler) remet le post en brouillon et annule la programmation ; la tâche Publier de secours éventuelle est archivée.

## 4. Les filets

- **La veille au matin** (passage quotidien de 06:00 UTC) : si des posts de demain ne sont pas validés, Naya prévient dans le compagnon : « 2 posts de demain ne sont pas validés : ils ne partiront pas. » avec un lien vers l'atelier.
- **Bascule des campagnes en cours** (même passage quotidien, et un script pour la faire tout de suite) : un post à venir dont **aucune** étape n'est faite et qui tombe à partir de demain perd ses anciennes tâches d'écran non faites (archivées, jamais supprimées) et rejoint l'atelier de sa semaine. Un post dont une étape est déjà faite garde son ancien parcours ; il apparaît aussi dans l'atelier et peut y être validé.

## 5. Planning et tâche

- La tâche d'atelier, ouverte depuis le planning, montre « 5 posts · 2 validés » et un bouton principal « Ouvrir l'atelier ».
- La tâche « Monter — … » d'une vidéo montre le bouton « Valider et programmer » une fois la vidéo déposée.
- Le calendrier de contenu garde tout ; un lien « Atelier de la semaine » y mène à l'atelier.

## Données

- **Migration** : `content.consigne` (texte, facultatif) — la consigne du plan, mise de côté quand Naya rédige le texte (le texte devient le brouillon). Sert aussi de verrou : rédiger = poser la consigne si elle est vide (une seule rédaction automatique par post).
- Tâches d'atelier : `task_type` = `atelier_contenu` | `atelier_validation`, `action_data` = `{ semaine, partie, parties, echeance }`. Pas de nouvelle colonne.

## Hors périmètre

- Génération d'images par l'IA.
- Banque d'idées, réutilisation d'une pièce en plusieurs formats.
- Application mobile (le serveur est prêt ; l'écran viendra).

## Arbitrages pris sans Jeanne

- 3 jours travaillés avant le premier post (dans la fourchette « 3 à 4 » annoncée) : laisse un jour pour la validation à froid et un pour Tourner/Monter.
- Un post manuel du calendrier (hors campagne) apparaît dans l'atelier de sa semaine s'il n'est ni validé ni programmé, mais ne crée pas d'atelier à lui seul.
- Validation possible même sans compte connecté (avec la tâche Publier de secours), pour ne jamais bloquer le travail.
