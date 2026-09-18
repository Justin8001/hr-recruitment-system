import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import peopleRoutes from './routes/people.js';
import { HttpError, errorHandler } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import candidateRoutes from './routes/candidates.js';
import clientRoutes from './routes/clients.js';
import jobRoutes from './routes/jobs.js';
import settingsRoutes from './routes/settings.js';
import oauthRoutes from './routes/oauth.js';
import connectionRoutes from './routes/connections.js';
import scanRoutes from './routes/scan.js';
import importRoutes from './routes/importData.js';

export const app = express();
app.disable('x-powered-by');

// Behind a reverse proxy (e.g. Render) req.ip should reflect the real client IP
app.set('trust proxy', 1);

app.use((_req,res,next)=>{res.setHeader('X-Request-Id',randomUUID());res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const json=res.json.bind(res);res.json=(body:any)=>json(res.statusCode>=400 && body?.error ? {code:'REQUEST_FAILED',requestId:res.getHeader('X-Request-Id'),...body}:body);next();});
app.use(cors({ origin: (origin, cb) => {
  const allowed=process.env.FRONTEND_URL?.replace(/\/$/,'');
  cb(null, !origin || (!!allowed && origin===allowed));
}, credentials:true }));
app.use((req,_res,next)=>{
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers['x-hbc-request']!=='1')
    return next(new HttpError(403,'CSRF_CHECK_FAILED','יש לרענן את האתר ולנסות שוב'));
  next();
});
const smallJson=express.json({limit:'1mb'}), importJson=express.json({limit:'10mb'}), uploadJson=express.json({limit:'22mb'});
app.use((req,res,next)=>{
  const parser=/^\/api\/candidates\/\d+\/analyze$/.test(req.path)?uploadJson:req.path==='/api/import'?importJson:smallJson;
  parser(req,res,next);
});
app.get('/health',(_req,res)=>res.json({status:'ok'}));
app.use('/api/people',peopleRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/import', importRoutes);

app.use(errorHandler);

