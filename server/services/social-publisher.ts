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

const SUPPORTED = new Set(['instagram', 'linkedin', 'twitter', 'facebook']);

async function publishOne(item: any): Promise<'posted' | 'failed' | 'skipped'> {
  // 1. Claim atomique — si un autre passage l'a déjà pris, on saute.
  const claimed = await storage.claimContentForPosting(item.id);
  if (!claimed) return 'skipped';

  const platform: string = item.platform;
  if (!SUPPORTED.has(platform)) {
    await storage.updateContent(item.id, { postStatus: 'failed' } as any);
    console.error(`[SocialPublisher] id=${item.id} plateforme non supportée: ${platform}`);
    return 'failed';
  }

  try {
    // 2. Compte connecté pour cette plateforme (priorité au compte explicitement lié).
    const accounts = await storage.getSocialAccounts(item.userId);
    const account = item.socialAccountId
      ? accounts.find((a: any) => a.id === item.socialAccountId)
      : accounts.find((a: any) => a.platform === platform && a.isActive);

    if (!account) {
      await storage.updateContent(item.id, { postStatus: 'failed' } as any);
      console.error(`[SocialPublisher] id=${item.id} aucun compte ${platform} connecté`);
      return 'failed';
    }
    if (account.expiresAt && new Date() > new Date(account.expiresAt)) {
      await storage.updateContent(item.id, { postStatus: 'failed' } as any);
      console.error(`[SocialPublisher] id=${item.id} token ${platform} expiré — reconnexion requise`);
      return 'failed';
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

    // 4. Format (défaut feed_image ; texte si LinkedIn sans média).
    const format: string = item.postFormat || (media.length ? 'feed_image' : 'text');
    if (media.length === 0 && platform !== 'linkedin') {
      await storage.updateContent(item.id, { postStatus: 'failed', lastError: 'media_required' } as any);
      return 'failed';
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
      await storage.updateContent(item.id, { postStatus: 'failed', lastError: (result.error || '').slice(0, 300) } as any);
      console.error(`[SocialPublisher] ❌ échec id=${item.id} sur ${platform}: ${result.error}`);
      return 'failed';
    }
    await storage.updateContent(item.id, {
      status: 'published', publishedAt: new Date(), platformPostId: result.platformPostId, postStatus: 'posted',
    } as any);
    console.log(`[SocialPublisher] ✅ publié id=${item.id} sur ${platform} (postId=${result.platformPostId})`);
    return 'posted';
  } catch (err: any) {
    await storage.updateContent(item.id, { postStatus: 'failed' } as any).catch(() => {});
    console.error(`[SocialPublisher] ❌ échec id=${item.id} sur ${platform}: ${err?.message || err}`);
    return 'failed';
  }
}

/** Reprend les vidéos en cours de traitement (conteneurs IG) et les publie quand prêtes. */
async function finishProcessing(): Promise<number> {
  const rows = await storage.getProcessingContent().catch(() => [] as any[]);
  let done = 0;
  for (const item of rows) {
    if (!item.providerContainerId || (item.platform !== 'instagram' && item.platform !== 'tiktok')) continue;
    try {
      const accounts = await storage.getSocialAccounts(item.userId);
      const account = item.socialAccountId
        ? accounts.find((a: any) => a.id === item.socialAccountId)
        : accounts.find((a: any) => a.platform === item.platform && a.isActive);
      if (!account) { await storage.updateContent(item.id, { postStatus: 'failed', lastError: 'no_account' } as any); continue; }
      const creds = { accessToken: account.accessToken, accountId: account.accountId };
      const r = item.platform === 'tiktok'
        ? await tiktokFinishAsync(creds, item.providerContainerId)
        : await igFinishAsync(creds, item.providerContainerId);
      if (r.state === 'posted') {
        await storage.updateContent(item.id, { status: 'published', publishedAt: new Date(), platformPostId: r.platformPostId, postStatus: 'posted' } as any);
        done++;
      } else if (r.state === 'failed') {
        await storage.updateContent(item.id, { postStatus: 'failed', lastError: (r.error || '').slice(0, 300) } as any);
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
  let posted = 0, failed = 0, skipped = 0;
  for (const item of due) {
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

/** Démarre le worker : vérifie les posts à publier toutes les 60 secondes. */
export function scheduleSocialPublisher(): void {
  const INTERVAL_MS = 60 * 1000;
  console.log('[SocialPublisher] Worker d\'auto-publication démarré (vérif. chaque minute)');
  setInterval(() => {
    publishDueContent().catch(err => console.error('[SocialPublisher] erreur cycle:', err?.message || err));
  }, INTERVAL_MS);
}
