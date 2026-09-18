import { validateInput } from '../middleware/validation.js';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { lockPeople, normalizePhone, preferredName } from '../lib/people.js';
import { HttpError } from '../lib/errors.js';
import { createHash } from 'node:crypto';

const router = Router();
router.use(requireAuth);
router.param('id',(req,res,next)=>validateInput(req,res,next));
export function mergeGroups(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const p of rows) {
    const phone = normalizePhone(p.phone);
    // Ignore incomplete numbers; never merge on name alone.
    if (!phone || !/^\d{9,15}$/.test(phone)) continue;
    const group = groups.get(phone) || []; group.push(p); groups.set(phone, group);
  }
  return [...groups].filter(([,v]) => v.length > 1).map(([phone, people]) => ({phone, people,
    name: preferredName(people.map(p => p.name)),
    conflict: new Set(people.map(p => p.national_id).filter(Boolean)).size > 1
  }));
}
const hash = (rows: any) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
router.get('/duplicates', asyncHandler(async (_req, res) => {
  const rows = (await pool.query('SELECT * FROM people ORDER BY id')).rows;
  const groups = mergeGroups(rows);
  res.json({ token: hash(rows), groups: groups.map(g => ({phone:g.phone, name:g.name,
    ids:g.people.map(p => String(p.id)), names:g.people.map(p => p.name), conflict:g.conflict})) });
}));
router.post('/merge-duplicates', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await lockPeople(client);
    await client.query('LOCK TABLE people, applications IN SHARE ROW EXCLUSIVE MODE');
    const rows = (await client.query('SELECT * FROM people ORDER BY id')).rows;
    if (req.body?.token !== hash(rows)) throw new HttpError(409, 'PREVIEW_CHANGED', 'הרשימה השתנתה. יש לבדוק שוב את הכפילויות.');
    const groups = mergeGroups(rows), archiveIds = [];
    let merged = 0;
    for (const g of groups) {
      if (g.conflict) continue;
      const survivor = g.people[0], ids = g.people.map(p => p.id);
      const apps = (await client.query('SELECT * FROM applications WHERE person_id = ANY($1::int[]) ORDER BY id', [ids])).rows;
      const archive = await client.query('INSERT INTO person_merge_archive (actor, survivor_id, snapshot) VALUES ($1,$2,$3) RETURNING id',
        [req.user!.username, survivor.id, {people:g.people, applications:apps}]);
      archiveIds.push(String(archive.rows[0].id));
      await client.query('UPDATE applications SET person_id = $1 WHERE person_id = ANY($2::int[])', [survivor.id, ids.slice(1)]);
      // Archive retains alternate emails, notes, original names and every field.
      await client.query('DELETE FROM people WHERE id = ANY($1::int[])', [ids.slice(1)]);
      const fields = ['email','referral','region','city','national_id','notes'];
      const values = fields.map(k => g.people.find(p => p[k])?.[k] || null);
      await client.query(`UPDATE people SET name=$2, phone=$3, do_not_rehire=$4, do_not_rehire_reason=$5,
        ${fields.map((k,i)=>`${k}=$${i+6}`).join(',')} WHERE id=$1`,
        [survivor.id,g.name,g.phone,g.people.some(p=>p.do_not_rehire),
          [...new Set(g.people.map(p=>p.do_not_rehire_reason).filter(Boolean))].join('\n') || null,...values]);
      // Save versions after merge so undo never overwrites subsequent edits.
      const afterPeople = (await client.query('SELECT * FROM people WHERE id=$1',[survivor.id])).rows;
      const afterApps = (await client.query('SELECT * FROM applications WHERE person_id=$1 ORDER BY id',[survivor.id])).rows;
      await client.query("UPDATE person_merge_archive SET snapshot = snapshot || $2::jsonb WHERE id=$1",
        [archive.rows[0].id,{afterHash:hash({people:afterPeople,applications:afterApps})}]);
      merged += ids.length - 1;
    }
    // Normalize remaining numbers too, using the same canonical form as new input.
    for (const p of (await client.query('SELECT id, phone FROM people')).rows) {
      const phone=normalizePhone(p.phone);
      if (phone !== p.phone) await client.query('UPDATE people SET phone=$2 WHERE id=$1',[p.id,phone]);
    }
    await client.query('COMMIT');
    res.json({merged, groupsMerged:archiveIds.length, skipped:groups.filter(g=>g.conflict).length, archiveIds});
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));
// Undo is safe only while the merged records have not been edited again.
router.post('/undo-merge/:id', asyncHandler(async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN'); await lockPeople(client);
    await client.query('LOCK TABLE people, applications IN SHARE ROW EXCLUSIVE MODE');
    const a=(await client.query('SELECT * FROM person_merge_archive WHERE id=$1 AND restored_at IS NULL FOR UPDATE',[req.params.id])).rows[0];
    if (!a) throw new HttpError(404,'NOT_FOUND','איחוד לא נמצא');
    const people=(await client.query('SELECT * FROM people WHERE id=$1',[a.survivor_id])).rows;
    const applications=(await client.query('SELECT * FROM applications WHERE person_id=$1 ORDER BY id',[a.survivor_id])).rows;
    if(hash({people,applications})!==a.snapshot.afterHash) throw new HttpError(409,'RECORD_CHANGED','בוצעו שינויים מאז האיחוד; יש לשחזר בעזרת הגיבוי ללא דריסתם.');
    // Restore non-survivors first, then original ownership and survivor details.
    await client.query('UPDATE people SET email=NULL WHERE id=$1',[a.survivor_id]);
    for (const p of a.snapshot.people) {
      const keys=Object.keys(p);
      await client.query(`INSERT INTO people (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})
        ON CONFLICT(id) DO UPDATE SET ${keys.filter(k=>k!=='id').map(k=>'"'+k+'"=EXCLUDED."'+k+'"').join(',')}`,keys.map(k=>p[k]));
    }
    for (const app of a.snapshot.applications) await client.query('UPDATE applications SET person_id=$2 WHERE id=$1',[app.id,app.person_id]);
    await client.query('UPDATE person_merge_archive SET restored_at=now() WHERE id=$1',[a.id]);
    await client.query('COMMIT'); res.json({restored:true});
  } catch(err) {await client.query('ROLLBACK'); throw err;} finally {client.release();}
}));
export default router;
