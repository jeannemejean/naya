// Étape 5 du chef d'orchestre : la revue du dimanche soir et le bilan calculé à la demande.
// Branché sur la base ; la logique pure est dans revue-semaine.ts.
import { storage } from "../../storage";
import { parisTodayString } from "../../utils/timezone";
import { DAY_ABBRS, parseWorkDays } from "../campagne/placement";
import { filActifPour } from "../fil/interrupteur";
import { bilanSemaine, estMomentDeLaRevue, semaineARevoir, type BilanSemaine } from "./revue-semaine";

const plus = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const min = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };

/** Le bilan de la semaine qui commence le lundi `semaine` (calculé, jamais stocké). */
export async function calculerBilanSemaine(userId: string, semaine: string, maintenant = new Date()): Promise<BilanSemaine> {
  const prefs: any = await storage.getUserPreferences(userId).catch(() => null);
  const travailles = parseWorkDays(prefs?.workDays);
  const jours = Array.from({ length: 7 }, (_, i) => plus(semaine, i))
    .filter((j) => travailles.has(DAY_ABBRS[new Date(`${j}T12:00:00Z`).getUTCDay()]));
  const dejeuner = prefs?.lunchBreakEnabled !== false
    ? Math.max(0, min(prefs?.lunchBreakEnd || "13:00") - min(prefs?.lunchBreakStart || "12:00")) : 0;
  const capaciteMin = Math.max(60, min(prefs?.workDayEnd || "18:00") - min(prefs?.workDayStart || "09:00") - dejeuner);
  const taches = await storage.getTasksInRange(userId, semaine, plus(semaine, 6));
  return bilanSemaine(taches as any[], { jours, capaciteMin, aujourdhui: parisTodayString(maintenant), semaine });
}

/**
 * La revue : jalons d'AO, tri du vivier (reprise vers lundi), ateliers, re-tassage depuis lundi,
 * puis le bilan journalisé. Chaque étape est consignée en cas d'échec et n'arrête pas la suivante.
 */
export async function revueDeLaSemaine(userId: string, maintenant = new Date()): Promise<BilanSemaine> {
  const aujourdhui = parisTodayString(maintenant);
  const lundi = semaineARevoir(aujourdhui);
  const etape = async (nom: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e: any) { console.error(`[orchestre] revue de la semaine, ${nom} user=${userId} :`, e?.message); }
  };
  await etape("jalons AO", async () => {
    const [{ synchroniserJalonsAO }, { depsJalonsAO }] = await Promise.all([import("./jalons-ao"), import("./jalons-ao-deps")]);
    await synchroniserJalonsAO(userId, maintenant, depsJalonsAO);
  });
  await etape("vivier", async () => {
    const [{ reprendreTaches }, { depsReprise }] = await Promise.all([import("../reprise"), import("../reprise/deps")]);
    await reprendreTaches(await depsReprise(), { userId, aujourdhui, cible: lundi, inclureAujourdhui: true });
  });
  await etape("ateliers", async () => (await import("../atelier/deps")).passageAtelierMatin(userId));
  await etape("re-tassage", () => storage.fixOverlappingTasks(userId, lundi));
  const bilan = await calculerBilanSemaine(userId, lundi, maintenant);
  console.log(`[orchestre] revue de la semaine du ${lundi} user=${userId} : ${bilan.occupeMin}/${bilan.capaciteMin} min, ${bilan.risques.length} risque(s)`, JSON.stringify(bilan.parFlux));
  return bilan;
}

const faites = new Set<string>(); // `${userId}:${lundi}` : une revue par semaine et par processus

/** Toutes les 15 min : le dimanche à partir de 18 h (Paris), une revue par utilisatrice du fil. */
export function scheduleRevueSemaine(): void {
  const tour = async () => {
    const maintenant = new Date();
    if (!estMomentDeLaRevue(maintenant)) return;
    const lundi = semaineARevoir(parisTodayString(maintenant));
    const ids = await storage.getActiveUserIds().catch(() => [] as string[]);
    for (const userId of ids) {
      const cle = `${userId}:${lundi}`;
      if (!filActifPour(userId) || faites.has(cle)) continue;
      faites.add(cle);
      await revueDeLaSemaine(userId, maintenant).catch((e: any) => console.error(`[orchestre] revue de la semaine user=${userId} :`, e?.message));
    }
  };
  setInterval(() => { tour().catch(() => {}); }, 15 * 60_000);
  tour().catch(() => {});
}
