import { storage } from '../server/storage';

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  // Fix all days from 2026-05-01 onward
  const fixed = await (storage as any).fixOverlappingTasks('qNCa68cbCCGcMAcLWmehk', '2026-05-01');
  console.log(`Fixed: ${fixed} tasks`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
