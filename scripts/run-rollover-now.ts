import { rolloverStaleTasks } from '../server/services/auto-planner';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  const today = '2026-05-17'; // today (Sunday — so rollover targets Monday May 18)
  
  console.log('=== Avant rollover ===');
  console.log('Exécution de rolloverStaleTasks...');
  
  const result = await rolloverStaleTasks(userId, today);
  console.log(`Résultat: ${result.moved} tâches déplacées`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
