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

    // 3. Média éventuel (1re image de la bibliothèque, sinon mediaUrl).
    let imageUrl: string | undefined;
    if (Array.isArray(item.mediaIds) && item.mediaIds.length > 0) {
      const media = await storage.getMediaItemById(item.mediaIds[0], item.userId);
      if (media) imageUrl = media.url;
    }
    if (!imageUrl && item.mediaUrl) imageUrl = item.mediaUrl;

    const postData = { platform, content: item.body, imageUrl } as any;

    // 4. Publication via la fonction existante de la plateforme.
    let platformPostId: string;
    if (platform === 'instagram') platformPostId = await socialMediaService.postToInstagram(credentials, postData);
    else if (platform === 'linkedin') platformPostId = await socialMediaService.postToLinkedIn(credentials, postData);
    else if (platform === 'twitter') platformPostId = await socialMediaService.postToTwitter(credentials, postData);
    else platformPostId = await socialMediaService.postToFacebook(credentials, postData);

    // 5. Succès.
    await storage.updateContent(item.id, {
      status: 'published',
      publishedAt: new Date(),
      platformPostId,
      postStatus: 'posted',
    } as any);
    console.log(`[SocialPublisher] ✅ publié id=${item.id} sur ${platform} (postId=${platformPostId})`);
    return 'posted';
  } catch (err: any) {
    await storage.updateContent(item.id, { postStatus: 'failed' } as any).catch(() => {});
    console.error(`[SocialPublisher] ❌ échec id=${item.id} sur ${platform}: ${err?.message || err}`);
    return 'failed';
  }
}

/** Publie tous les contenus programmés arrivés à échéance. */
export async function publishDueContent(): Promise<{ posted: number; failed: number; skipped: number }> {
  const now = new Date();
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
