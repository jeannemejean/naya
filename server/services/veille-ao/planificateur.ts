// Veille AO : le passage quotidien, à 06:49 heure de Paris, pour les utilisatrices inscrites.
//
// Inscription : VEILLE_AO_USERS (voir etat.ts).
//
// Un tour toutes les 5 minutes ; le passage du jour part au premier tour après 06:49 (Paris),
// rattrapé jusqu'à midi si le serveur redémarrait pile à l'heure. Un seul tour à la fois ;
// les erreurs sont journalisées, jamais levées.
import { lancerVeilleAO, type BilanVeilleAO, type DepsVeilleAO } from "./pipeline";
import { utilisatricesVeilleAO } from "./etat";

export { utilisatricesVeilleAO };

export const HEURE_VEILLE_AO = { heure: 6, minute: 49 };
const FIN_RATTRAPAGE_MINUTES = 12 * 60;


export function heureParis(d: Date): { jour: string; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function doitLancer(maintenant: Date, dernierJour: string | null): boolean {
  const { jour, minutes } = heureParis(maintenant);
  const debut = HEURE_VEILLE_AO.heure * 60 + HEURE_VEILLE_AO.minute;
  return jour !== dernierJour && minutes >= debut && minutes < FIN_RATTRAPAGE_MINUTES;
}

let dernierJour: string | null = null;
let tourEnCours = false;

export function _reinitialiserVeilleAO(): void { dernierJour = null; tourEnCours = false; }

/** Un tour du planificateur. Renvoie les bilans du passage s'il a eu lieu, sinon null. */
export async function tourVeilleAO(
  maintenant: Date, deps: DepsVeilleAO, users: string[],
): Promise<Record<string, BilanVeilleAO | null> | null> {
  if (tourEnCours || users.length === 0 || !doitLancer(maintenant, dernierJour)) return null;
  tourEnCours = true;
  dernierJour = heureParis(maintenant).jour;
  const bilans: Record<string, BilanVeilleAO | null> = {};
  try {
    for (const u of users) {
      try {
        const b = await lancerVeilleAO(u, deps, { maintenant });
        bilans[u] = b;
        if (b) console.log(`[veille-ao] ${u} : ${b.nouveaux} nouveaux, ${b.rafraichis} rafraîchis, ${b.examines} examinés, ${b.coutEur.toFixed(3)} €${b.erreursSources.length ? ` (sources en erreur : ${b.erreursSources.join(" ; ")})` : ""}`);
      } catch (e: any) {
        console.error(`[veille-ao] ${u} :`, e?.message ?? e);
      }
    }
  } finally {
    tourEnCours = false;
  }
  return bilans;
}

export function scheduleVeilleAO(): void {
  const users = utilisatricesVeilleAO();
  if (users.length === 0) {
    console.log("[veille-ao] désactivée (VEILLE_AO_USERS vide)");
    return;
  }
  const tick = async () => {
    try {
      const { depsVeilleAO } = await import("./deps");
      await tourVeilleAO(new Date(), depsVeilleAO, utilisatricesVeilleAO());
    } catch (e: any) {
      console.error("[veille-ao] tour :", e?.message ?? e);
    }
  };
  setInterval(tick, 5 * 60_000);
  setTimeout(tick, 30_000);
  console.log(`[veille-ao] planifiée chaque jour à 06:49 (Paris) pour ${users.length} utilisatrice(s)`);
}
