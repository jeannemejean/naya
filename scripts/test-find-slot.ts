import { storage } from '../server/storage';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  // May 15 is a Friday with 7 tasks filling 09:00-17:20
  // A 45min task should NOT fit → should return May 18 09:00
  console.log('Testing 45min task on May 15 (should overflow to May 18):');
  const slot1 = await storage.findFirstFreeSlot(userId, '2026-05-15', 45);
  console.log('  Result:', slot1);
  
  // A 30min task should also overflow (day ends at 17:20+30=17:50, then May 18)
  console.log('Testing 30min task on May 15:');
  const slot2 = await storage.findFirstFreeSlot(userId, '2026-05-15', 30);
  console.log('  Result:', slot2);

  // May 18 has 7 tasks, 09:00-17:50 — a small task should find 17:55
  console.log('Testing 20min task on May 18:');
  const slot3 = await storage.findFirstFreeSlot(userId, '2026-05-18', 20);
  console.log('  Result:', slot3);
  
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
