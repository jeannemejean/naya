import "dotenv/config";
// Banc d'évaluation du classement des formats : compare Naya aux étiquettes posées par Jeanne.
// Usage : npx tsx scripts/evaluer-classement.ts — coûte quelques centimes (modèle rapide).
// Seuil : 75 % d'accord sur la structure avant d'ouvrir le lot 1 à toutes (PROFILS_VEILLE_POUR_TOUS=true).
import { stockageProfils } from "../server/services/profils-veille/stockage";
import { depsAnalyse } from "../server/services/profils-veille/deps";

const SEUIL = 0.75;
const posts = await stockageProfils.postsEtiquetes();
if (posts.length < 40) { console.error(`Seulement ${posts.length} posts étiquetés : il en faut 40.`); process.exit(1); }
let accordStructure = 0, accordAccroche = 0;
const desaccords: string[] = [];
for (let i = 0; i < posts.length; i += 20) {
  const lot = posts.slice(i, i + 20);
  const { resultats } = await depsAnalyse.classer(lot.map((p) => ({ id: p.id, typeMedia: p.typeMedia, legende: p.legende })));
  for (const p of lot) {
    const r = resultats.find((x) => x.id === p.id);
    if (r?.structure === p.structure) accordStructure++; else desaccords.push(`#${p.id} toi=${p.structure} naya=${r?.structure ?? "—"} « ${(p.legende ?? "").slice(0, 80)} »`);
    if (r?.accroche === p.accroche) accordAccroche++;
  }
}
const taux = accordStructure / posts.length;
console.log(`Structure : ${(taux * 100).toFixed(0)} % d'accord (${accordStructure}/${posts.length})`);
console.log(`Accroche : ${((accordAccroche / posts.length) * 100).toFixed(0)} % d'accord`);
if (desaccords.length) console.log("Désaccords :\n" + desaccords.join("\n"));
process.exit(taux >= SEUIL ? 0 : 1);
