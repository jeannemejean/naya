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

// ─── Instagram / Meta ────────────────────────────────────────────────────────

const INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'public_profile',
].join(',');

export function getInstagramAuthUrl(state: string): string {
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) throw new Error('INSTAGRAM_APP_ID non configuré');

  const redirect = encodeURIComponent(`${getBaseUrl()}/api/social/oauth/instagram/callback`);
  const scope = encodeURIComponent(INSTAGRAM_SCOPES);

  return `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scope}&state=${state}&response_type=code`;
}

export async function exchangeInstagramCode(userId: string, code: string): Promise<void> {
  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;
  const redirectUri = `${getBaseUrl()}/api/social/oauth/instagram/callback`;

  // 1. Échanger le code contre un short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
  );
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Meta token exchange failed: ${JSON.stringify(tokenData.error || tokenData)}`);
  }

  // 2. Échanger contre un long-lived token (60 jours)
  const longRes = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
  );
  const longData = await longRes.json();
  const longToken = longData.access_token || tokenData.access_token;

  // 3. Récupérer les pages Facebook de l'utilisateur
  const pagesRes = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?access_token=${longToken}`
  );
  const pagesData = await pagesRes.json();
  const pages = pagesData.data || [];

  if (pages.length === 0) {
    throw new Error('Aucune Page Facebook trouvée. Connecte une Page Facebook à ton compte Instagram Business.');
  }

  // 4. Trouver le compte Instagram Business lié à la première page
  let igAccountId: string | null = null;
  let igAccountName: string = pages[0].name;

  for (const page of pages) {
    const igRes = await fetch(
      `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token || longToken}`
    );
    const igData = await igRes.json();
    if (igData.instagram_business_account?.id) {
      igAccountId = igData.instagram_business_account.id;
      igAccountName = page.name;
      break;
    }
  }

  if (!igAccountId) {
    // Fallback : utiliser l'ID de la page directement (pour poster via Creator Studio)
    igAccountId = pages[0].id as string;
    igAccountName = pages[0].name as string;
  }

  const finalAccountId: string = igAccountId!;
  const finalAccountName: string = igAccountName;

  // 5. Sauvegarder dans la DB (upsert)
  const existing = await storage.getSocialAccountByPlatform(userId, 'instagram');
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 jours

  if (existing) {
    await storage.updateSocialAccount(existing.id, userId, {
      accessToken: longToken,
      accountId: finalAccountId,
      accountName: finalAccountName,
      expiresAt,
      isActive: true,
      lastSyncAt: new Date(),
    });
  } else {
    await storage.createSocialAccount({
      userId,
      platform: 'instagram',
      accountId: finalAccountId,
      accountName: finalAccountName,
      accessToken: longToken,
      expiresAt,
      permissions: INSTAGRAM_SCOPES.split(','),
      isActive: true,
      lastSyncAt: new Date(),
    });
  }
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social',
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

  // 2. Récupérer le profil
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();

  const accountId = profile.sub || 'unknown';
  const accountName = profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || 'LinkedIn';

  // 3. Sauvegarder (upsert)
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

// ─── Helper : vérifie si une plateforme est configurée ───────────────────────

export function isPlatformConfigured(platform: 'instagram' | 'linkedin' | 'twitter'): boolean {
  switch (platform) {
    case 'instagram':
      return !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
    case 'linkedin':
      return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
    case 'twitter':
      return !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);
  }
}
