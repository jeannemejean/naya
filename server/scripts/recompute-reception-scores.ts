/**
 * LANCEUR du rattrapage historique des scores de réception. Toute la logique — et toute la
 * doctrine — vit dans `server/services/reception/recompute.ts` : elle est PARTAGÉE avec le
 * rafraîchissement à chaud déclenché par les routes de conversion (voir
 * `refreshReceptionForContents`), pour qu'il n'existe jamais deux recalculs à faire
 * diverger. Ce fichier ne fait qu'ouvrir l'environnement et rendre compte.
 *
 *   NODE_ENV=development npx tsx server/scripts/recompute-reception-scores.ts
 */

import "dotenv/config";
import { recomputeReceptionScores } from "../services/reception/recompute";

recomputeReceptionScores()
  .then((result) => {
    console.log(
      `[recompute-reception-scores] lignes scannées : ${result.scanned}, ` +
        `mises à jour : ${result.updated}, entrées mémoire périmées : ${result.memorySuperseded}, ` +
        `erreurs : ${result.errors.length}`,
    );
    if (result.errors.length > 0) console.error(result.errors);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[recompute-reception-scores] échec :", err);
    process.exit(1);
  });
