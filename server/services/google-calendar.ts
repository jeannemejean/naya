// server/services/google-calendar.ts
import { google } from 'googleapis';
import { storage } from '../storage';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
      (process.env.NODE_ENV === 'production'
        ? 'https://naya-production-64ac.up.railway.app/api/calendar/oauth/callback'
        : 'http://localhost:3000/api/calendar/oauth/callback')
  );
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // always ask for refresh_token
  });
}

export async function exchangeCodeForTokens(
  userId: string,
  code: string
): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing tokens from Google — make sure prompt=consent is set');
  }
  await storage.upsertGoogleCalendarToken({
    userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
    calendarId: 'primary',
  });
}

/** Returns an authenticated oauth2Client for a user, refreshing token if needed. */
async function getAuthedClient(userId: string) {
  const stored = await storage.getGoogleCalendarToken(userId);
  if (!stored) throw new Error('Google Calendar not connected');

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: stored.expiresAt.getTime(),
  });

  // Auto-refresh if token expired
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await storage.upsertGoogleCalendarToken({
        userId,
        accessToken: tokens.access_token,
        refreshToken: stored.refreshToken,
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
        calendarId: stored.calendarId || 'primary',
      });
    }
  });

  return oauth2Client;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  date: string;        // YYYY-MM-DD
  allDay: boolean;
  location?: string;
}

/**
 * Fetches Google Calendar events for a date range.
 * Returns [] if user has no connected calendar (never throws).
 */
export async function getCalendarEvents(
  userId: string,
  startDate: string,  // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
): Promise<CalendarEvent[]> {
  const hasToken = await storage.hasGoogleCalendarToken(userId);
  console.log(`[GCal] getCalendarEvents userId=${userId} hasToken=${hasToken} range=${startDate}→${endDate}`);
  if (!hasToken) return [];
  try {
    return await listerEvenements(userId, startDate, endDate, 1);
  } catch (err: any) {
    console.error('[GCal] Error fetching events:', err.message, err.code, err.status);
    return [];
  }
}

/**
 * Lecture de l'agenda qui DIT ses échecs (indicateurs du fil conducteur) : `null` sans agenda
 * relié, une exception si Google ne répond pas ou si la période dépasse `pagesMax` pages de 250
 * événements — un compte tronqué serait un chiffre inventé. `getCalendarEvents` lit la même
 * chose sur une page, sans jamais lever.
 */
export async function lireEvenementsAgenda(
  userId: string,
  startDate: string,  // YYYY-MM-DD
  endDate: string,    // YYYY-MM-DD
  pagesMax = 1,
): Promise<CalendarEvent[] | null> {
  if (!(await storage.hasGoogleCalendarToken(userId))) return null;
  return listerEvenements(userId, startDate, endDate, pagesMax);
}

async function listerEvenements(userId: string, startDate: string, endDate: string, pagesMax: number): Promise<CalendarEvent[]> {
  const auth = await getAuthedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date(startDate + 'T00:00:00').toISOString();
  const timeMax = new Date(endDate + 'T23:59:59').toISOString();

  const items: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < pagesMax; page++) {
    // Timeout de 8 secondes par page pour éviter un blocage infini de la requête parente
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      minuteur = setTimeout(() => reject(new Error('GCal timeout')), 8000);
    });
    const response = await Promise.race([
      calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,  // expand recurring events
        orderBy: 'startTime',
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      }),
      timeout,
    ]).finally(() => clearTimeout(minuteur));
    items.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken || undefined;
    if (!pageToken) break;
  }
  // Une seule page (getCalendarEvents) : comportement historique, les 250 premiers événements.
  if (pageToken && pagesMax > 1) throw new Error('GCal : trop d\'événements sur la période');

  const events: CalendarEvent[] = [];

  for (const item of items) {
    if (!item.start || item.status === 'cancelled') continue;

    const allDay = !!item.start.date && !item.start.dateTime;
    let date: string;
    let startTime = '00:00';
    let endTime = '00:00';

    if (allDay) {
      date = item.start.date!;
    } else {
      // Extract date and time directly from the ISO string to preserve local timezone.
      // Google returns e.g. "2026-04-08T10:00:00+02:00" — slicing gives the correct local time.
      const startDt = item.start.dateTime!;
      const endDt = item.end?.dateTime || startDt;
      date = startDt.slice(0, 10);
      startTime = startDt.slice(11, 16);
      endTime = endDt.slice(11, 16);
    }

    events.push({
      id: item.id || '',
      title: item.summary || 'Busy',
      startTime,
      endTime,
      date,
      allDay,
      location: item.location || undefined,
    });
  }

  return events;
}

/**
 * Returns blocked time ranges for a specific date (for auto-planner use).
 * Returns [] if no calendar connected.
 *
 * Cache court (60s) par (userId, date) : lors d'une génération en lot, le
 * planificateur crée plusieurs tâches qui appellent chacune le garde-fou de
 * collision — sans cache, on frapperait l'API Google à chaque tâche.
 */
const _blockedCache = new Map<string, { at: number; ranges: Array<{ start: number; end: number }> }>();
const BLOCKED_CACHE_TTL_MS = 60 * 1000;

export async function getCalendarBlockedRanges(
  userId: string,
  date: string  // YYYY-MM-DD
): Promise<Array<{ start: number; end: number }>> {
  const key = `${userId}:${date}`;
  const cached = _blockedCache.get(key);
  if (cached && (Date.now() - cached.at) < BLOCKED_CACHE_TTL_MS) {
    return cached.ranges;
  }

  const events = await getCalendarEvents(userId, date, date);
  const ranges = events
    .filter(e => !e.allDay && e.startTime !== e.endTime)
    .map(e => {
      const [sh, sm] = e.startTime.split(':').map(Number);
      const [eh, em] = e.endTime.split(':').map(Number);
      return { start: sh * 60 + sm, end: eh * 60 + em };
    });

  _blockedCache.set(key, { at: Date.now(), ranges });
  return ranges;
}
