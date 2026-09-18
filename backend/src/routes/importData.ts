import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { normalizeEmail, normalizePhone, lockPeople } from '../lib/people.js';
import { validateRecord } from '../middleware/validation.js';
import { HttpError } from '../lib/errors.js';

const router=Router(); router.use(requireAuth);
const digest=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const jobFields: Record<string,string>={title:'title',status:'status',keywords:'keywords',description:'description',requirements:'requirements',requestDate:'request_date',filledDate:'filled_date',statusReason:'status_reason',candidateInProcess:'candidate_in_process',contact:'contact',startDate:'start_date',period:'period',rate:'rate',salaryRange:'salary_range',includesCar:'includes_car',travelBetweenSites:'travel_between_sites',location:'location',workHours:'work_hours',jobScope:'job_scope',shifts:'shifts',equipment:'equipment',yearsExperience:'years_experience',language:'language',reportsTo:'reports_to',securityClearance:'security_clearance',extraNotes:'extra_notes'};
const appFields: Record<string,string>={role:'role',summaryText:'summary_text',interviewedTeams:'interviewed_teams',gotTask:'got_task',sentToClient:'sent_to_client',clientApproved:'client_approved',outcomeStatus:'outcome_status',salaryExpectation:'salary_expectation',jobScope:'job_scope',employmentType:'employment_type',sourceChannel:'source_channel',contactedAt:'contacted_at',rejectionReason:'rejection_reason'};
const mapped=(row:any,fields:Record<string,string>)=>Object.fromEntries(Object.entries(fields).filter(([key])=>row[key]!==undefined).map(([key,col])=>[col,row[key]===''?null:row[key]]));
const day=(v:any)=>v?new Date(v).toISOString().slice(0,10):'';
export function buildImportPlan(body:any, state:any) {
  const plan:any[]=[]; const issues:any[]=[];
  const people=state.people.map((p:any)=>({...p,phone:normalizePhone(p.phone)}));
  const seen=new Set();
  const jobs=body.jobs||[], candidates=body.candidates||[];
  for(const [kind,rows] of [['job',jobs],['candidate',candidates]] as const) {
    for(const [index,row] of rows.entries()) {
      validateRecord(row);
      if(typeof row.importKey!=='string'||!row.importKey.trim()) throw new HttpError(400,'IMPORT_KEY_REQUIRED',`חסר מזהה שורת מקור: ${kind} ${index+1}`);
      const key=kind+':'+row.importKey;
      if(seen.has(key)) throw new HttpError(400,'DUPLICATE_IMPORT_KEY','אותו מזהה שורה מופיע פעמיים בקובץ');
      seen.add(key);
      if(!(kind==='job'?row.title:row.name)?.trim()) throw new HttpError(400,'REQUIRED_FIELD','חסר שם או תפקיד בשורת הייבוא');
      const records=kind==='job'?state.jobs:state.applications;
      if(records.some((r:any)=>r.import_key===row.importKey)) {plan.push({kind,action:'skip',key:row.importKey});continue;}
      if(kind==='job') {
        if(row.status && !['awaiting','filled','not_filled','frozen'].includes(row.status)) throw new HttpError(400,'INVALID_STATUS','סטטוס משרה לא תקין');
        const clients=state.clients.filter((c:any)=>c.name.trim()===(row.clientName||'').trim());
        if(clients.length>1) {issues.push({kind,row:index+1,key:row.importKey,reason:'מספר לקוחות בעלי אותו שם'});continue;}
        const cid=clients[0]?.id||null;
        const matching=(j:any)=>!j.import_key&&j.title===row.title&&j.client_id===cid&&day(j.request_date)===(row.requestDate||'')&&j.status===(row.status||'awaiting');
        const legacy=state.jobs.filter(matching);
        const incomingMatches=jobs.filter((j:any)=>j.title===row.title&&(j.clientName||'')===(row.clientName||'')&&(j.requestDate||'')===(row.requestDate||'')&&(j.status||'awaiting')===(row.status||'awaiting')).length;
        if(legacy.length&&(legacy.length!==1||incomingMatches!==1)) {issues.push({kind,row:index+1,key:row.importKey,reason:'התאמה לא חד-משמעית לבקשה ישנה ללא מזהה מקור'});continue;}
        plan.push({kind,action:legacy.length?'adopt':'create',id:legacy[0]?.id,key:row.importKey,row});
      } else {
        const phone=normalizePhone(row.phone),email=normalizeEmail(row.email);
        const matches=people.filter((p:any)=>(phone&&p.phone===phone)||(email&&p.email?.toLowerCase()===email));
        if(matches.length>1) {issues.push({kind,row:index+1,key:row.importKey,reason:'פרטי קשר תואמים למספר אנשים'});continue;}
        let person=matches[0];
        if(!person) {person={id:'new:'+row.importKey,name:row.name,email,phone,region:row.region||null,city:row.city||null};people.push(person);}
        // No name-only identity matching. Adopt only a unique, unclaimed legacy
        // application whose recorded business fields all match this row.
        const fields=mapped(row,appFields);
        const legacy=state.applications.filter((a:any)=>a.person_id===person.id&&a.source==='excel'&&!a.import_key&&
          Object.entries(fields).every(([k,v])=>k==='contacted_at'?day(a[k])===(v||''):String(a[k]??'')===String(v??''))&&
          (a.job_id||null)===(row.jobId?Number(row.jobId):null));
        const signature=(c:any)=>JSON.stringify([normalizePhone(c.phone),normalizeEmail(c.email),mapped(c,appFields),c.jobId||null]);
        const hasEvidence=!!row.role && !!(row.summaryText || row.contactedAt);
        const incomingMatches=candidates.filter((c:any)=>signature(c)===signature(row)).length;
        if(legacy.length&&(!hasEvidence||legacy.length!==1||incomingMatches!==1)) {issues.push({kind,row:index+1,key:row.importKey,reason:'התאמה לא חד-משמעית להגשה ישנה'});continue;}
        if(row.jobId&&!state.jobs.some((j:any)=>j.id===Number(row.jobId))) throw new HttpError(400,'INVALID_JOB','המשרה שנבחרה אינה קיימת');
        plan.push({kind,action:legacy.length?'adopt':'create',id:legacy[0]?.id,key:row.importKey,person,row});
      }
    }
  }
  return {plan,issues};
}
router.post('/',asyncHandler(async(req,res)=>{
  const body=req.body||{};
  if(!['jobs','candidates'].every(k=>body[k]===undefined||Array.isArray(body[k]))) throw new HttpError(400,'INVALID_IMPORT','מבנה קובץ לא תקין');
  if(!(body.jobs?.length||body.candidates?.length)) throw new HttpError(400,'EMPTY_IMPORT','לא נשלחו נתונים');
  if((body.jobs?.length||0)+(body.candidates?.length||0)>10000) throw new HttpError(400,'IMPORT_TOO_LARGE','ניתן לייבא עד 10,000 שורות בפעולה');
  const client=await pool.connect();
  try {
    await client.query('BEGIN'); await lockPeople(client);
    // Serialize plan verification with writes, including deletes and job edits.
    await client.query('LOCK TABLE clients, jobs, people, applications IN SHARE ROW EXCLUSIVE MODE');
    const state:any={};
    for(const table of ['clients','jobs','people','applications']) state[table]=(await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    const {plan,issues}=buildImportPlan(body,state);
    const fingerprint=digest({jobs:body.jobs,candidates:body.candidates,state});
    const summary={clientsCreated:0,jobsCreated:plan.filter(p=>p.kind==='job'&&p.action==='create').length,
      jobsSkipped:plan.filter(p=>p.kind==='job'&&p.action!=='create').length,
      candidatesCreated:plan.filter(p=>p.kind==='candidate'&&p.action==='create').length,
      candidatesSkipped:plan.filter(p=>p.kind==='candidate'&&p.action!=='create').length};
    if(body.dryRun!==false) {
      await client.query('ROLLBACK');
      const previewToken=jwt.sign({purpose:'import-preview',userId:req.user!.userId,fingerprint},process.env.JWT_SECRET!,{expiresIn:'15m'});
      res.json({...summary,dryRun:true,issues,previewToken,rows:plan.map(p=>({kind:p.kind,action:p.action,key:p.key,id:p.id,personId:p.person?.id}))});return;
    }
    let approval:any;
    try {approval=jwt.verify(body.previewToken,process.env.JWT_SECRET!);} catch {throw new HttpError(409,'PREVIEW_REQUIRED','יש לבצע תצוגה מקדימה לפני הייבוא');}
    if(approval.purpose!=='import-preview'||approval.userId!==req.user!.userId||approval.fingerprint!==fingerprint)
      throw new HttpError(409,'PREVIEW_CHANGED','הנתונים השתנו מאז הבדיקה. יש לבדוק שוב לפני הייבוא.');
    if(issues.length) throw new HttpError(409,'AMBIGUOUS_IMPORT','יש לפתור את ההתאמות הלא חד-משמעיות לפני הייבוא');
    const newPeople=new Map();
    async function insert(table:string,data:any) {
      const keys=Object.keys(data);
      return (await client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(data))).rows[0].id;
    }
    for(const p of plan) {
      if(p.action==='skip') continue;
      const table=p.kind==='job'?'jobs':'applications';
      if(p.action==='adopt') {await client.query(`UPDATE ${table} SET import_key=$2 WHERE id=$1`,[p.id,p.key]);continue;}
      if(p.kind==='job') {
        const name=(p.row.clientName||'').trim(); let cid=state.clients.find((c:any)=>c.name.trim()===name)?.id||null;
        if(name&&!cid) {cid=await insert('clients',{name});state.clients.push({id:cid,name});summary.clientsCreated++;}
        const n=(await client.query("SELECT nextval('jobs_number_seq') AS n")).rows[0].n;
        await insert('jobs',{...mapped(p.row,jobFields),status:p.row.status||'awaiting',client_id:cid,job_number:String(n),import_key:p.key});
      } else {
        let pid=p.person.id;
        if(typeof pid==='string'&&pid.startsWith('new:')) {
          if(!newPeople.has(pid)) {const {id,...data}=p.person;newPeople.set(pid,await insert('people',data));}
          pid=newPeople.get(pid);
        }
        await insert('applications',{...mapped(p.row,appFields),person_id:pid,job_id:p.row.jobId?Number(p.row.jobId):null,
          source:'excel',stage:stageFor(p.row),notes:'',import_key:p.key,outcome_status:p.row.noAnswer?'אין מענה':p.row.outcomeStatus||null});
      }
    }
    await client.query('COMMIT');res.json(summary);
  } catch(err) {await client.query('ROLLBACK');throw err;} finally {client.release();}
}));
function stageFor(c:any):string {
  const s=String(c.outcomeStatus||'');
  if(s.includes('גוייס'))return 'staffed';
  if(/נפסל|שלילה|הסיר|לא תואמ|לא מחפש|ביטל|נטש|צ"ש/.test(s))return 'rejected';
  if(c.clientApproved)return 'client_approved';if(c.sentToClient)return 'cv_to_client';if(c.interviewedTeams)return 'phone';return 'applied';
}
export default router;
