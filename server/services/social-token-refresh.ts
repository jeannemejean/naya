import { storage } from "../storage";
import { etatConnexion, doitEtreRafraichie } from "./social-connection-state";

/**
 * Renouvellement des jetons d'accès aux réseaux sociaux.
 *
 * Pourquoi ce module existe. Le 18 septembre 2026, les deux comptes de la production étaient
 * morts depuis 56 et 26 jours — sans que rien ne tente de les renouveler, et sans que rien ne
 * le signale. Google Calendar, dans ce même dépôt, rafraîchit son jeton depuis toujours. Les
 * réseaux sociaux n'avaient jamais eu l'équivalent.
 *
 * Le module est séparé en deux : ce qui DÉCIDE est pur et testé, ce qui appelle le réseau est
 * mince et ne décide de rien.
 */

export interface ReponseJeton {
  accessToken: string;
  /** Absent quand la plateforme n'en renvoie pas — l'ancien doit alors être CONSERVÉ. */
  refreshToken?: string;
  /** `null` = la plateforme n'a pas dit combien de temps. On ne l'invente pas. */
  expiresAt: Date | null;
}

/**
 * Lit une réponse de renouvellement. PURE.
 *
 * Cette fonction décide de ce qui sera écrit PAR-DESSUS un jeton existant. Sans
 * `access_token` exploitable elle ne renvoie rien du tout : écrire une valeur vide sur un
 * jeton qui fonctionne transformerait un renouvellement raté en déconnexion — une panne
 * causée par la tentative de réparation.
 */
export function lireReponseJeton(brut: unknown, now: Date): ReponseJeton | null {
  // Pas de test Array.isArray : un tableau n'a pas d'`access_token`, il tombe donc déjà sur
  // le garde suivant. Un garde inatteignable laisserait croire qu'il protège.
  if (typeof brut !== "object" || brut === null) return null;
  const o = brut as Record<string, unknown>;

  const acces = typeof o.access_token === "string" ? o.access_token.trim() : "";
  if (!acces) return null;

  const refresh = typeof o.refresh_token === "string" && o.refresh_token.trim()
    ? o.refresh_token.trim()
    : undefined;

  // `expires_in` absent ou aberrant → échéance INCONNUE, jamais inventée. L'échange initial,
  // ailleurs dans ce dépôt, met 60 jours par défaut ; c'est ce genre de supposition qui a
  // produit des comptes affichés « Connecté » avec des jetons morts.
  const secondes = typeof o.expires_in === "number" && Number.isFinite(o.expires_in) && o.expires_in > 0
    ? o.expires_in
    : null;

  return {
    accessToken: acces,
    refreshToken: refresh,
    expiresAt: secondes === null ? null : new Date(now.getTime() + secondes * 1000),
  };
}

export interface CompteRafraichissable {
  id: number;
  platform: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  isActive?: boolean | null;
  expiresAt?: Date | null;
}

/**
 * Comptes à renouveler, les plus urgents d'abord. PURE.
 *
 * Un compte sans jeton de rafraîchissement est écarté : c'est le cas d'Instagram en
 * production, et tenter quand même consommerait un appel pour un échec certain, à chaque
 * passage du worker.
 */
export function comptesARafraichir<T extends CompteRafraichissable>(comptes: T[], now: Date): T[] {
  return (comptes ?? [])
    .filter((c) => {
      if (!c.refreshToken || !String(c.refreshToken).trim()) return false;
      const etat = etatConnexion({
        accessToken: c.accessToken,
        isActive: c.isActive,
        expiresAt: c.expiresAt ?? null,
        now,
      });
      return doitEtreRafraichie(etat);
    })
    // Si un quota limite les appels, les plus proches de la mort passent en premier.
    .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0));
}

/** Appel réseau par plateforme. Ne décide de rien : rend la réponse brute, ou `null`. */
async function demanderRenouvellement(compte: CompteRafraichissable): Promise<unknown | null> {
  const base = compte.platform.startsWith("linkedin") ? "linkedin" : compte.platform;

  if (base === "linkedin") {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: String(compte.refreshToken),
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    return res.json();
  }

  if (base === "tiktok") {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) return null;
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: String(compte.refreshToken),
      }),
    });
    return res.json();
  }

  // Instagram n'utilise PAS de refresh_token : il échange le jeton d'accès lui-même, et
  // seulement tant qu'il est vivant. Un compte Instagram n'arrive donc jamais ici —
  // `comptesARafraichir` l'écarte faute de refresh_token. C'est documenté plutôt que tenté :
  // un jeton Instagram mort exige une reconnexion manuelle, quoi qu'on écrive.
  return null;
}

/**
 * Passe sur tous les comptes et renouvelle ce qui peut l'être.
 *
 * Ne lève jamais : un réseau indisponible ne doit pas faire tomber le worker, et surtout pas
 * effacer un jeton. En cas d'échec, le compte reste EXACTEMENT dans l'état où il était.
 */
export async function rafraichirJetonsSociaux(now: Date = new Date()): Promise<{
  tentes: number;
  renouveles: number;
}> {
  let tentes = 0;
  let renouveles = 0;

  try {
    const userIds = await storage.getActiveUserIds().catch(() => [] as string[]);
    for (const userId of userIds) {
      const comptes = await storage.getSocialAccounts(userId).catch(() => [] as any[]);
      for (const compte of comptesARafraichir(comptes as any[], now)) {
        tentes += 1;
        try {
          const brut = await demanderRenouvellement(compte);
          const jeton = lireReponseJeton(brut, now);
          if (!jeton) {
            console.warn(
              `[TokenRefresh] ${compte.platform} (compte ${compte.id}) : renouvellement refusé — jeton INCHANGÉ.`,
            );
            continue;
          }
          if (!jeton.expiresAt) {
            console.warn(
              `[TokenRefresh] ${compte.platform} (compte ${compte.id}) : renouvelé SANS échéance. ` +
                `La prochaine mort ne sera pas anticipée.`,
            );
          }
          await storage.updateSocialAccount(compte.id, userId, {
            accessToken: jeton.accessToken,
            // Jamais `undefined` écrit par-dessus un refresh_token existant : certaines
            // plateformes ne le renvoient qu'à la première émission.
            ...(jeton.refreshToken ? { refreshToken: jeton.refreshToken } : {}),
            expiresAt: jeton.expiresAt,
            lastSyncAt: now,
          } as any);
          renouveles += 1;
          console.log(`[TokenRefresh] ${compte.platform} (compte ${compte.id}) renouvelé.`);
        } catch (e: any) {
          console.error(`[TokenRefresh] ${compte.platform} (compte ${compte.id}):`, e?.message ?? e);
        }
      }
    }
  } catch (e: any) {
    console.error("[TokenRefresh] passage interrompu:", e?.message ?? e);
  }

  return { tentes, renouveles };
}

/** Toutes les six heures : bien avant la marge de sept jours, sans marteler les plateformes. */
const INTERVALLE_MS = 6 * 60 * 60 * 1000;

export function scheduleTokenRefresh(): void {
  console.log("[TokenRefresh] Worker démarré (toutes les 6 h)");
  const passer = () => {
    rafraichirJetonsSociaux()
      .then(({ tentes, renouveles }) => {
        if (tentes > 0) console.log(`[TokenRefresh] ${renouveles}/${tentes} renouvelé(s).`);
      })
      .catch((e) => console.error("[TokenRefresh] erreur non rattrapée:", e));
  };
  passer();
  setInterval(passer, INTERVALLE_MS);
}
