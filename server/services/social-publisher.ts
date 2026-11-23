/**
 * Worker d'auto-publication des posts programmés.
 *
 * Publie automatiquement les contenus du calendrier dont l'heure de publication
 * (`scheduledFor`) est atteinte, sur les comptes sociaux déjà connectés via OAuth
 * (LinkedIn, X/Twitter, Instagram, Facebook). Aucune dépendance tierce payante :
 * réutilise les fonctions de publication existantes (socialMediaService).
 *
 * Déclenchement d'un post :
 *   autoPost = true ET postStatus = 'pending' ET publishedAt IS NULL
 *   ET scheduledFor <= maintenant
 *
 * Anti double-publication : claim atomique pending → posting avant l'appel réseau.
 */
import { storage } from '../storage';
import { socialMediaService } from './social-integrations';
import { publishPost, igFinishAsync, tiktokFinishAsync } from './social-publishers';
import { formatDePublication, plateformeDe } from '@shared/programmation';
import { compteDePublication } from './connexions/comptes';
import { db } from '../db';
import { content, tasks } from '@shared/schema';
import { and, eq, isNull, like, lt } from 'drizzle-orm';
import { apresEchec, DELAI_BLOQUE_MIN, raisonLisible, reessaiDu } from './publication/fiabilite';

const SOURCE_ALERTE = 'publication_echec';
const GRACE_MIN = () => parseInt(process.env.SOCIAL_PUBLISH_GRACE_MINUTES || '120', 10);

const jourParis = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Un post qui ne partira pas devient une tâche du jour : jamais d'échec silencieux. Une seule
 * alerte ouverte par post (pas de doublon à chaque passage).
 */
export async function signalerEchec(item: { id: number; userId: string; title?: string | null; platform?: string | null }, lastError: string): Promise<void> {
  try {
    const [deja] = await db.select({ id: tasks.id }).from(tasks).where(and(
      eq(tasks.userId, item.userId), eq(tasks.contentId, item.id), eq(tasks.source, SOURCE_ALERTE), eq(tasks.completed, false),
    ));
    if (deja) return;
    const titre = (item.title || 'post').slice(0, 80);
    await storage.createTask({
      userId: item.userId, title: `Publication échouée : ${titre}`,
      description: `${plateformeDe(item.platform) || 'réseau'} : ${raisonLisible(lastError)}`,
      type: 'content', category: 'planning', priority: 1, source: SOURCE_ALERTE,
      contentId: item.id, scheduledDate: jourParis(new Date()), estimatedDuration: 10,
    } as any);
  } catch (e: any) {
    console.error(`[SocialPublisher] alerte du post ${item.id} non créée:`, e?.message || e);
  }
}

/** Échec d'un essai : réessai plus tard si l'erreur est passagère, sinon échec et alerte. */
async function echouer(item: any, erreur: string): Promise<'failed' | 'skipped'> {
  const r = apresEchec(erreur, item.lastError, new Date());
  if (r.etat === 'reessai') {
    await storage.updateContent(item.id, { postStatus: 'pending', lastError: r.lastError } as any);
    console.warn(`[SocialPublisher] ↻ réessai prévu id=${item.id}: ${erreur}`);
    return 'skipped';
  }
  await storage.updateContent(item.id, { postStatus: 'failed', lastError: r.lastError } as any);
  await signalerEchec(item, r.lastError);
  return 'failed';
}

/** Le post est parti : sa tâche « Publier » n'a plus lieu d'être, elle se coche seule. */
async function cocherTachePublier(contentId: number): Promise<void> {
  await db.update(tasks)
    .set({ completed: true, completedAt: new Date() } as any)
    .where(and(eq(tasks.contentId, contentId), eq(tasks.completed, false), like(tasks.title, 'Publier — %')))
    .catch((e: any) => console.error(`[SocialPublisher] tâche Publier du post ${contentId} non cochée:`, e?.message || e));
}

const SUPPORTED = new Set(['instagram', 'linkedin', 'twitter', 'facebook']);

