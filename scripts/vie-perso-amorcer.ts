// Amorce la Vie perso de Jeanne à partir de son plan de repas (plan-repas-jeanne-v2.html) et de
// sa liste de courses (courses_3semaines_v2.docx). N'écrit que si rien n'existe encore :
// profil absent, foyer vide. Usage : VIE_PERSO_USER=<id> npx tsx scripts/vie-perso-amorcer.ts
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { viePersoMembres, viePersoProfil, viePersoRecettes } from "@shared/schema";
import { PROFIL_DEFAUT, type ProfilViePerso } from "@shared/vie-perso";

const userId = process.env.VIE_PERSO_USER;
if (!userId) throw new Error("VIE_PERSO_USER requis");

const PROFIL: ProfilViePerso = {
  ...PROFIL_DEFAUT,
  heureDejeuner: "12:00",
  heureDiner: "19:30",
  batchJour: 0, batchHeure: "10:00", batchDureeMax: 120,
  coursesJour: 6, coursesHeure: "10:00", coursesDuree: 75,
  jeune: "16:8 : rien avant le déjeuner de 12 h ; déjeuner à 12 h pile",
  equipement: ["Thermomix", "four", "poêle", "plaques"],
  magasins: ["Picard", "Aldi"],
  placard: ["huile d'olive", "cumin", "paprika fumé", "cannelle", "curry en poudre", "origan", "sel", "poivre", "moutarde", "vinaigre", "sirop d'érable", "flocons d'avoine"],
};

const MEMBRES = [
  {
    prenom: "Jeanne", estMoi: true,
    regime: "1 400 kcal par jour (P 140 g, L 50 g, G 98 g), index glycémique bas, anti-inflammatoire, low-carb ; dessert du soir prévu chaque jour (chocolat noir 85 %, yaourt grec, fruits)",
    exclusions: "légumineuses lourdes (lentilles corail sans peau tolérées) ; biscuits et nuggets industriels ; fromages fondus gras le soir",
    aime: "cuisine japonaise et asiatique (bowls, miso, gyoza, teriyaki), saumon, poulet, poisson, méditerranéen, plateaux froids",
    aimePas: "",
    repasMaison: "les_deux",
  },
  {
    prenom: "Milan", estMoi: false,
    regime: "confort franco-italien-japonais ; mêmes plats que Jeanne avec plus de féculents (riz, pâtes, pain, pommes de terre)",
    exclusions: "", aime: "pâtes, ramen, carbonara, steak frites, pain, charcuterie", aimePas: "",
    repasMaison: "les_deux",
  },
];

const RECETTES = [
  "Bowl saumon teriyaki", "Poulet paprika-cumin et patate douce rôtie", "Wok bœuf gingembre", "Saumon miso-sésame",
  "Tartare de thon à la japonaise", "Gyoza maison", "Buddha bowl quinoa poulet tahini", "Cabillaud en papillote",
  "Maquereaux grillés sauce vierge", "Banana nice cream", "Panna cotta coco", "Nuggets maison au parmesan",
].map((titre) => ({ titre, avis: "aime" as const }));

const [dejaProfil] = await db.select().from(viePersoProfil).where(eq(viePersoProfil.userId, userId));
if (!dejaProfil) await db.insert(viePersoProfil).values({ userId, reglages: PROFIL });
const dejaMembres = await db.select().from(viePersoMembres).where(eq(viePersoMembres.userId, userId));
if (dejaMembres.length === 0) await db.insert(viePersoMembres).values(MEMBRES.map((m) => ({ ...m, userId })));
const dejaRecettes = await db.select().from(viePersoRecettes).where(eq(viePersoRecettes.userId, userId));
if (dejaRecettes.length === 0) await db.insert(viePersoRecettes).values(RECETTES.map((r) => ({ ...r, userId })));
console.log(`profil ${dejaProfil ? "déjà là" : "créé"} ; foyer ${dejaMembres.length ? "déjà là" : "créé"} ; inspirations ${dejaRecettes.length ? "déjà là" : "créées"}`);
process.exit(0);
