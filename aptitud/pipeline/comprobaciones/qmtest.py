import sys; sys.path.insert(0,'/home/claude/simulador')
import numpy as np, json, os, datetime as dt
from pipeline import load_grid, nearest_cell, daily_minmax, km, T0, ROOT
g,M=load_grid(); st=json.load(open(os.path.join(ROOT,'siar','estaciones.json')))
d0=(T0+dt.timedelta(hours=1)).date()
D={}
for e in st:
    fn=os.path.join(ROOT,'siar',e['id']+'.csv')
    if not os.path.exists(fn): continue
    la,lo=e['lat'],e['lon']
    if not (min(g['lat'])-.05<=la<=max(g['lat'])+.05 and min(g['lon'])-.05<=lo<=max(g['lon'])+.05): continue
    c=nearest_cell(g,la,lo); ser=M[:,c].astype(np.float32); ser[ser==-32768]=np.nan; ser/=100
    emn,_=daily_minmax(ser); smn={}
    for line in open(fn):
        p=line.strip().split(';')
        if len(p)!=3 or not p[1] or not p[2]: continue
        dd,mm,yy=p[0].split('/'); k=(dt.date(int(yy),int(mm),int(dd))-d0).days
        if 0<=k<emn.size:
            mx,mn=float(p[1].replace(',','.')),float(p[2].replace(',','.'))
            if -25<mn<35 and -15<mx<48 and mx>=mn and not(mx==0 and mn==0): smn[k]=mn
    if len(smn)<365*5: continue
    ks=np.array(sorted(smn)); D[e['id']]=dict(la=la,lo=lo,c=c,ks=ks,st=np.array([smn[k] for k in ks]),er=emn[ks],emn=emn,
        mo=np.array([(d0+dt.timedelta(days=int(k))).month for k in ks]))
print('estaciones',len(D),flush=True)
months_all=None
def table(d,QS,pool):
    tab=[]
    for m in range(1,13):
        mm=[m] if not pool else [((m-2)%12)+1,m,(m%12)+1]
        sel=np.isfinite(d['er'])&np.isin(d['mo'],mm)
        a,b=np.quantile(d['er'][sel],QS),np.quantile(d['st'][sel],QS)
        tab.append(np.c_[a,b-a])
    return tab
cfgs0={'actual':(np.array([0.01,0.05,0.1,0.2,0.3,0.5,0.7,0.9,0.99]),False),
      'fino':(np.array([0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.3,0.5,0.7,0.9,0.99]),False),
      'fino+pool':(np.array([0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.3,0.5,0.7,0.9,0.99]),True)}
cfgs={'actual':cfgs0['actual']}
T={k:{i:table(d,*v) for i,d in D.items()} for k,v in cfgs.items()}
ids=list(D)
res={k:{'all':[],'f3':[],'f5':[],'spr':[],'O':[],'P':[],'MO':[]} for k in cfgs}
for i in ids:
    d=D[i]; others=sorted(((km(d['la'],d['lo'],D[j]['la'],D[j]['lo']),j) for j in ids if j!=i))[:3]
    w=np.array([1/max(x,3)**2 for x,_ in others]); w/=w.sum()
    sel=np.isfinite(d['er'])
    for k in cfgs:
        A=np.zeros(len(d['ks']))
        for (dist,j),wi in zip(others,w):
            for m in range(1,13):
                s=d['mo']==m; q=T[k][j][m-1]; A[s]+=wi*np.interp(d['er'][s],q[:,0],q[:,1])
        corr=d['er']+A; err=(corr-d['st'])[sel]; stv=d['st'][sel]; mo=d['mo'][sel]
        res[k]['all']+=list(err); res[k]['f3']+=list(err[stv<=-3]); res[k]['f5']+=list(err[stv<=-6])
        res[k]['spr']+=list(err[(stv<=-2)&np.isin(mo,[3,4])]); res[k]['O']+=list(stv); res[k]['P']+=list(corr[sel]); res[k]['MO']+=list(mo)
for k,r in res.items():
    f=lambda a:f"sesgo {np.mean(a):+.2f} rmse {np.sqrt(np.mean(np.square(a))):.2f} n={len(a)}"
    print(k.ljust(10),'| todo',f(r['all']),'| Tmin<=-3',f(r['f3']),'| Tmin<=-6',f(r['f5']),'| mar-abr <=-2',f(r['spr']))

for k,r in res.items():
    O=np.array(r['O']);P=np.array(r['P']);MO=np.array(r['MO']);sp=np.isin(MO,[3,4])
    for th in [-2,-3,-4,-6,-10]:
        print(k,'umbral',th,'freq obs %.4f  modelo %.4f'%((O<=th).mean(),(P<=th).mean()),'| mar-abr obs %.4f modelo %.4f'%((O[sp]<=th).mean(),(P[sp]<=th).mean()),'| sesgo cuando modelo<=th %+.2f'%(P[P<=th]-O[P<=th]).mean() if (P<=th).any() else '')
