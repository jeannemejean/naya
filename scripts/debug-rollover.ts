import { storage } from '../server/storage';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  const targetDate = '2026-05-17';
  
  const prefs = await storage.getUserPreferences(userId);
  
  const yesterday = '2026-05-16';
  const lookback = '2026-04-17';
  
  const staleTasks = await storage.getTasksInRange(userId, lookback, yesterday);
  console.log(`getTasksInRange(${lookback}, ${yesterday}): ${staleTasks.length} tâches`);
  
  const incomplete = (staleTasks as any[]).filter(t => !t.completed && t.scheduledDate && t.scheduledDate <= yesterday);
  console.log(`Incomplètes: ${incomplete.length}`);
  for (const t of incomplete) console.log(`  id=${t.id} ${t.scheduledDate} ${t.scheduledTime} "${(t.title||'').substring(0,45)}"`);
  
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