async function publishOne(item: any): Promise<'posted' | 'failed' | 'skipped'> {
  // 1. Claim atomique — si un autre passage l'a déjà pris, on saute.
  const claimed = await storage.claimContentForPosting(item.id);
  if (!claimed) return 'skipped';

  // « Instagram » et « instagram » : la casse varie selon l'origine du post.
  const platform: string = plateformeDe(item.platform);
  if (!SUPPORTED.has(platform)) {
    console.error(`[SocialPublisher] id=${item.id} plateforme non supportée: ${platform}`);
    return echouer(item, 'plateforme_non_supportee');
  }

  try {
    // 2. Compte du périmètre du post (projet client → ses comptes seulement ; priorité au
    //    compte explicitement lié, jamais remplacé s'il est hors périmètre).
    const choix = await compteDePublication(item);
    if ('erreur' in choix) {
      console.error(`[SocialPublisher] id=${item.id} ${choix.erreur} (${platform})`);
      return echouer(item, choix.erreur);
    }
    const account = choix.compte;
    if (account.expiresAt && new Date() > new Date(account.expiresAt)) {
      console.error(`[SocialPublisher] id=${item.id} token ${platform} expiré — reconnexion requise`);
      return echouer(item, 'compte_expire');
    }

    const credentials = {
      platform: account.platform,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accountId: account.accountId,
      accountName: account.accountName,
    } as any;

    // 3. Liste ordonnée des médias (type + durée) depuis la médiathèque, sinon mediaUrl.
    const media: { url: string; kind: 'image' | 'video'; durationSec?: number }[] = [];
    if (Array.isArray(item.mediaIds) && item.mediaIds.length > 0) {
      for (const mid of item.mediaIds as any[]) {
        const m = await storage.getMediaItemById(Number(mid), item.userId);
        if (m?.url) media.push({ url: m.url, kind: (m.mimeType || '').startsWith('video/') ? 'video' : 'image', durationSec: (m as any).duration ?? undefined });
      }
    }
    if (media.length === 0 && item.mediaUrl) media.push({ url: item.mediaUrl, kind: 'image' });

    // 4. Format déduit des visuels (plusieurs → carrousel), sauf story / reel / short explicites.
    const format: string = formatDePublication(item.postFormat, media.map((m) => m.kind));
    if (media.length === 0 && platform !== 'linkedin') {
      return echouer(item, 'media_required');
    }

    // 5. Publication format-aware.
    const result = await publishPost({
      platform, format, caption: item.body, media,
      credentials: { accessToken: credentials.accessToken, accountId: credentials.accountId, accountPlatform: account.platform },
    });

    if (result.state === 'processing') {
      await storage.updateContent(item.id, { postStatus: 'processing', providerContainerId: result.containerId || null } as any);
      console.log(`[SocialPublisher] ⏳ vidéo en traitement id=${item.id} (${platform}) container=${result.containerId}`);
      return 'skipped';
    }
    if (result.state === 'failed') {
      console.error(`[SocialPublisher] ❌ échec id=${item.id} sur ${platform}: ${result.error}`);
      return echouer(item, result.error || 'echec_inconnu');
    }
    await storage.updateContent(item.id, {
      status: 'published', publishedAt: new Date(), platformPostId: result.platformPostId, postStatus: 'posted',
      contentStatus: 'published', lastError: null,
    } as any);
    await cocherTachePublier(item.id);
    console.log(`[SocialPublisher] ✅ publié id=${item.id} sur ${platform} (postId=${result.platformPostId})`);
    return 'posted';
  } catch (err: any) {
    console.error(`[SocialPublisher] ❌ échec id=${item.id} sur ${platform}: ${err?.message || err}`);
    return echouer(item, String(err?.message || err)).catch(() => 'failed' as const);
  }
}

