import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check the raw stored format of scheduledDate
  const result = await db.execute(sql`
    SELECT id, scheduled_date, LENGTH(scheduled_date) as len, 
           scheduled_time, estimated_duration
    FROM tasks 
    WHERE user_id = 'qNCa68cbCCGcMAcLWmehk' 
    AND scheduled_date IS NOT NULL
    AND completed = false
    ORDER BY scheduled_date, scheduled_time
    LIMIT 5
  `);
  console.log(JSON.stringify(result.rows || result, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
