import { db } from '../server/db';
import { userPreferences, tasks } from '../shared/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';

  // Check user prefs
  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  console.log('User prefs:', JSON.stringify(prefs[0] || null, null, 2));

  // Check May 15 tasks with time
  const may15 = await db.select({ id: tasks.id, scheduledTime: tasks.scheduledTime, estimatedDuration: tasks.estimatedDuration })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.scheduledDate, '2026-05-15'), eq(tasks.completed, false)));
  
  const withTime = may15.filter(t => t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime));
  console.log(`\nMay 15 tasks total: ${may15.length}, with valid time: ${withTime.length}`);
  console.log('With time:', withTime.map(t => `${t.id}@${t.scheduledTime}(${t.estimatedDuration}min)`).join(', '));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
