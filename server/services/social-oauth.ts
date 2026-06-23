/**
 * Social Media OAuth — Naya
 * Gère le flux OAuth pour Instagram (Meta), LinkedIn, Twitter/X
 *
 * Variables d'environnement requises :
 *   Instagram : INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET
 *   LinkedIn  : LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 *   Twitter   : TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
 */

import { storage } from '../storage';

// ─── URL de base de l'app ───────────────────────────────────────────────────

function getBaseUrl(): string {
  return process.env.APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://naya-production-64ac.up.railway.app'
      : 'http://localhost:3000');
}

// ─── Instagram (API « Instagram Login » — graph.instagram.com) ────────────────
//
// Flux Instagram Login (≠ Facebook Login) : app Instagram dédiée (IG_APP_ID/IG_APP_SECRET),
// consentement sur instagram.com, jeton échangé sur api.instagram.com puis long-lived sur
// graph.instagram.com. Permet de PUBLIER sans Page Facebook ni vérification d'entreprise.
// Réf : https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'].join(',');

export function getInstagramAuthUrl(state: string): string {
  const appId = process.env.IG_APP_ID;
  if (!appId) throw new Error('IG_APP_ID non configuré');
  const redirect = encodeURIComponent(`${getBaseUrl()}/api/social/oauth/instagram/callback`);
  const scope = encodeURIComponent(INSTAGRAM_SCOPES);
  return `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${redirect}&response_type=code&scope=${scope}&state=${state}`;
}

export async function exchangeInstagramCode(userId: string, code: string): Promise<void> {
  const appId = process.env.IG_APP_ID!;
  const appSecret = process.env.IG_APP_SECRET!;
  const redirectUri = `${getBaseUrl()}/api/social/oauth/instagram/callback`;

  // 1. Code → short-lived token (api.instagram.com, form-urlencoded). Instagram renvoie parfois
  //    le code suffixé de "#_" → on nettoie.
  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: code.replace(/#_$/, ''),
    }),
  });
  const tokenData: any = await tokenRes.json();
  const shortToken = tokenData?.access_token;
  if (!shortToken) throw new Error(`Instagram token exchange failed: ${JSON.stringify(tokenData?.error || tokenData)}`);
  const igUserId = String(tokenData.user_id);

  // 2. Short-lived → long-lived (60 jours) sur graph.instagram.com
  let longToken = shortToken;
  let expiresIn = 60 * 24 * 60 * 60;
  try {
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortToken}`,
    );
    const longData: any = await longRes.json();
    if (longData?.access_token) { longToken = longData.access_token; expiresIn = longData.expires_in || expiresIn; }
  } catch { /* garde le short-lived */ }

  // 3. Nom d'utilisateur (non bloquant)
  let accountName = 'Instagram';
  let accountId = igUserId;
  try {
    const me = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${longToken}`);
    const mj: any = await me.json();
    accountName = mj?.username || accountName;
    accountId = String(mj?.user_id || igUserId);
  } catch { /* ignore */ }

  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const existing = await storage.getSocialAccountByPlatform(userId, 'instagram');
  if (existing) {
    await storage.updateSocialAccount(existing.id, userId, {
      accessToken: longToken, accountId, platformUserId: accountId, accountName, expiresAt, isActive: true, lastSyncAt: new Date(),
    });
  } else {
    await storage.createSocialAccount({
      userId, platform: 'instagram', accountId, platformUserId: accountId, accountName,
      accessToken: longToken, expiresAt, permissions: INSTAGRAM_SCOPES.split(','), isActive: true, lastSyncAt: new Date(),
    });
  }
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

const LINKEDIN_SCOPES = [
  'r_basicprofile',
  'w_member_social',
  'r_organization_social',
  'w_organization_social',
].join(' ');

