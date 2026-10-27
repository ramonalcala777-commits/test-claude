const fs=require('fs'),zlib=require('zlib');globalThis.window=globalThis;
require('/home/claude/simulador/web/config.js');require('/home/claude/simulador/web/motor.js');
const CFG=globalThis.CONFIG;const M=JSON.parse(fs.readFileSync('/home/claude/simulador/grid/meta.json'));const d0=Date.parse(M.d0);
const i=M.lat.reduce((b,v,k)=>Math.abs(v-38.95)<Math.abs(M.lat[b]-38.95)?k:b,0),j=M.lon.reduce((b,v,k)=>Math.abs(v+3.95)<Math.abs(M.lon[b]+3.95)?k:b,0);
const b=zlib.gunzipSync(fs.readFileSync(`/home/claude/simulador/grid/celdas/${i*47+j}.bin.gz`));const c=Motor.cellArrays(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),M.nd);
const r=Motor.pistachio(c,d0,CFG.pist).res;const f=d=>new Date(Date.UTC(2011,0,d)).toISOString().slice(5,10);
for(const y of [2001,2004,2011]) console.log(y,Object.entries(r).map(([n,v])=>{const x=v.rows.find(q=>q&&q.y===y);return n+' '+(x?new Date(Date.UTC(y,0,x.fb)).toISOString().slice(5,10):'-')}).join(' | '));
// media 1999-2004
console.log('media 99-04',Object.entries(r).map(([n,v])=>{const xs=v.rows.filter(q=>q&&q.y>=1999&&q.y<=2004);return n+' '+f(Math.round(xs.reduce((s,q)=>s+q.fb,0)/xs.length))}).join(' | '));
