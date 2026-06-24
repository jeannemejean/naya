import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ONLY_FIRST = process.env.ONLY_FIRST === '1';
try {
  const posts = (await pool.query(`select id, user_id, platform_post_id from content where platform='linkedin' and post_status='posted' and platform_post_id is not null order by id`)).rows;
  console.log(`${posts.length} post(s) LinkedIn à supprimer`);
  if (!posts.length) { await pool.end(); process.exit(0); }
  const uid = posts[0].user_id;
  const acct = (await pool.query("select access_token from social_accounts where user_id=$1 and platform='linkedin' and is_active=true limit 1",[uid])).rows[0];
  if (!acct?.access_token) { console.log('❌ pas de token LinkedIn actif'); await pool.end(); process.exit(1); }
  const token = acct.access_token;
  const target = ONLY_FIRST ? posts.slice(0,1) : posts;
  let ok=0, fail=0;
  for (const p of target) {
    const urn = encodeURIComponent(p.platform_post_id);
    const res = await fetch(`https://api.linkedin.com/v2/ugcPosts/${urn}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' }
    });
    if (res.status === 204 || res.status === 200) {
      ok++;
      await pool.query("update content set post_status='pending', published_at=null, platform_post_id=null, status='ready' where id=$1",[p.id]);
      console.log(`✅ supprimé id=${p.id} (${p.platform_post_id})`);
    } else {
      fail++;
      const body = await res.text();
      console.log(`❌ id=${p.id} HTTP ${res.status} — ${body.slice(0,160)}`);
    }
  }
  console.log(`\nRésultat: ${ok} supprimé(s), ${fail} échec(s)`);
} catch(e){ console.log('ERREUR:', e.message); } finally { await pool.end(); }