/** Reprend les vidéos en cours de traitement (conteneurs IG) et les publie quand prêtes. */
async function finishProcessing(): Promise<number> {
  const rows = await storage.getProcessingContent().catch(() => [] as any[]);
  let done = 0;
  for (const item of rows) {
    // Casse variable selon l'origine du post (« Instagram » / « instagram »).
    const plateforme = plateformeDe(item.platform);
    if (!item.providerContainerId || (plateforme !== 'instagram' && plateforme !== 'tiktok')) continue;
    try {
      const choix = await compteDePublication(item);
      if ('erreur' in choix) { await storage.updateContent(item.id, { postStatus: 'failed', lastError: choix.erreur } as any); await signalerEchec(item, choix.erreur); continue; }
      const account = choix.compte;
      const creds = { accessToken: account.accessToken, accountId: account.accountId };
      const r = plateforme === 'tiktok'
        ? await tiktokFinishAsync(creds, item.providerContainerId)
        : await igFinishAsync(creds, item.providerContainerId);
      if (r.state === 'posted') {
        await storage.updateContent(item.id, { status: 'published', publishedAt: new Date(), platformPostId: r.platformPostId, postStatus: 'posted', contentStatus: 'published', lastError: null } as any);
        await cocherTachePublier(item.id);
        done++;
      } else if (r.state === 'failed') {
        await storage.updateContent(item.id, { postStatus: 'failed', lastError: (r.error || '').slice(0, 300) } as any);
        await signalerEchec(item, r.error || 'echec_inconnu');
      }
      // 'processing' → on laisse, retry au prochain cycle
    } catch (e: any) {
      console.error(`[SocialPublisher] poll vidéo id=${item.id}:`, e?.message || e);
    }
  }
  return done;
}

/** Publie tous les contenus programmés arrivés à échéance. */
export async function publishDueContent(): Promise<{ posted: number; failed: number; skipped: number }> {
  const now = new Date();
  await finishProcessing(); // reprend d'abord les vidéos en traitement
  const due = await storage.getDueScheduledContent(now).catch((e: any) => {
    console.error('[SocialPublisher] erreur récupération contenus dus:', e?.message || e);
    return [] as any[];
  });
  await rattraperOublies(now).catch((e: any) => console.error('[SocialPublisher] rattrapage:', e?.message || e));
  let posted = 0, failed = 0, skipped = 0;
  for (const item of due) {
    if (!reessaiDu(item.lastError, now)) { skipped++; continue; } // réessai prévu plus tard
    const r = await publishOne(item);
    if (r === 'posted') posted++;
    else if (r === 'failed') failed++;
    else skipped++;
  }
  if (posted || failed) {
    console.log(`[SocialPublisher] cycle terminé — ${posted} publié(s), ${failed} échec(s), ${skipped} ignoré(s)`);
  }
  return { posted, failed, skipped };
}

/**
 * Jamais de post oublié en silence :
 *  - programmé mais plus vieux que la marge (Naya arrêtée, déploiement long) → échec + alerte ;
 *  - resté « en cours de publication » plus de 15 min (redémarrage pendant l'envoi) → échec
 *    « à vérifier » + alerte : il a pu partir, on ne le republie jamais tout seul.
 */
async function rattraperOublies(now: Date): Promise<void> {
  const limite = new Date(now.getTime() - GRACE_MIN() * 60_000);
  const manques = await db.update(content).set({ postStatus: 'failed', lastError: 'publication_manquee', updatedAt: now } as any)
    .where(and(eq(content.autoPost, true), eq(content.postStatus, 'pending'), isNull(content.publishedAt), lt(content.scheduledFor, limite)))
    .returning({ id: content.id, userId: content.userId, title: content.title, platform: content.platform });
  const bloques = await db.update(content).set({ postStatus: 'failed', lastError: 'publication_a_verifier', updatedAt: now } as any)
    .where(and(eq(content.postStatus, 'posting'), lt(content.updatedAt, new Date(now.getTime() - DELAI_BLOQUE_MIN * 60_000))))
    .returning({ id: content.id, userId: content.userId, title: content.title, platform: content.platform });
  for (const p of manques) await signalerEchec(p as any, 'publication_manquee');
  for (const p of bloques) await signalerEchec(p as any, 'publication_a_verifier');
  if (manques.length || bloques.length) console.warn(`[SocialPublisher] rattrapage : ${manques.length} manqué(s), ${bloques.length} bloqué(s)`);
}

/** Démarre le worker : vérifie les posts à publier toutes les 60 secondes. */
export function scheduleSocialPublisher(): void {
  const INTERVAL_MS = 60 * 1000;
  console.log('[SocialPublisher] Worker d\'auto-publication démarré (vérif. chaque minute)');
  setInterval(() => {
    publishDueContent().catch(err => console.error('[SocialPublisher] erreur cycle:', err?.message || err));
  }, INTERVAL_MS);
}
