const path=require('node:path');
process.env.DATABASE_URL='postgres://yossi@localhost:55439/hr_hardening_test';
process.env.JWT_SECRET='local-ui-test-secret-not-used-outside-test-database';
process.env.FRONTEND_URL='http://127.0.0.1:55440';
const {app}=require('../backend/dist/app.js');
const express=require('../backend/node_modules/express');
app.use((_req,res,next)=>{res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'");next();});
app.use(express.static(path.join(__dirname,'../web')));
app.listen(55440,'127.0.0.1',()=>console.log('Isolated local review: http://127.0.0.1:55440'));
