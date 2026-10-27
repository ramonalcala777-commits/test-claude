const fs=require('fs'),zlib=require('zlib');
const M=JSON.parse(fs.readFileSync('/home/claude/simulador/grid/meta.json'));const d0=Date.parse(M.d0);
const O=JSON.parse(fs.readFileSync('/home/claude/simulador/obs/obs_cal.json')).pist.Kerman;
const b=zlib.gunzipSync(fs.readFileSync(`/home/claude/simulador/grid/celdas/1587.bin.gz`));const a=new Int16Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));const nd=M.nd;
const cp=a.subarray(2*nd,3*nd),gd=a.subarray(3*nd,4*nd);
const di=(y,m,d)=>Math.round((Date.UTC(y,m-1,d)-d0)/864e5);
for(const cap of [999,75,80,85,90,95]){const err=[];for(const y of [2018,2019,2020,2021,2022,2023]){const s=di(y-1,9,1),e=di(y,8,31);let c=0,ic=-1;for(let i=s;i<e;i++){c+=cp[i]/100;if(c>=90){ic=i;break}}
 const capi=di(y,1,1)+cap-1; if(ic<0||ic>capi) ic=capi; let g=0,f=-1;for(let i=ic+1;i<e;i++){g+=gd[i];if(g>=6800){f=i;break}}
 const doy=f<0?null:f-di(y,1,1)+1; err.push(y+':'+(doy==null?'-':doy-O[y]))}console.log('tope',cap,err.join(' '))}
