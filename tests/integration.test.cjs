const assert=require('node:assert/strict');
const crypto=require('node:crypto');
// Deliberately refuses to run against any non-test database.
process.env.DATABASE_URL='postgres://yossi@localhost:55439/hr_hardening_test';
process.env.JWT_SECRET='test-only-'+crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
process.env.FRONTEND_URL='http://localhost:55440';
process.env.BOOTSTRAP_ADMIN_USER='test-admin';process.env.BOOTSTRAP_ADMIN_PASSWORD='initial-test-password';
const {pool}=require('../backend/dist/db/pool.js');
const {runMigrations}=require('../backend/dist/db/runMigrations.js');
const {bootstrapAdmin}=require('../backend/dist/db/bootstrapAdmin.js');
const {app}=require('../backend/dist/app.js');
const jwt=require('../backend/node_modules/jsonwebtoken');
const bcrypt=require('../backend/node_modules/bcrypt');
let server,base,cookie;
async function request(path,method='GET',body,options={}) {
 const headers={'Content-Type':'application/json','X-HBC-Request':'1',...(cookie?{Cookie:cookie}:{}),...options.headers};
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}
 return {status:r.status,body:value,headers:r.headers};
}
const patch=(c,fields)=>({...fields,expectedVersion:c.version,expectedPersonVersion:c.personVersion});
(async()=>{
 await Promise.all([runMigrations(),runMigrations()]);
 await pool.query('TRUNCATE person_merge_archive, oauth_states, applications, people, jobs, clients, users RESTART IDENTITY CASCADE');
 await bootstrapAdmin();
 const hash=await bcrypt.hash('changed-password',4);
 await pool.query('UPDATE users SET password_hash=$1',[hash]);await bootstrapAdmin();
 assert.equal((await pool.query('SELECT password_hash FROM users')).rows[0].password_hash,hash,'bootstrap preserves password');
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/api/candidates','/api/jobs','/api/clients','/api/settings','/api/people/duplicates'])assert.equal((await request(path)).status,401,path);
 assert.equal((await request('/health')).body.release,undefined);
 let r=await request('/api/auth/login','POST',{username:'test-admin',password:'changed-password'});
 assert.equal(r.status,200);assert.equal(r.body.token,undefined);assert.match(r.headers.get('set-cookie'),/HttpOnly/);cookie=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/auth/me')).status,200);
 assert.equal((await request('/api/candidates','POST',{name:'CSRF'},{headers:{'X-HBC-Request':''}})).status,403);
 assert.equal((await request('/api/candidates','POST',{name:'Invalid',jobId:'NaN'})).status,400);
 assert.equal((await request('/api/candidates/NaN','PATCH',{})).status,400);
 const a=(await request('/api/candidates','POST',{name:'אדם לבדיקה',phone:'050-1234567',salaryExpectation:12000,interviewedTeams:true,rejectedBy:'client',rejectionReason:'test',doNotRehire:true}));
 assert.equal(a.status,201,JSON.stringify(a.body));assert.equal(a.body.interviewedTeams,true);assert.equal(a.body.rejectedBy,'client');assert.equal(a.body.doNotRehire,true);
 const countBefore=(await pool.query('SELECT count(*) FROM people')).rows[0].count;
 assert.equal((await request('/api/candidates','POST',{name:'Rollback',jobId:99999})).status,400);
 assert.equal((await pool.query('SELECT count(*) FROM people')).rows[0].count,countBefore,'create rolls back person too');
 assert.equal((await request('/api/candidates/'+a.body.id,'PATCH',{salaryExpectation:13000})).status,428);
 const updated=await request('/api/candidates/'+a.body.id,'PATCH',patch(a.body,{salaryExpectation:13000}));assert.equal(updated.status,200);
 assert.equal((await request('/api/candidates/'+a.body.id,'PATCH',patch(a.body,{city:'Stale'}))).status,409);
 const second=await request('/api/candidates','POST',{name:a.body.name,personId:a.body.personId,expectedPersonVersion:updated.body.personVersion});assert.equal(second.status,201);
 const personUpdate=await request('/api/candidates/'+a.body.id,'PATCH',patch(updated.body,{city:'New city'}));assert.equal(personUpdate.status,200);
 assert.equal((await request('/api/candidates/'+second.body.id,'PATCH',patch(second.body,{city:'Stale across applications'}))).status,409);
 const race=await Promise.all([request('/api/candidates','POST',{name:'race-a',phone:'0521112222'}),request('/api/candidates','POST',{name:'race-b',phone:'+972521112222'})]);
 assert.deepEqual(race.map(r=>r.status).sort(),[201,409],'phone creation serialized');
 let payload={candidates:[{name:'ייבוא',phone:'0531112222',role:'תפקיד א',importKey:'row:1'},{name:'ייבוא',phone:'0531112222',role:'תפקיד ב',importKey:'row:2'},{name:'אותו שם',importKey:'row:3'},{name:'אותו שם',importKey:'row:4'}],jobs:[{title:'משרה',clientName:'לקוח',importKey:'job:1'}]};
 const before=(await pool.query('SELECT count(*) FROM applications')).rows[0].count;
 let preview=await request('/api/import','POST',{...payload,dryRun:true});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.candidatesCreated,4);
 assert.equal((await pool.query('SELECT count(*) FROM applications')).rows[0].count,before,'dry run writes nothing');
 r=await request('/api/import','POST',{...payload,dryRun:false,previewToken:preview.body.previewToken});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.candidatesCreated,4);
 const imported=(await pool.query("SELECT * FROM applications WHERE source='excel' ORDER BY id")).rows;
 assert.equal(imported[0].person_id,imported[1].person_id);assert.notEqual(imported[2].person_id,imported[3].person_id);assert.ok(imported.every(a=>a.job_id===null));
 preview=await request('/api/import','POST',{...payload,dryRun:true});assert.equal(preview.body.candidatesCreated,0);assert.equal(preview.body.candidatesSkipped,4);
 assert.equal((await request('/api/import','POST',{candidates:[{name:'Keyless'}],dryRun:true})).status,400);
 const changed=await request('/api/candidates','POST',{name:'Changes preview'});assert.equal(changed.status,201);
 assert.equal((await request('/api/import','POST',{...payload,dryRun:false,previewToken:preview.body.previewToken})).status,409);
 // Malformed history must preserve raw bytes and allow ordinary edits.
 await pool.query('UPDATE applications SET notes=$2 WHERE id=$1',[a.body.id,'legacy<!--HBC_EVENTS_V1:bm90LWpzb24=-->']);
 let fresh=(await request('/api/candidates')).body.find(c=>c.id===a.body.id);
 r=await request('/api/candidates/'+fresh.id,'PATCH',patch(fresh,{city:'Safe edit',notes:'human note'}));assert.equal(r.status,200);assert.ok(r.body.historyWarnings.length);assert.match(r.body.notes,/bm90LWpzb24=/);
 // Matching prefers this job's application and bounds output.
 const job=(await request('/api/jobs','POST',{title:'Developer'})).body;
 assert.equal((await request('/api/jobs/'+job.id+'/match','POST',{limit:10000})).status,400);
 assert.equal((await request('/api/candidates/'+a.body.id+'/analyze','POST',{file:{filename:'bad.pdf',mimeType:'application/pdf',dataBase64:'YWJj'}})).status,400);
 // Session tokens and OAuth state are purpose-separated.
 const state=jwt.sign({purpose:'oauth-state',userId:1,provider:'google'},process.env.JWT_SECRET);
 assert.equal((await request('/api/candidates','GET',undefined,{headers:{Authorization:'Bearer '+state}})).status,401);
 assert.equal((await request('/api/oauth/google/callback?code=x&state=invalid')).status,302);
 // Stub only external providers; exercise the actual OAuth and scan routes/SQL.
 const provider=require('../backend/dist/providers/index.js').getProvider('google');
 provider.isConfigured=()=>true;
 provider.authUrl=state=>'https://provider.test/?state='+state;
 provider.exchangeCode=async()=>({accessToken:'test-access',refreshToken:'test-refresh',expiresAt:new Date(Date.now()+3600000),accountEmail:'test@example.invalid'});
 provider.refreshAccessToken=provider.exchangeCode;
 provider.searchMessages=async()=>[{extKey:'test-message:1',providerMessageId:'message-1',hasAttachment:false,name:'Scan race',email:'scan@example.invalid',subject:'test',snippet:'test',date:'',link:''}];
 const start=await request('/api/oauth/google/start');assert.equal(start.status,200);
 const oauthState=new URL(start.body.url).searchParams.get('state');
 const callback='/api/oauth/google/callback?code=test&state='+encodeURIComponent(oauthState);
 assert.match((await request(callback)).headers.get('location'),/connected=google/);
 assert.match((await request(callback)).headers.get('location'),/expired_or_used_state/);
 const scans=await Promise.all([request('/api/scan','POST',{}),request('/api/scan','POST',{})]);
 assert.equal(scans.reduce((n,r)=>n+r.body.added,0),1);
 assert.equal((await pool.query("SELECT count(*) FROM people WHERE email='scan@example.invalid'")).rows[0].count,'1');
 // This job's application wins even when another application has newer AI.
 const matchingPerson=(await pool.query("INSERT INTO people(name) VALUES('Matching test') RETURNING id")).rows[0].id;
 const targetApp=(await pool.query("INSERT INTO applications(person_id,job_id,role) VALUES($1,$2,'Developer') RETURNING id",[matchingPerson,job.id])).rows[0].id;
 await pool.query("INSERT INTO applications(person_id,role,ai) VALUES($1,'Unrelated',$2)",[matchingPerson,{summary:'Unrelated',candidateName:'English Name'}]);
 const ranked=await request('/api/jobs/'+job.id+'/match','POST',{limit:100});
 assert.ok(ranked.body.results.some(r=>r.candidateId===String(targetApp)));
 const big=await request('/api/clients','POST',{name:'size check',notes:'x'.repeat(1024*1024+1)});
 assert.equal(big.status,413);assert.equal(big.body.code,'PAYLOAD_TOO_LARGE');assert.ok(big.body.requestId);
 // Real DB legacy duplicate merge, Hebrew preference, preserved applications, undo.
 const p1=(await pool.query("INSERT INTO people(name,phone) VALUES('David Cohen','0541234567') RETURNING id")).rows[0].id;
 const p2=(await pool.query("INSERT INTO people(name,phone) VALUES('דוד כהן','+972-54-1234567') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO applications(person_id,source,notes) VALUES($1,'manual','first'),($2,'manual','second')",[p1,p2]);
 const originalAppCount=(await pool.query('SELECT count(*) FROM applications')).rows[0].count;
 const dup=await request('/api/people/duplicates');
 r=await request('/api/people/merge-duplicates','POST',{token:dup.body.token});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.merged,1);
 const merged=(await pool.query('SELECT * FROM people WHERE id=$1',[p1])).rows[0];assert.equal(merged.name,'דוד כהן');
 assert.equal((await pool.query('SELECT count(*) FROM applications')).rows[0].count,originalAppCount);
 assert.equal((await pool.query('SELECT count(*) FROM applications WHERE person_id=$1',[p1])).rows[0].count,'2');
 const undo=await request('/api/people/undo-merge/'+r.body.archiveIds[0],'POST',{});assert.equal(undo.status,200,JSON.stringify(undo.body));
 assert.equal((await pool.query('SELECT name FROM people WHERE id=$1',[p2])).rows[0].name,'דוד כהן');
 await request('/api/auth/logout','POST',{});
 console.log('PASS: migrations/concurrent startup, bootstrap, auth/cookies/CSRF, validation, atomic create, stale edits across applications, concurrent dedup, import preview/replay/multiple applications, damaged history, matcher limits, OAuth purpose/replay, concurrent scans, match relevance, payload limits, merge/undo');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
