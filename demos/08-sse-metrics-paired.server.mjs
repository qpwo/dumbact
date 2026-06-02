import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,'..');
const app=express(),port=Number(process.env.PORT||7308);
function clientHtml(){return readFileSync(join(here,'08-sse-metrics-paired.html'),'utf8').replace('../dumbact.js','/dumbact.js')}
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set('access-control-allow-origin','*');res.set('access-control-allow-methods','GET,OPTIONS');res.set('access-control-allow-headers','content-type');res.set('access-control-allow-private-network','true');if(req.method==='OPTIONS')return res.status(204).end();next();});
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.get('/dumbact.js',(_req,res)=>res.type('application/javascript').send(readFileSync(join(root,'dumbact.js'),'utf8')));
app.get('/',(_req,res)=>res.type('html').send(clientHtml()));
app.get('/events',(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','connection':'keep-alive'});let count=0;function send(){count++;const data={count,cpu:(count*19+37)%100,mem:(count*23+41)%100};res.write(`event: metric\ndata: ${JSON.stringify(data)}\n\n`)}send();const timer=setInterval(send,650);req.on('close',()=>clearInterval(timer));});
app.listen(port,()=>console.log(`sse http://127.0.0.1:${port}`));
