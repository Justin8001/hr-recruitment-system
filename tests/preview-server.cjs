// Isolated local UI fixture. Never copied to the production web/ directory.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const fixture = {id:'test-1',personId:'person-test',version:'1',personVersion:'1',name:'מועמד בדיקה',email:'',phone:'',jobId:'1',jobTitle:'משרת בדיקה א׳',stage:'rejected',outcomeStatus:'נפסל ע"י לקוח',rejectionReason:'ללא ניסיון נדרש',notes:'תיעוד קודם',addedAt:'2026-03-01',source:'manual'};
let stored = structuredClone(fixture);
const jobs = [{id:'1',jobNumber:'101',title:'משרת בדיקה א׳',clientId:'A',clientName:'לקוח בדיקה א׳',status:'awaiting'}, {id:'2',jobNumber:'102',title:'משרת בדיקה ב׳',clientId:'B',clientName:'לקוח בדיקה ב׳',status:'awaiting'}];
http.createServer(async (req,res)=>{
  if (req.url.startsWith('/api/candidates/test-1') && req.method==='PATCH') {
    const chunks=[]; for await (const c of req) chunks.push(c);
    const patch=JSON.parse(Buffer.concat(chunks));
    const {appendHistory}=require('../backend/dist/lib/history.js');
    if(patch.expectedVersion!==stored.version||patch.expectedPersonVersion!==stored.personVersion){res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'conflict'}));}
    patch.notes=appendHistory(stored,patch,'local-test');stored={...stored,...patch,version:String(Number(stored.version)+1)};
    res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(stored));
  }
  if(req.url==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.API_BASE=location.origin;');}
  if(req.url==='/logo.png'){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync(path.join(root,'logo.png')));}
  if(req.url==='/' || req.url==='/index.html'){
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const boot=`setupAccessibility(); candidates=${JSON.stringify([stored])}; jobs=${JSON.stringify(jobs)}; showApp(); renderAll(); openEditModal('test-1');`;
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html.replace(/\/\* ---------- Init ---------- \*\/[\s\S]*?<\/script>/,boot+'</script>'));
  }
  res.writeHead(404);res.end();
}).listen(4198,'127.0.0.1',()=>console.log('Local fixture: http://127.0.0.1:4198'));
