/**
 * Réassigne les tâches qui ont une scheduled_date mais pas de scheduled_time
 * (overflow de la migration précédente) au prochain créneau disponible.
 */
import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { storage } from '../server/storage';

async function main() {
  const targets = await db.select({
    id: tasks.id, userId: tasks.userId,
    scheduledDate: tasks.scheduledDate, estimatedDuration: tasks.estimatedDuration, title: tasks.title,
  }).from(tasks).where(
    and(eq(tasks.completed, false), isNotNull(tasks.scheduledDate), isNull(tasks.scheduledTime))
  );

  console.log(`Tâches sans heure : ${targets.length}`);
  if (targets.length === 0) { console.log('✅  Rien à faire.'); process.exit(0); }

  let updated = 0;
  for (const task of targets) {
    const fromDate = task.scheduledDate!;
    const duration = task.estimatedDuration || 30;
    const slot = await storage.findFirstFreeSlot(task.userId, fromDate, duration);
    const [h, m] = slot.time.split(':').map(Number);
    const endMin = h * 60 + m + duration;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    await db.update(tasks).set({ scheduledDate: slot.date, scheduledTime: slot.time, scheduledEndTime: endTime })
      .where(eq(tasks.id, task.id));

    console.log(`  ASSIGNED  id=${task.id} ${fromDate} → ${slot.date} ${slot.time} "${(task.title||'').substring(0,45)}"`);
    updated++;
  }

  console.log(`\n✅  ${updated} tâches réassignées.`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