export function getLinkedInAuthUrl(state: string): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) throw new Error('LINKEDIN_CLIENT_ID non configuré');

  const redirect = encodeURIComponent(`${getBaseUrl()}/api/social/oauth/linkedin/callback`);
  const scope = encodeURIComponent(LINKEDIN_SCOPES);

  return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&state=${state}&scope=${scope}`;
}

export async function exchangeLinkedInCode(userId: string, code: string): Promise<void> {
  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
  const redirectUri = `${getBaseUrl()}/api/social/oauth/linkedin/callback`;

  // 1. Échanger le code contre un token
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  // 2. Récupérer le profil via API v2 (compatible r_basicprofile)
  const profileRes = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  const profile = await profileRes.json();

  const accountId = profile.id || 'unknown';
  const accountName = `${profile.localizedFirstName || ''} ${profile.localizedLastName || ''}`.trim() || 'LinkedIn';

  // 3. Récupérer les pages LinkedIn gérées par l'utilisateur
  let orgPages: Array<{ id: string; name: string }> = [];
  try {
    const aclRes = await fetch(
      'https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=10',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }
    );
    const aclData = await aclRes.json();
    const elements = aclData.elements || [];

    for (const acl of elements) {
      const orgUrn: string = acl.organizationalTarget || '';
      const orgId = orgUrn.replace('urn:li:organization:', '');
      if (!orgId) continue;

      const orgRes = await fetch(`https://api.linkedin.com/v2/organizations/${orgId}?projection=(id,localizedName)`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      const orgData = await orgRes.json();
      if (orgData.id) orgPages.push({ id: String(orgData.id), name: orgData.localizedName || `Page ${orgId}` });
    }
  } catch (e) {
    console.warn('[LinkedIn] Could not fetch org pages:', e);
  }

  // 4. Sauvegarder profil personnel (upsert)
  const existing = await storage.getSocialAccountByPlatform(userId, 'linkedin');
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  if (existing) {
    await storage.updateSocialAccount(existing.id, userId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      accountId,
      accountName,
      expiresAt,
      isActive: true,
      lastSyncAt: new Date(),
    });
  } else {
    await storage.createSocialAccount({
      userId,
      platform: 'linkedin',
      accountId,
      accountName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      expiresAt,
      permissions: LINKEDIN_SCOPES.split(' '),
      isActive: true,
      lastSyncAt: new Date(),
    });
  }

  // 5. Sauvegarder chaque page comme compte séparé (linkedin_page)
  for (const page of orgPages) {
    const existingPage = await storage.getSocialAccountByPlatform(userId, `linkedin_page_${page.id}`);
    if (existingPage) {
      await storage.updateSocialAccount(existingPage.id, userId, {
        accessToken: tokenData.access_token,
        accountName: page.name,
        expiresAt,
        isActive: true,
        lastSyncAt: new Date(),
      });
    } else {
      await storage.createSocialAccount({
        userId,
        platform: `linkedin_page_${page.id}`,
        accountId: page.id,
        accountName: page.name,
        accessToken: tokenData.access_token,
        expiresAt,
        permissions: ['w_organization_social', 'r_organization_social'],
        isActive: true,
        lastSyncAt: new Date(),
      });
    }
  }

}

// ─── Twitter / X ─────────────────────────────────────────────────────────────

const TWITTER_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'offline.access',
].join(' ');

export function getTwitterAuthUrl(state: string, codeChallenge: string): string {
  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) throw new Error('TWITTER_CLIENT_ID non configuré');

  const redirect = encodeURIComponent(`${getBaseUrl()}/api/social/oauth/twitter/callback`);
  const scope = encodeURIComponent(TWITTER_SCOPES);

  return (
    `https://twitter.com/i/oauth2/authorize` +
    `?response_type=code&client_id=${clientId}&redirect_uri=${redirect}` +
    `&scope=${scope}&state=${state}` +
    `&code_challenge=${codeChallenge}&code_challenge_method=plain`
  );
}

export async function exchangeTwitterCode(userId: string, code: string, codeVerifier: string): Promise<void> {
  const clientId = process.env.TWITTER_CLIENT_ID!;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET!;
  const redirectUri = `${getBaseUrl()}/api/social/oauth/twitter/callback`;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Twitter token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  // Récupérer le profil
  const profileRes = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profileData = await profileRes.json();
  const profile = profileData.data;

  const accountId = profile?.id || 'unknown';
  const accountName = profile?.name || profile?.username || 'X / Twitter';

  const existing = await storage.getSocialAccountByPlatform(userId, 'twitter');
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  if (existing) {
    await storage.updateSocialAccount(existing.id, userId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      accountId,
      accountName,
      expiresAt,
      isActive: true,
      lastSyncAt: new Date(),
    });
  } else {
    await storage.createSocialAccount({
      userId,
      platform: 'twitter',
      accountId,
      accountName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      expiresAt,
      permissions: TWITTER_SCOPES.split(' '),
      isActive: true,
      lastSyncAt: new Date(),
    });
  }
}

// ─── TikTok (Login Kit v2 + Content Posting API) ────────────────────────────

const TIKTOK_SCOPES = 'user.info.basic,video.publish,video.upload';

export function getTikTokAuthUrl(state: string): string {
  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const redirect = encodeURIComponent(`${getBaseUrl()}/api/social/oauth/tiktok/callback`);
  return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${encodeURIComponent(TIKTOK_SCOPES)}&response_type=code&redirect_uri=${redirect}&state=${state}`;
}

export async function exchangeTikTokCode(userId: string, code: string): Promise<void> {
  const redirectUri = `${getBaseUrl()}/api/social/oauth/tiktok/callback`;
  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const tok: any = await tokenRes.json();
  if (!tokenRes.ok || !tok.access_token) throw new Error(`tiktok_token: ${JSON.stringify(tok).slice(0, 200)}`);

  let accountName = 'TikTok';
  try {
    const me = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const mj: any = await me.json();
    accountName = mj?.data?.user?.display_name || accountName;
  } catch { /* ignore */ }

  const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined;
  await storage.createSocialAccount({
    userId,
    platform: 'tiktok',
    accountId: tok.open_id,
    accountName,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || undefined,
    expiresAt,
    permissions: TIKTOK_SCOPES.split(','),
    isActive: true,
    lastSyncAt: new Date(),
  } as any);
}

// ─── Helper : vérifie si une plateforme est configurée ───────────────────────

export function isPlatformConfigured(platform: 'instagram' | 'linkedin' | 'twitter' | 'tiktok'): boolean {
  switch (platform) {
    case 'instagram':
      return !!(process.env.IG_APP_ID && process.env.IG_APP_SECRET);
    case 'linkedin':
      return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
    case 'twitter':
      return !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);
    case 'tiktok':
      return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  }
}
