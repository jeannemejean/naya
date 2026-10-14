// Capture UNE réponse réelle du dataset Instagram pour vérifier l'adaptateur.
// Usage : npx tsx scripts/capturer-instagram.ts <compte> — affiche les clés et le résultat lu.
import "dotenv/config";
import { collecterParLot, instagramDataset } from "../server/services/brightdata-enrich";
import { lireProfilInstagram } from "../server/services/profils-veille/collecte/instagram";

const compte = process.argv[2];
const ds = instagramDataset();
if (!compte || !ds) { console.error("usage : npx tsx scripts/capturer-instagram.ts <compte> (BRIGHT_DATA_INSTAGRAM_DATASET requis)"); process.exit(1); }
const rows = await collecterParLot(ds, [`https://www.instagram.com/${compte}/`]);
const r = rows?.[0];
console.log("Clés du profil :", r ? Object.keys(r) : rows);
console.log("Clés d'un post :", r?.posts?.[0] ? Object.keys(r.posts[0]) : "aucun post");
console.log(JSON.stringify(lireProfilInstagram(r), null, 2).slice(0, 3000));
