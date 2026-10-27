const fs=require('fs'),zlib=require('zlib');globalThis.window=globalThis;
require('/home/claude/simulador/web/config.js');require('/home/claude/simulador/web/motor.js');
const M=JSON.parse(fs.readFileSync('/home/claude/simulador/grid/meta.json'));const d0=Date.parse(M.d0);
const L=c=>{const b=zlib.gunzipSync(fs.readFileSync(`/home/claude/simulador/grid/celdas/${c}.bin.gz`));return Motor.cellArrays(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),M.nd)};
const di=(y,m,d)=>Math.round((Date.UTC(y,m-1,d)-d0)/864e5);const f=(y,doy)=>new Date(Date.UTC(y,0,doy)).toISOString().slice(5,10);
// Villarrobledo Kerman 2026
for(const [n,c] of [['Villarrobledo',1111],['La Vega',1209],['Albacete',1068],['Caravaca',1587]]){const x=L(c);const P=Motor.pistachio(x,d0,CONFIG.pist).res;const A=Motor.almond(x,d0,CONFIG.alm).res;
 const k=P.Kerman.rows.filter(Boolean).slice(-4).map(r=>r.y+':'+f(r.y,r.fb)+' pérd '+r.loss+'% cos '+(r.harv>0?f(r.y,r.harv):'-'));
 const g=A.Guara.rows.filter(Boolean).slice(-3).map(r=>r.y+':'+f(r.y,r.fb)+' pérd '+r.loss+'%');
 const t=[];for(let i=di(2026,3,1);i<=di(2026,4,30);i++){const v=x.tmin[i]/10;if(v<=-1)t.push(new Date(d0+i*864e5).toISOString().slice(5,10)+' '+v)}
 console.log(n,'| Kerman',k.join(' | '),'\n   Guara',g.join(' | '),'\n   heladas mar-abr 2026:',t.join(', '))}
