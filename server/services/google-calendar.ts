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
  if (!hasToken) return [];

  try {
    const auth = await getAuthedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    const timeMin = new Date(startDate + 'T00:00:00').toISOString();
    const timeMax = new Date(endDate + 'T23:59:59').toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,  // expand recurring events
      orderBy: 'startTime',
      maxResults: 250,
    });

    const items = response.data.items || [];
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
        const start = new Date(item.start.dateTime!);
        const end = new Date(item.end?.dateTime || item.start.dateTime!);
        date = start.toISOString().slice(0, 10);
        startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
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
  } catch (err: any) {
    console.error('[GCal] Error fetching events:', err.message);
    return [];
  }
}

/**
 * Returns blocked time ranges for a specific date (for auto-planner use).
 * Returns [] if no calendar connected.
 */
export async function getCalendarBlockedRanges(
  userId: string,
  date: string  // YYYY-MM-DD
): Promise<Array<{ start: number; end: number }>> {
  const events = await getCalendarEvents(userId, date, date);
  return events
    .filter(e => !e.allDay && e.startTime !== e.endTime)
    .map(e => {
      const [sh, sm] = e.startTime.split(':').map(Number);
      const [eh, em] = e.endTime.split(':').map(Number);
      return { start: sh * 60 + sm, end: eh * 60 + em };
    });
}
