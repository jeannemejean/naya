# Photos de saison

Une photo par jour sur le bloc d'accueil (`HeroSaison`), choisie dans le dossier de la saison
(`automne/`, `hiver/`, `printemps/`, `ete/`). Sans photo, le bloc prend la couleur de la saison.

## Format attendu

- **WebP**, **1 600 px de large** (paysage), **200 Ko au plus**.
- Nommées dans l'ordre : `1.webp`, `2.webp`, `3.webp`…
- Ambiance cocon, lumière basse ; laisser de la place à gauche pour le texte.
- Le texte blanc est posé sur un voile sombre à gauche : vérifier un contraste ≥ 4,5:1
  dans la zone de texte pour chaque nouvelle photo.

## Ajouter une photo

1. Déposer le fichier dans le dossier de la saison, par exemple `client/public/saisons/automne/1.webp`.
2. **L'ajouter à `PHOTOS_SAISON`** dans `shared/saisons.ts`, sinon elle n'est jamais affichée :

   ```ts
   automne: ["/saisons/automne/1.webp", "/saisons/automne/2.webp"],
   ```
