import { loadMeta, saveMeta, loadRun, saveRun, clearRun, resetCampaign } from './storage.js?v=5.2.0';

const $ = s => document.querySelector(s);
const canvas = $('#gameCanvas'), ctx = canvas.getContext('2d');
const minimap = $('#minimapCanvas'), mctx = minimap.getContext('2d');
ctx.imageSmoothingEnabled = true; mctx.imageSmoothingEnabled = true;

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const RESUME = params.has('resume');
const NEW_RUN = params.has('new');
const meta = loadMeta();
if (NEW_RUN) clearRun();
if (DEBUG) $('#debugPanel').classList.remove('hidden');

const STAGES = {
  1:{name:'추락지점',w:2400,h:1500,time:600,diff:1,exchange:0,bases:[['W','서부 전초기지','outpost',.18,.34],['E','동부 전초기지','outpost',.82,.37],['C','북부 지휘기지','command',.50,.13]]},
  2:{name:'폐허 외곽',w:2800,h:1750,time:600,diff:1.12,exchange:0,bases:[['W','서부 전초기지','outpost',.18,.33],['E','동부 전초기지','outpost',.82,.34],['F','남부 생산기지','factory',.30,.82],['C','북부 지휘기지','command',.52,.12]]},
  3:{name:'산업지대',w:3200,h:1950,time:600,diff:1.25,exchange:1,bases:[['W','서부 전초기지','outpost',.16,.32],['E','동부 전초기지','outpost',.84,.32],['F','남서 생산기지','factory',.25,.82],['T','동남 요새','fortress',.78,.80],['C','북부 지휘기지','command',.50,.11]]},
  4:{name:'고지대',w:3600,h:2200,time:600,diff:1.4,exchange:1,bases:[['W1','서부 전초기지','outpost',.15,.30],['E1','동부 전초기지','outpost',.85,.31],['F','남서 생산기지','factory',.23,.82],['T','동남 요새','fortress',.80,.80],['M','북서 요새','fortress',.29,.17],['C','북부 지휘기지','command',.57,.11]]},
  5:{name:'봉쇄선',w:4000,h:2500,time:600,diff:1.58,exchange:2,bases:[['W1','서부 전초기지','outpost',.13,.31],['E1','동부 전초기지','outpost',.87,.31],['F1','남서 생산기지','factory',.20,.83],['F2','남동 생산기지','factory',.82,.82],['T1','서북 요새','fortress',.30,.16],['T2','동북 요새','fortress',.72,.17],['C','북부 지휘기지','command',.51,.08]]}
};

// V5.2 balance target: low enemy HP + high count + increasingly dense hordes.
// cap protects mobile performance; hp/dmg stay modest while spawn pressure rises sharply.
const STAGE_BALANCE={
  1:{hp:.88,dmg:.90,karma:1.00,cap:180,hordeStart:26,hordeEnd:11,hordeBase:7,hordeGrowth:14},
  2:{hp:.94,dmg:.98,karma:1.04,cap:210,hordeStart:24,hordeEnd:10,hordeBase:9,hordeGrowth:16},
  3:{hp:1.00,dmg:1.06,karma:1.08,cap:235,hordeStart:22,hordeEnd:9,hordeBase:11,hordeGrowth:18},
  4:{hp:1.06,dmg:1.14,karma:1.12,cap:260,hordeStart:20,hordeEnd:8,hordeBase:13,hordeGrowth:21},
  5:{hp:1.12,dmg:1.22,karma:1.16,cap:285,hordeStart:18,hordeEnd:7.5,hordeBase:15,hordeGrowth:24}
};

const stored = !NEW_RUN ? loadRun() : null;
let stageId = RESUME && stored ? Number(stored.stageId)||1 : Number(params.get('stage')||stored?.stageId||1);
stageId = Math.max(1,Math.min(5,stageId));
if (!RESUME && stageId > Math.max(1,meta.maxStageUnlocked)) stageId = Math.max(1,Math.min(5,meta.maxStageUnlocked));
const STAGE = STAGES[stageId];
const BAL=STAGE_BALANCE[stageId];
const W=STAGE.w,H=STAGE.h,GAME_LENGTH=STAGE.time;

const wreck={x:W/2,y:H/2,r:82};
const campaign = meta.campaign || {active:false,credits:0,attack:15,defense:0,speed:190,nextStage:1};
const runStats={attack:Number(campaign.attack)||15,defense:Number(campaign.defense)||0,speed:Number(campaign.speed)||190};
const player={kind:'player',type:'rifle',x:wreck.x+140,y:wreck.y+10,r:15,maxHp:100,hp:100,burstShots:0,burstClock:0,fireClock:0,aim:0,recoil:0,muzzle:0,hit:0};
const cam={x:player.x,y:player.y};
let enemies=[],enemyBullets=[],tracers=[],particles=[],corpses=[],floating=[];
let gameTime=0,runKarma=0,credits=Number(campaign.credits)||0,kills=0,destroyedBases=0,paused=false,ended=false,finalHold=0,finalDestroyed=false;
let stimRemaining=0,hordeClock=18,lastSurgeLevel=1;
let last=performance.now(),autosaveClock=0,bannerClock=0,lastTerrain='',terrainClock=0;
const keys={};
let soundOn=meta.settings.sound!==false,audioCtx=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}function rand(a,b){return a+Math.random()*(b-a)}function d(a,b){return Math.hypot(a.x-b.x,a.y-b.y)};
function keyLabel(code){return (code||'KeyR').replace('Key','').replace('Digit','')}

// ---------- MAP / TERRAIN ----------
const roads=[],swamps=[],forests=[],plateaus=[],obstacles=[];
function buildTerrain(){
  for(const spec of STAGE.bases){roads.push({x1:wreck.x,y1:wreck.y,x2:spec[3]*W,y2:spec[4]*H,w:50});}
  swamps.push({x:W*.34,y:H*.69,r:Math.min(W,H)*.085},{x:W*.71,y:H*.43,r:Math.min(W,H)*.07});
  forests.push({x:W*.77,y:H*.28,r:Math.min(W,H)*.10},{x:W*.27,y:H*.31,r:Math.min(W,H)*.09});
  if(stageId>=2)plateaus.push({x:W*.40,y:H*.05,w:W*.22,h:H*.20});
  if(stageId>=4)plateaus.push({x:W*.68,y:H*.66,w:W*.20,h:H*.22});
  const rockCount=7+stageId*3;
  for(let i=0;i<rockCount;i++){
    const a=(i*2.399)+stageId*.7,r=Math.min(W,H)*(.20+.055*(i%5));
    const x=clamp(wreck.x+Math.cos(a)*r,90,W-90),y=clamp(wreck.y+Math.sin(a)*r,90,H-90);
    if(Math.hypot(x-wreck.x,y-wreck.y)<250)continue;
    obstacles.push(i%3===0?{type:'rect',x:x-55,y:y-35,w:110,h:70,kind:'ruin'}:{type:'circle',x,y,r:34+(i%4)*8,kind:'rock'});
  }
  for(const p of plateaus){
    obstacles.push({type:'rect',x:p.x,y:p.y,w:28,h:p.h,kind:'cliff'},{type:'rect',x:p.x+p.w-28,y:p.y,w:28,h:p.h,kind:'cliff'},{type:'rect',x:p.x,y:p.y,w:p.w,h:26,kind:'cliff'});
    const gap=p.w*.24; obstacles.push({type:'rect',x:p.x,y:p.y+p.h-26,w:(p.w-gap)/2,h:26,kind:'cliff'},{type:'rect',x:p.x+(p.w+gap)/2,y:p.y+p.h-26,w:(p.w-gap)/2,h:26,kind:'cliff'});
  }
}
buildTerrain();
function pointRect(x,y,r){return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h}
function circleRect(x,y,rad,r){const nx=clamp(x,r.x,r.x+r.w),ny=clamp(y,r.y,r.y+r.h);return Math.hypot(x-nx,y-ny)<rad}
function blockedStatic(x,y,rad=12,ignoreBaseId=null,projectile=false){if(x<rad||x>W-rad||y<rad||y>H-rad)return true;for(const o of obstacles){if(o.type==='circle'&&Math.hypot(x-o.x,y-o.y)<rad+o.r)return true;if(o.type==='rect'&&circleRect(x,y,rad,o))return true}if(!projectile&&Math.hypot(x-wreck.x,y-wreck.y)<rad+wreck.r*.72)return true;if(typeof enemyBases!=='undefined'){for(const b of enemyBases){if(b.id===ignoreBaseId)continue;const rr=b.alive?b.r*.76:b.r*.52;if(Math.hypot(x-b.x,y-b.y)<rad+rr)return true}}return false}
function blocked(x,y,rad=12){return blockedStatic(x,y,rad)}
function terrainAt(x,y){for(const z of swamps)if(Math.hypot(x-z.x,y-z.y)<z.r)return {name:'늪지 · 이동속도 감소',speed:.78,vision:1};for(const z of forests)if(Math.hypot(x-z.x,y-z.y)<z.r)return {name:'수풀 · 시야 감소',speed:.94,vision:.78};for(const z of plateaus)if(pointRect(x,y,z))return {name:'고지대 · 사거리 증가',speed:1,vision:1.17,high:true};for(const r of roads){const vx=r.x2-r.x1,vy=r.y2-r.y1,c=vx*vx+vy*vy||1,t=clamp(((x-r.x1)*vx+(y-r.y1)*vy)/c,0,1);if(Math.hypot(x-(r.x1+t*vx),y-(r.y1+t*vy))<r.w/2)return {name:'도로 · 이동속도 증가',speed:1.08,vision:1}}return{name:'',speed:1,vision:1}}
function move(u,nx,ny,speed,dt){const step=speed*terrainAt(u.x,u.y).speed*dt,ox=u.x,oy=u.y,tx=ox+nx*step,ty=oy+ny*step;const free=(x,y)=>!blockedStatic(x,y,u.r,null)&&!(u===player&&enemies.some(e=>Math.hypot(x-e.x,y-e.y)<u.r+e.r+1));if(free(tx,ty)){u.x=tx;u.y=ty;return}if(free(tx,oy)){u.x=tx;return}if(free(ox,ty)){u.y=ty;return}const sx=-ny,sy=nx;if(free(ox+sx*step*.7,oy+sy*step*.7)){u.x+=sx*step*.7;u.y+=sy*step*.7}}
function lineBlocked(x1,y1,x2,y2,ignoreBaseId=null){const n=Math.ceil(Math.hypot(x2-x1,y2-y1)/26);for(let i=1;i<n;i++){const t=i/n,x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;for(const o of obstacles){if(o.type==='circle'&&Math.hypot(x-o.x,y-o.y)<o.r)return true;if(o.type==='rect'&&pointRect(x,y,o))return true}if(Math.hypot(x-wreck.x,y-wreck.y)<wreck.r*.65)return true;if(typeof enemyBases!=='undefined')for(const b of enemyBases)if(b.id!==ignoreBaseId&&b.alive&&Math.hypot(x-b.x,y-b.y)<b.r*.66)return true}return false}

// ---------- THREE-STATE FOG: unexplored / remembered / visible ----------
const FOG_CELL=6, FOG_COLS=Math.ceil(W/FOG_CELL), FOG_ROWS=Math.ceil(H/FOG_CELL);
const fogExplored=new Uint8Array(FOG_COLS*FOG_ROWS), fogVisible=new Uint8Array(FOG_COLS*FOG_ROWS);
let fogClock=0;
const fogIdx=(cx,cy)=>cy*FOG_COLS+cx;
function visionRadius(){return 250*(terrainAt(player.x,player.y).vision||1)}
function fogNoise(cx,cy){const n=Math.sin(cx*12.9898+cy*78.233+stageId*37.71)*43758.5453;return (n-Math.floor(n))*2-1}
function updateFog(force=false){
  if(!force&&fogClock>0)return; fogClock=.075; fogVisible.fill(0);
  const r=visionRadius(), pcx=Math.floor(player.x/FOG_CELL), pcy=Math.floor(player.y/FOG_CELL), cells=Math.ceil(r/FOG_CELL)+2;
  for(let cy=Math.max(0,pcy-cells);cy<=Math.min(FOG_ROWS-1,pcy+cells);cy++)for(let cx=Math.max(0,pcx-cells);cx<=Math.min(FOG_COLS-1,pcx+cells);cx++){
    const x=(cx+.5)*FOG_CELL,y=(cy+.5)*FOG_CELL,dist=Math.hypot(x-player.x,y-player.y);
    const edge=r*(1+.045*fogNoise(cx,cy));
    if(dist<=edge && !lineBlocked(player.x,player.y,x,y)){const i=fogIdx(cx,cy);fogVisible[i]=1;fogExplored[i]=1}
  }
  const rcx=Math.floor(wreck.x/FOG_CELL),rcy=Math.floor(wreck.y/FOG_CELL);
  for(let cy=Math.max(0,rcy-8);cy<=Math.min(FOG_ROWS-1,rcy+8);cy++)for(let cx=Math.max(0,rcx-8);cx<=Math.min(FOG_COLS-1,rcx+8);cx++)fogExplored[fogIdx(cx,cy)]=1;
}
function visibleAt(x,y){const cx=Math.floor(x/FOG_CELL),cy=Math.floor(y/FOG_CELL);return cx>=0&&cy>=0&&cx<FOG_COLS&&cy<FOG_ROWS&&fogVisible[fogIdx(cx,cy)]===1}
function exploredAt(x,y){const cx=Math.floor(x/FOG_CELL),cy=Math.floor(y/FOG_CELL);return cx>=0&&cy>=0&&cx<FOG_COLS&&cy<FOG_ROWS&&fogExplored[fogIdx(cx,cy)]===1}
function serializeFog(){
  const data=[];let start=-1,len=0;
  for(let i=0;i<=fogExplored.length;i++){
    const on=i<fogExplored.length&&fogExplored[i]===1;
    if(on&&start<0){start=i;len=1}else if(on){len++}else if(start>=0){data.push(start,len);start=-1;len=0}
  }
  return {format:'rle',data};
}
function restoreFog(saved,sourceCell=FOG_CELL){
  fogExplored.fill(0);
  if(sourceCell!==FOG_CELL){updateFog(true);return}
  if(saved&&saved.format==='rle'&&Array.isArray(saved.data)){
    for(let j=0;j<saved.data.length;j+=2){const start=saved.data[j]|0,len=saved.data[j+1]|0;for(let i=Math.max(0,start);i<Math.min(fogExplored.length,start+len);i++)fogExplored[i]=1}
  }else if(Array.isArray(saved)){for(const i of saved)if(i>=0&&i<fogExplored.length)fogExplored[i]=1}
  updateFog(true)
}
function drawFog(){
  const left=cam.x-canvas.width/2,top=cam.y-canvas.height/2;
  const x0=Math.max(0,Math.floor(left/FOG_CELL)-1),y0=Math.max(0,Math.floor(top/FOG_CELL)-1),x1=Math.min(FOG_COLS-1,Math.ceil((left+canvas.width)/FOG_CELL)+1),y1=Math.min(FOG_ROWS-1,Math.ceil((top+canvas.height)/FOG_CELL)+1);
  ctx.save();
  for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
    const i=fogIdx(cx,cy);if(fogVisible[i])continue;
    const px=cx*FOG_CELL-left,py=cy*FOG_CELL-top;
    ctx.fillStyle=fogExplored[i]?'rgba(7,10,8,.66)':'#000';ctx.fillRect(px,py,FOG_CELL+.45,FOG_CELL+.45);
  }
  ctx.restore();
}
// ---------- BASES / ENEMIES ----------
const BASE_TYPE={
  outpost:{hp:210,r:58,tier:1,guard:14,reinforce:24,respawn:13},
  factory:{hp:300,r:70,tier:2,guard:18,reinforce:32,respawn:12},
  fortress:{hp:410,r:80,tier:3,guard:23,reinforce:42,respawn:11},
  command:{hp:560,r:94,tier:4,guard:30,reinforce:54,respawn:10}
};
const enemyBases=STAGE.bases.map(s=>{const t=BASE_TYPE[s[2]],hp=Math.round(t.hp*(1+.07*(stageId-1)));return{id:s[0],name:s[1],type:s[2],x:s[3]*W,y:s[4]*H,r:t.r,tier:t.tier,hp,maxHp:hp,alive:true,activated:false,spawnClock:t.respawn,ruinClock:14,hit:0}});
const exchangeStations=[];if(STAGE.exchange>=1)exchangeStations.push({x:W*.18,y:H*.61,r:46,name:'서부 교환소'});if(STAGE.exchange>=2)exchangeStations.push({x:W*.83,y:H*.58,r:46,name:'동부 교환소'});
const ET={
  raider:{hp:22,speed:76,r:14,dmg:8,karma:3,color:'#8fab73',attack:'melee'},
  runner:{hp:13,speed:128,r:11,dmg:6,karma:2,color:'#d7a363',attack:'melee'},
  brute:{hp:46,speed:54,r:21,dmg:14,karma:8,color:'#9c6678',attack:'heavy'},
  gunner:{hp:24,speed:61,r:15,dmg:6,karma:5,color:'#baa45f',range:285,attack:'gun'},
  spitter:{hp:20,speed:65,r:14,dmg:8,karma:5,color:'#6ea6a0',range:250,attack:'spit'}
};
function enemyKind(tier){const r=Math.random();if(tier>=3&&r<.10)return'brute';if(tier>=2&&r<.27)return'gunner';if(tier>=2&&r<.39)return'spitter';if(r<.72)return'runner';return'raider'}
function enemyCap(){return BAL.cap}
function spawnEnemy(x,y,type='raider',baseId=null,angry=false){
  if(enemies.length>=enemyCap())return null;
  const t=ET[type],hp=Math.max(8,Math.round(t.hp*BAL.hp)),dmg=Math.max(3,Math.round(t.dmg*BAL.dmg));
  const e={type,x,y,r:t.r,maxHp:hp,hp,speed:t.speed*(1+.025*(stageId-1)),dmg,karma:Math.max(1,Math.round(t.karma*BAL.karma)),color:t.color,baseId,angry,attack:rand(0,.4),shot:rand(.2,.8),windup:0,hit:0};enemies.push(e);return e
}
function spawnAroundBase(b,count,angry=false){
  const room=Math.max(0,enemyCap()-enemies.length),actual=Math.min(count,room);if(actual<=0)return;
  for(let i=0;i<actual;i++){const a=Math.PI*2*i/actual+rand(-.18,.18),r=b.r+72+rand(0,125),x=b.x+Math.cos(a)*r,y=b.y+Math.sin(a)*r;if(!blockedStatic(x,y,14,b.id))spawnEnemy(x,y,enemyKind(b.tier),b.id,angry)}
}
function nonCommandAlive(){return enemyBases.filter(b=>b.alive&&b.type!=='command').length}
function damageBase(b,dmg){if(!b.alive)return;if(b.type==='command'&&nonCommandAlive()>0){if(b.hit<=0)event('지휘기지 보호막 · 다른 거점을 먼저 파괴하세요.',1.5);b.hit=.2;return}b.hp-=dmg;b.hit=.14;if(b.hp<=0){b.hp=0;b.alive=false;destroyedBases++;runKarma+=70+b.tier*45;sfx('boom');event(`${b.name} 파괴! 잔존 병력이 쏟아집니다`,2.5);spawnAroundBase(b,Math.round(BASE_TYPE[b.type].reinforce*(1+.12*(stageId-1))),true);saveSnapshot();if(b.type==='command'){finalDestroyed=true;finalHold=10;event('지휘기지 붕괴 · 10초만 버티세요!',2.5)}}}

function nearestTarget(u,range){let best=null,bd=range;for(const e of enemies){if(!visibleAt(e.x,e.y))continue;const dd=d(u,e);if(dd<bd&&!lineBlocked(u.x,u.y,e.x,e.y)){best=e;bd=dd}}if(!best){for(const b of enemyBases){if(!b.alive||!visibleAt(b.x,b.y))continue;const dd=d(u,b)-b.r;if(dd<bd&&!lineBlocked(u.x,u.y,b.x,b.y,b.id)){best=b;bd=dd}}}return best}

// ---------- AUDIO ----------
function ensureAudio(){if(audioCtx)return;try{audioCtx=new(window.AudioContext||window.webkitAudioContext)()}catch{}}
function tone(freq=.1,dur=.06,vol=.04,type='square'){if(!soundOn)return;ensureAudio();if(!audioCtx)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(vol,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur)}
function sfx(k){if(k==='shot')tone(rand(150,185),.045,.037,'square');else if(k==='hit')tone(82,.035,.022,'square');else if(k==='kill')tone(68,.07,.035,'sawtooth');else if(k==='exchange'){tone(520,.08,.05);setTimeout(()=>tone(760,.1,.05),70)}else if(k==='upgrade')tone(620,.09,.05);else if(k==='stim')tone(240,.18,.06,'sawtooth');else if(k==='heal'){tone(430,.10,.045,'sine');setTimeout(()=>tone(690,.14,.05,'sine'),80)}else if(k==='boom')tone(55,.35,.09,'sawtooth')}

// ---------- COMBAT ----------
function stimOn(){return stimRemaining>0}
function effectiveAttack(){return runStats.attack*(stimOn()?2:1)}
function effectiveDefense(){return runStats.defense*(stimOn()?2:1)}
function effectiveSpeed(){return runStats.speed*(stimOn()?2:1)}
function fireRate(){return stimOn()?.5:1}
function tracer(x1,y1,x2,y2,color='#ffe59c',life=.10){tracers.push({x1,y1,x2,y2,color,life,max:life})}
function hitEnemy(e,dmg,from){e.hp-=dmg;e.hit=.09;const dx=e.x-from.x,dy=e.y-from.y,l=Math.hypot(dx,dy)||1;const nx=e.x+dx/l*4,ny=e.y+dy/l*4;if(!blockedStatic(nx,ny,e.r,e.baseId)){e.x=nx;e.y=ny}sfx('hit');floating.push({x:e.x,y:e.y-20,text:`-${Math.round(dmg)}`,life:.55,color:'#ffe3a0'});if(e.hp<=0){kills++;runKarma+=e.karma;sfx('kill');corpses.push({x:e.x,y:e.y,r:e.r,life:.8,color:e.color});enemies.splice(enemies.indexOf(e),1)}}
function fireRifle(u,target,damage){const a=Math.atan2(target.y-u.y,target.x-u.x);u.aim=a;u.recoil=.08;u.muzzle=.06;const px=u.x+Math.cos(a)*19,py=u.y+Math.sin(a)*19,tx=target.x+rand(-3,3),ty=target.y+rand(-3,3);tracer(px,py,tx,ty,'#ffe2a0');sfx('shot');if(target.maxHp&&target.type&&ET[target.type])hitEnemy(target,damage,u);else if(target.alive!==undefined)damageBase(target,damage)}
function updateShooter(u,dt){u.fireClock=Math.max(0,(u.fireClock||0)-dt);u.burstClock=Math.max(0,(u.burstClock||0)-dt);u.recoil=Math.max(0,(u.recoil||0)-dt);u.muzzle=Math.max(0,(u.muzzle||0)-dt);const range=350*(terrainAt(u.x,u.y).high?1.12:1),target=nearestTarget(u,range);if(!target){u.burstShots=0;return}if(u.fireClock<=0&&u.burstShots<=0){u.burstShots=3;u.burstClock=0}if(u.burstShots>0&&u.burstClock<=0){fireRifle(u,target,effectiveAttack());u.burstShots--;u.burstClock=.105*fireRate();if(u.burstShots<=0)u.fireClock=.50*fireRate()}}
function hurtPlayer(raw){const dmg=Math.max(1,Math.round(raw-effectiveDefense()));player.hp-=dmg;player.hit=.14;floating.push({x:player.x,y:player.y-24,text:`-${dmg}`,life:.5,color:'#ff9a8f'});if(player.hp<=0)endRun(false,'전투 불능')}
function enemyShoot(e,target,type='bullet'){const td=d(e,target),spd=type==='spit'?250:390;enemyBullets.push({type,x:e.x,y:e.y,vx:(target.x-e.x)/(td||1)*spd,vy:(target.y-e.y)/(td||1)*spd,life:type==='spit'?1.8:1.3,dmg:e.dmg,r:type==='spit'?6:3,blast:type==='spit'?38:0});tone(type==='spit'?120:95,.05,.018,type==='spit'?'sawtooth':'square')}
function resolveEnemySeparation(){for(let i=0;i<enemies.length;i++){const a=enemies[i];let dx=a.x-player.x,dy=a.y-player.y,l=Math.hypot(dx,dy)||1,min=a.r+player.r+2;if(l<min){const push=min-l,nx=a.x+dx/l*push,ny=a.y+dy/l*push;if(!blockedStatic(nx,ny,a.r,a.baseId)){a.x=nx;a.y=ny}}for(let j=i+1;j<Math.min(enemies.length,i+18);j++){const b=enemies[j];dx=b.x-a.x;dy=b.y-a.y;l=Math.hypot(dx,dy)||1;min=a.r+b.r+1;if(l<min){const q=(min-l)*.5;const ax=a.x-dx/l*q,ay=a.y-dy/l*q,bx=b.x+dx/l*q,by=b.y+dy/l*q;if(!blockedStatic(ax,ay,a.r,a.baseId)){a.x=ax;a.y=ay}if(!blockedStatic(bx,by,b.r,b.baseId)){b.x=bx;b.y=by}}}}}
function updateEnemies(dt){
  for(const e of [...enemies]){
    e.hit=Math.max(0,e.hit-dt);e.attack=Math.max(0,e.attack-dt);e.shot=Math.max(0,e.shot-dt);e.windup=Math.max(0,e.windup-dt);
    const owner=enemyBases.find(b=>b.id===e.baseId),td=d(e,player);
    const playerSafe=d(player,wreck)<wreck.r+105;
    if(playerSafe){const hd=d(e,wreck);if(hd<wreck.r+175){move(e,(e.x-wreck.x)/(hd||1),(e.y-wreck.y)/(hd||1),e.speed*.8,dt)}continue}
    const shouldChase=e.angry||td<620||(!owner||!owner.alive&&td<760);
    if(!shouldChase&&owner){const dd=d(e,owner);if(dd>owner.r+190)move(e,(owner.x-e.x)/(dd||1),(owner.y-e.y)/(dd||1),e.speed*.7,dt);continue}
    if(e.type==='gunner'){
      if(td>220)move(e,(player.x-e.x)/(td||1),(player.y-e.y)/(td||1),e.speed,dt);
      if(td<ET.gunner.range&&!lineBlocked(e.x,e.y,player.x,player.y)&&e.shot<=0){e.shot=1.05;enemyShoot(e,player,'bullet')}
    }else if(e.type==='spitter'){
      if(td>190)move(e,(player.x-e.x)/(td||1),(player.y-e.y)/(td||1),e.speed,dt);
      if(td<ET.spitter.range&&!lineBlocked(e.x,e.y,player.x,player.y)&&e.shot<=0){e.shot=1.45;enemyShoot(e,player,'spit')}
    }else{
      const reach=e.type==='brute'?e.r+player.r+20:e.r+player.r+10;
      if(td>reach)move(e,(player.x-e.x)/(td||1),(player.y-e.y)/(td||1),e.speed,dt);
      else if(e.attack<=0){e.attack=e.type==='brute'?1.15:.72;e.windup=e.type==='brute'?.22:.10;setTimeout(()=>{if(ended||!enemies.includes(e))return;if(d(e,player)<=reach+8)hurtPlayer(e.dmg)},e.windup*1000)}
    }
  }
  resolveEnemySeparation();
  for(const b of enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life>0&&Math.hypot(b.x-player.x,b.y-player.y)<player.r+b.r){if(b.blast){hurtPlayer(b.dmg);for(const e of enemies){} }else hurtPlayer(b.dmg);b.life=0}}
  enemyBullets=enemyBullets.filter(b=>b.life>0&&!blockedStatic(b.x,b.y,b.r||2,null,false));
}
function hordeProgress(){return clamp(gameTime/GAME_LENGTH,0,1)}
function hordeInterval(){const p=hordeProgress();return BAL.hordeStart+(BAL.hordeEnd-BAL.hordeStart)*p}
function spawnGlobalHorde(){
  if(enemies.length>=enemyCap())return;
  const sources=enemyBases.slice().sort((a,b)=>d(player,a)-d(player,b));if(!sources.length)return;
  const source=sources[0],p=hordeProgress();
  const count=Math.round(BAL.hordeBase+BAL.hordeGrowth*p+source.tier*1.3);
  spawnAroundBase(source,count,true);
  if(p>.48&&Math.random()<.45&&sources[1])spawnAroundBase(sources[1],Math.round(count*.45),true);
}
function updateBases(dt){
  const p=hordeProgress();
  for(const b of enemyBases){
    b.hit=Math.max(0,b.hit-dt);const dd=d(player,b);
    if(b.alive){
      if(dd<700&&!b.activated){b.activated=true;spawnAroundBase(b,BASE_TYPE[b.type].guard+stageId*2,false);event(`${b.name} 경계 병력 활성화`,1.5)}
      if(b.activated&&dd<1050){b.spawnClock-=dt;if(b.spawnClock<=0){b.spawnClock=BASE_TYPE[b.type].respawn*(1-.38*p);const n=Math.round((3+b.tier*1.8+stageId*.7)*(1+1.45*p));spawnAroundBase(b,n,false)}}
    }else if(dd<950){b.ruinClock-=dt;if(b.ruinClock<=0){b.ruinClock=(14-rand(0,3))*(1-.28*p);spawnAroundBase(b,Math.round((3+b.tier)*(1+.9*p)),false)}}
  }
  hordeClock-=dt;
  if(hordeClock<=0){spawnGlobalHorde();hordeClock=hordeInterval()*rand(.86,1.12)}
  const level=Math.min(5,1+Math.floor(gameTime/120));if(level>lastSurgeLevel){lastSurgeLevel=level;event(`적 증식 단계 ${level} · 병력 밀도가 상승합니다.`,2)}
}
// ---------- SKILLS / ECONOMY ----------
function nearExchange(){if(d(player,wreck)<wreck.r+95)return{name:'추락선 잔해'};for(const s of exchangeStations)if(d(player,s)<s.r+40)return s;return null}
function exchange(){const s=nearExchange();if(!s||runKarma<=0)return;credits+=runKarma;meta.totalKarmaBanked=(meta.totalKarmaBanked||0)+runKarma;event(`${s.name} · 골드 +${runKarma}`,1.7);runKarma=0;sfx('exchange');saveMeta(meta);saveSnapshot()}
function useHeal(){const cost=80;if(ended||paused)return;if(player.hp>=player.maxHp-1){event('체력이 이미 가득 찼습니다.',1);return}if(credits<cost){event(`골드 ${cost} 필요`,1.1);return}credits-=cost;player.hp=Math.min(player.maxHp,player.hp+35);sfx('heal');event(`응급 회복 +35 HP · -${cost}C`,1.2);saveSnapshot()}
function useStim(){if(ended||paused)return;if(!meta.stimUnlocked){event('전투 상점에서 스팀팩을 영구 해금하세요.',1.3);return}if(player.hp<=10){event('HP가 10 이하라 스팀팩을 사용할 수 없습니다.',1.4);return}player.hp-=10;stimRemaining=10;sfx('stim');event('STIM · HP 10 소모 · 10초간 전투 성능 ×2',1.4);saveSnapshot()}
function purchaseCount(k){if(k==='attack')return Math.max(0,Math.round((runStats.attack-15)/5));if(k==='defense')return Math.max(0,Math.round(runStats.defense));return Math.max(0,Math.round((runStats.speed-190)/10))}
function upgradeCost(k){const n=purchaseCount(k);if(k==='attack')return Math.round(170+55*n+22*n*n);if(k==='defense')return Math.round(150+50*n+24*n*n);return Math.round(125+42*n+18*n*n)}
function renderMenu(){
  $('#menuCredit').textContent=credits;
  const stimPrice=850;
  $('#shopList').innerHTML=`
    <article class="shop-card"><div class="card-icon">⚔️</div><div><h3>공격력 ${runStats.attack}</h3><p>구매할 때마다 피해량 <b>+5</b></p></div><button class="btn" data-buy="attack">+5 · ${upgradeCost('attack')}C</button></article>
    <article class="shop-card"><div class="card-icon">🛡️</div><div><h3>방어력 ${runStats.defense}</h3><p>적에게 받는 피해를 정량으로 <b>-1</b></p></div><button class="btn" data-buy="defense">+1 · ${upgradeCost('defense')}C</button></article>
    <article class="shop-card"><div class="card-icon">⚡</div><div><h3>속도 ${runStats.speed}</h3><p>기본 이동속도 <b>+10</b></p></div><button class="btn" data-buy="speed">+10 · ${upgradeCost('speed')}C</button></article>
    <article class="shop-card"><div class="card-icon">💉</div><div><h3>스팀팩 영구 해금</h3><p>HP 10 소모 · 10초간 공격/방어/속도 ×2 · 재사용 대기시간 없음</p></div><button class="btn" data-buy="stim" ${meta.stimUnlocked?'disabled':''}>${meta.stimUnlocked?'해금 완료':stimPrice+'C'}</button></article>`;
  $('#shopList').querySelectorAll('[data-buy]').forEach(btn=>btn.onclick=()=>{
    const k=btn.dataset.buy;
    if(k==='stim'){
      if(meta.stimUnlocked)return;if(credits<stimPrice){event('골드가 부족합니다.',1);return}credits-=stimPrice;meta.stimUnlocked=true;saveMeta(meta);sfx('upgrade');event('스팀팩 영구 해금!',1.4);
    }else{
      const cost=upgradeCost(k);if(credits<cost){event('골드가 부족합니다.',1);return}credits-=cost;
      if(k==='attack')runStats.attack+=5;else if(k==='defense')runStats.defense+=1;else if(k==='speed')runStats.speed+=10;
      sfx('upgrade');event(`${k==='attack'?'공격력':k==='defense'?'방어력':'속도'} 상승!`,1);
    }
    renderMenu();saveSnapshot();
  });
}
function openMenu(){if(ended)return;paused=true;$('#battleMenu').classList.remove('hidden');renderMenu()}
function closeMenu(){if(ended)return;$('#battleMenu').classList.add('hidden');paused=false;last=performance.now()}

// ---------- SAVE ----------
function saveSnapshot(){if(ended)return;saveRun({stageId,gameTime,runKarma,credits,kills,runStats:{...runStats},player:{x:player.x,y:player.y,hp:player.hp},enemyBases:enemyBases.map(b=>({id:b.id,hp:b.hp,alive:b.alive,activated:b.activated,spawnClock:b.spawnClock,ruinClock:b.ruinClock})),enemies:enemies.slice(0,enemyCap()).map(e=>({type:e.type,x:e.x,y:e.y,hp:e.hp,baseId:e.baseId,angry:e.angry})),stimRemaining,hordeClock,lastSurgeLevel,fogCell:FOG_CELL,fogExplored:serializeFog(),finalDestroyed,finalHold,ended:false})}
function restore(s){if(!s||Number(s.stageId)!==stageId)return false;gameTime=s.gameTime||0;runKarma=s.runKarma||0;credits=s.credits||0;kills=s.kills||0;Object.assign(runStats,s.runStats||{});if(s.player){player.x=s.player.x;player.y=s.player.y;player.hp=s.player.hp}for(const sb of s.enemyBases||[]){const b=enemyBases.find(x=>x.id===sb.id);if(b)Object.assign(b,sb)}destroyedBases=enemyBases.filter(b=>!b.alive).length;enemies=[];for(const se of s.enemies||[]){const e=spawnEnemy(se.x,se.y,se.type,se.baseId,se.angry);if(e)e.hp=Math.min(e.maxHp,se.hp)}stimRemaining=s.stimRemaining||0;hordeClock=Number(s.hordeClock)||hordeClock;lastSurgeLevel=Number(s.lastSurgeLevel)||Math.min(5,1+Math.floor(gameTime/120));restoreFog(s.fogExplored||[],Number(s.fogCell)||28);finalDestroyed=!!s.finalDestroyed;finalHold=s.finalHold||0;return true}

// ---------- UPDATE ----------
const joy={x:0,y:0};
function update(dt){if(paused||ended)return;gameTime+=dt;autosaveClock+=dt;stimRemaining=Math.max(0,stimRemaining-dt);bannerClock=Math.max(0,bannerClock-dt);terrainClock=Math.max(0,terrainClock-dt);fogClock=Math.max(0,fogClock-dt);
  let dx=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+joy.x,dy=(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0)+joy.y,l=Math.hypot(dx,dy);if(l>0){dx/=l;dy/=l;move(player,dx,dy,effectiveSpeed(),dt)}
  // Season 1 start point is a wreck, not a base. It cannot be attacked. Nearby it repairs HP and exchanges karma.
  if(d(player,wreck)<wreck.r+105)player.hp=Math.min(player.maxHp,player.hp+28*dt);
  updateShooter(player,dt);updateBases(dt);updateEnemies(dt);
  for(const t of tracers)t.life-=dt;tracers=tracers.filter(t=>t.life>0);for(const c of corpses)c.life-=dt;corpses=corpses.filter(c=>c.life>0);for(const f of floating){f.life-=dt;f.y-=20*dt}floating=floating.filter(f=>f.life>0);
  updateFog();cam.x+=(player.x-cam.x)*Math.min(1,dt*7);cam.y+=(player.y-cam.y)*Math.min(1,dt*7);cam.x=clamp(cam.x,canvas.width/2,W-canvas.width/2);cam.y=clamp(cam.y,canvas.height/2,H-canvas.height/2);
  const tr=terrainAt(player.x,player.y);if(tr.name!==lastTerrain){lastTerrain=tr.name;if(tr.name){$('#terrainHint').textContent=tr.name;$('#terrainHint').classList.remove('hidden');terrainClock=1.8}}if(terrainClock<=0)$('#terrainHint').classList.add('hidden');
  if(finalDestroyed){finalHold-=dt;if(finalHold<=0)endRun(true,'지휘망을 파괴하고 잔존 병력을 견뎌냈습니다.')}else if(gameTime>=GAME_LENGTH)endRun(false,'작전 제한시간을 초과했습니다.');
  if(autosaveClock>10){autosaveClock=0;saveSnapshot()}
}

// ---------- DRAW ----------
function sx(x){return x-(cam.x-canvas.width/2)}function sy(y){return y-(cam.y-canvas.height/2)}
function drawTerrain(){ctx.fillStyle='#36513b';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(-(cam.x-canvas.width/2),-(cam.y-canvas.height/2));
  for(const r of roads){ctx.strokeStyle='#566153';ctx.lineWidth=r.w;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(r.x1,r.y1);ctx.lineTo(r.x2,r.y2);ctx.stroke();ctx.strokeStyle='#78806f';ctx.lineWidth=2;ctx.setLineDash([18,22]);ctx.stroke();ctx.setLineDash([])}
  for(const z of swamps){ctx.fillStyle='#2b514e';ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,Math.PI*2);ctx.fill();for(let i=0;i<12;i++){const a=i*2.1,r=z.r*(.2+(i%5)*.14);ctx.fillStyle='#4a7065';ctx.fillRect(z.x+Math.cos(a)*r-5,z.y+Math.sin(a)*r-2,10,4)}}
  for(const z of forests){ctx.fillStyle='#294833';ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,Math.PI*2);ctx.fill();for(let i=0;i<18;i++){const a=i*2.3,r=z.r*(.15+(i%7)*.11);ctx.fillStyle='#1c3928';ctx.beginPath();ctx.arc(z.x+Math.cos(a)*r,z.y+Math.sin(a)*r,12,0,Math.PI*2);ctx.fill()}}
  for(const p of plateaus){ctx.fillStyle='#526443';ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle='#33442f';ctx.fillRect(p.x,p.y+p.h-24,p.w,24)}
  for(const o of obstacles){if(o.type==='circle'){ctx.fillStyle='#26372f';ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#657266';ctx.lineWidth=5;ctx.stroke()}else{ctx.fillStyle=o.kind==='cliff'?'#28342d':'#495048';ctx.fillRect(o.x,o.y,o.w,o.h);ctx.strokeStyle='#697369';ctx.lineWidth=4;ctx.strokeRect(o.x,o.y,o.w,o.h)}}
  ctx.restore();
}
function drawHome(){ctx.save();ctx.translate(sx(wreck.x),sy(wreck.y));ctx.fillStyle='#202a28';ctx.beginPath();ctx.ellipse(0,8,76,54,-.18,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#68736c';ctx.lineWidth=5;ctx.stroke();ctx.fillStyle='#879995';ctx.save();ctx.rotate(-.20);ctx.fillRect(-55,-22,110,44);ctx.fillStyle='#2c3937';ctx.fillRect(-16,-33,54,18);ctx.fillStyle='#cf714f';ctx.fillRect(28,-16,28,32);ctx.restore();ctx.fillStyle='#d9ef71';ctx.fillRect(-7,-48,14,14);ctx.fillStyle='#e7eee8';ctx.font='800 14px system-ui, sans-serif';ctx.textAlign='center';ctx.fillText('추락선 · 회복 / 카르마 교환',0,wreck.r+35);ctx.restore()}
function drawBase(b){if(!visibleAt(b.x,b.y)&&!exploredAt(b.x,b.y))return;ctx.save();ctx.translate(sx(b.x),sy(b.y));if(!b.alive){ctx.fillStyle='#272d29';ctx.fillRect(-b.r*.65,-b.r*.35,b.r*1.3,b.r*.7);ctx.fillStyle='#686a64';ctx.fillRect(-b.r*.45,-b.r*.15,b.r*.9,b.r*.25);ctx.fillStyle='#b7b7ae';ctx.font='700 11px Malgun Gothic';ctx.textAlign='center';ctx.fillText('잔존 소굴',0,b.r*.65);ctx.restore();return}const colors={outpost:'#a95050',factory:'#bc6c4c',fortress:'#875c72',command:'#ce424a'};ctx.fillStyle=colors[b.type];ctx.fillRect(-b.r*.72,-b.r*.55,b.r*1.44,b.r*1.10);ctx.fillStyle='#2a2e2a';ctx.fillRect(-b.r*.3,-b.r*.30,b.r*.6,b.r*.62);if(b.type==='command'&&nonCommandAlive()>0){ctx.strokeStyle='#7fd9ff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,b.r+10,0,Math.PI*2);ctx.stroke()}ctx.fillStyle='#111';ctx.fillRect(-b.r,-b.r-.22*b.r,b.r*2,8);ctx.fillStyle='#e8d06d';ctx.fillRect(-b.r,-b.r-.22*b.r,b.r*2*(b.hp/b.maxHp),8);ctx.fillStyle='#f3e4df';ctx.font='800 12px Malgun Gothic';ctx.textAlign='center';ctx.fillText(b.name,0,b.r+22);ctx.restore()}
function drawUnit(u,playerUnit=false){if(!playerUnit&&!visibleAt(u.x,u.y))return;ctx.save();ctx.translate(sx(u.x),sy(u.y));ctx.rotate(u.aim||0);if(u.hit>0)ctx.fillStyle='#fff';else ctx.fillStyle=playerUnit?'#83cfe5':u.type==='flame'?'#e28b5a':'#b7d4c0';ctx.fillRect(-12,-10,24,20);ctx.fillStyle='#26352e';ctx.fillRect(4,-4,22,8);if(u.muzzle>0){ctx.fillStyle='#ffe26d';ctx.beginPath();ctx.moveTo(27,0);ctx.lineTo(39,-7);ctx.lineTo(38,7);ctx.closePath();ctx.fill()}ctx.restore();if(!playerUnit&&u.hp<u.maxHp){ctx.fillStyle='#111';ctx.fillRect(sx(u.x)-16,sy(u.y)-21,32,4);ctx.fillStyle='#6fda82';ctx.fillRect(sx(u.x)-16,sy(u.y)-21,32*(u.hp/u.maxHp),4)}}
function drawEnemy(e){if(!visibleAt(e.x,e.y))return;ctx.save();ctx.translate(sx(e.x),sy(e.y));if(e.windup>0){ctx.strokeStyle=e.type==='brute'?'#ff9a6a':'#e8cf76';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,e.r+8,0,Math.PI*2);ctx.stroke()}ctx.fillStyle=e.hit>0?'#fff':e.color;ctx.beginPath();ctx.arc(0,0,e.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#202c25';ctx.lineWidth=4;ctx.stroke();if(e.type==='gunner'){ctx.strokeStyle='#2e3530';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(e.r+10,0);ctx.stroke()}else if(e.type==='spitter'){ctx.fillStyle='#a8efe0';ctx.beginPath();ctx.arc(e.r*.3,-e.r*.25,4,0,Math.PI*2);ctx.fill()}ctx.restore()}
function drawWorld(){drawTerrain();drawHome();for(const s of exchangeStations)if(exploredAt(s.x,s.y)){ctx.save();ctx.translate(sx(s.x),sy(s.y));ctx.fillStyle='#67bfd0';ctx.beginPath();ctx.arc(0,0,s.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0e2b31';ctx.fillRect(-20,-18,40,36);ctx.fillStyle='#d4f7ff';ctx.font='700 11px Malgun Gothic';ctx.textAlign='center';ctx.fillText('교환소',0,s.r+18);ctx.restore()}for(const b of enemyBases)drawBase(b);for(const c of corpses)if(visibleAt(c.x,c.y)){ctx.globalAlpha=c.life/.8;ctx.fillStyle=c.color;ctx.fillRect(sx(c.x)-c.r,sy(c.y)-5,c.r*2,10);ctx.globalAlpha=1}for(const e of enemies)drawEnemy(e);drawUnit(player,true);for(const b of enemyBullets)if(visibleAt(b.x,b.y)){ctx.fillStyle=b.type==='spit'?'#7fe0cd':'#ff7a65';ctx.beginPath();ctx.arc(sx(b.x),sy(b.y),b.r||3,0,Math.PI*2);ctx.fill();if(b.type==='spit'){ctx.strokeStyle='#baffef';ctx.lineWidth=2;ctx.stroke()}}for(const t of tracers){if(!visibleAt(t.x2,t.y2))continue;ctx.globalAlpha=t.life/t.max;ctx.strokeStyle=t.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx(t.x1),sy(t.y1));ctx.lineTo(sx(t.x2),sy(t.y2));ctx.stroke();ctx.globalAlpha=1}ctx.font='800 12px Malgun Gothic';ctx.textAlign='center';for(const f of floating)if(visibleAt(f.x,f.y)){ctx.globalAlpha=Math.min(1,f.life*3);ctx.fillStyle=f.color;ctx.fillText(f.text,sx(f.x),sy(f.y));ctx.globalAlpha=1}drawFog()}
function drawMinimap(){
  const mw=minimap.width,mh=minimap.height,mx=x=>x/W*mw,my=y=>y/H*mh;
  mctx.fillStyle='#344e3a';mctx.fillRect(0,0,mw,mh);
  for(const r of roads){mctx.strokeStyle='#5c6559';mctx.lineWidth=2;mctx.beginPath();mctx.moveTo(mx(r.x1),my(r.y1));mctx.lineTo(mx(r.x2),my(r.y2));mctx.stroke()}
  for(const z of swamps){mctx.fillStyle='#2b4f4c';mctx.beginPath();mctx.arc(mx(z.x),my(z.y),z.r/W*mw,0,Math.PI*2);mctx.fill()}
  for(const p of plateaus){mctx.fillStyle='#596a4a';mctx.fillRect(mx(p.x),my(p.y),p.w/W*mw,p.h/H*mh)}
  for(const s of exchangeStations)if(exploredAt(s.x,s.y)){mctx.fillStyle='#8ed8ee';mctx.fillRect(mx(s.x)-2,my(s.y)-2,4,4)}
  for(const e of enemies)if(visibleAt(e.x,e.y)){mctx.fillStyle='#ff796e';mctx.fillRect(mx(e.x)-1,my(e.y)-1,2,2)}
  // Fog is sampled at minimap resolution: black=unknown, dark=remembered, clear=current vision.
  const step=2;
  for(let py=0;py<mh;py+=step)for(let px=0;px<mw;px+=step){
    const wx=(px+.5)/mw*W,wy=(py+.5)/mh*H,cx=Math.floor(wx/FOG_CELL),cy=Math.floor(wy/FOG_CELL),i=fogIdx(clamp(cx,0,FOG_COLS-1),clamp(cy,0,FOG_ROWS-1));
    if(fogVisible[i])continue;mctx.fillStyle=fogExplored[i]?'rgba(5,8,7,.60)':'#000';mctx.fillRect(px,py,step+.25,step+.25)
  }
  // Navigation signals stay visible even inside completely unexplored black fog.
  const pulse=.5+.5*Math.sin(performance.now()/260);
  for(const b of enemyBases){
    const x=mx(b.x),y=my(b.y);
    if(b.alive){mctx.strokeStyle=`rgba(255,92,83,${.48+.45*pulse})`;mctx.lineWidth=1.5;mctx.beginPath();mctx.arc(x,y,5+2*pulse,0,Math.PI*2);mctx.stroke();mctx.fillStyle='#ff5f56';mctx.save();mctx.translate(x,y);mctx.rotate(Math.PI/4);mctx.fillRect(-2.7,-2.7,5.4,5.4);mctx.restore()}
    else if(exploredAt(b.x,b.y)){mctx.fillStyle='#747974';mctx.fillRect(x-2,y-2,4,4)}
  }
  // The wreck and player are known navigation anchors.
  mctx.fillStyle='#d0c090';mctx.fillRect(mx(wreck.x)-3,my(wreck.y)-3,6,6);
  mctx.fillStyle='#fff';mctx.beginPath();mctx.arc(mx(player.x),my(player.y),3,0,Math.PI*2);mctx.fill()
}

function updateHud(){
  const hp=clamp(player.hp/player.maxHp*100,0,100);$('#hpBar').style.width=`${hp}%`;$('#hpText').textContent=`${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}`;$('#karmaText').textContent=runKarma;$('#creditText').textContent=credits;
  $('#attackText').textContent=Math.round(runStats.attack);$('#defenseText').textContent=Math.round(runStats.defense);$('#speedText').textContent=Math.round(runStats.speed);
  const remain=Math.max(0,GAME_LENGTH-gameTime);$('#timerText').textContent=finalDestroyed?`HOLD ${Math.ceil(finalHold)}`:`${Math.floor(remain/60)}:${String(Math.floor(remain%60)).padStart(2,'0')}`;$('#missionText').textContent=`STAGE ${String(stageId).padStart(2,'0')} · ${STAGE.name} · 거점 ${destroyedBases}/${enemyBases.length} · 적 ${enemies.length}`;$('#stageMiniTitle').textContent=`STAGE ${String(stageId).padStart(2,'0')}`;$('#mapSizeLabel').textContent=`${W}×${H}`;
  const exg=nearExchange();$('#exchangeBtn').classList.toggle('hidden',!(exg&&runKarma>0));if(exg&&runKarma>0)$('#exchangeBtn').querySelector('span').textContent=`카르마 ${runKarma} → 골드`;
  $('#stimCd').textContent=!meta.stimUnlocked?`${keyLabel(meta.settings.stimKey)} · LOCK`:(stimRemaining>0?`ACTIVE ${stimRemaining.toFixed(1)} · HP-10`:`${keyLabel(meta.settings.stimKey)} · HP-10`);$('#stimBtn').classList.toggle('cooldown',!meta.stimUnlocked||player.hp<=10);$('#stimBtn').classList.toggle('active',stimRemaining>0);
  $('#healCd').textContent='Q · 80C';$('#healBtn').classList.toggle('cooldown',credits<80||player.hp>=player.maxHp-1)
}
function event(text,time=1.5){$('#eventBanner').textContent=text;$('#eventBanner').classList.add('show');bannerClock=time;setTimeout(()=>{if(bannerClock<=0)$('#eventBanner').classList.remove('show')},time*1000+80)}
function endRun(win,reason){if(ended)return;ended=true;paused=true;clearRun();const xp=Math.round(kills*.45+destroyedBases*30+(win?120:20));meta.accountXp=(meta.accountXp||0)+xp;meta.runs=(meta.runs||0)+1;if(win){meta.wins=(meta.wins||0)+1;if(!meta.completedStages.includes(stageId))meta.completedStages.push(stageId);meta.maxStageUnlocked=Math.max(meta.maxStageUnlocked,Math.min(20,stageId+1));meta.campaign={active:true,credits,attack:runStats.attack,defense:runStats.defense,speed:runStats.speed,nextStage:Math.min(20,stageId+1)}}saveMeta(meta);$('#endTitle').textContent=win?`STAGE ${stageId} 클리어`:'작전 실패';$('#endReason').textContent=win?`${reason} · 현재 공격/방어/속도와 골드는 다음 스테이지로 이어집니다.`:reason;$('#endRewards').innerHTML=`<div><span>계정 XP</span><b>+${xp}</b></div><div><span>처치</span><b>${kills}</b></div><div><span>공격 / 방어 / 속도</span><b>${runStats.attack} / ${runStats.defense} / ${runStats.speed}</b></div><div><span>보유 골드</span><b>${credits}</b></div>`;$('#endScreen').classList.remove('hidden')}

// ---------- INPUT / UI ----------
$('#menuBtn').onclick=()=>openMenu();$('#closeMenuBtn').onclick=closeMenu;$('#exchangeBtn').onclick=exchange;$('#stimBtn').onclick=useStim;$('#healBtn').onclick=useHeal;
function openPause(){if(ended||!$('#battleMenu').classList.contains('hidden'))return;paused=true;$('#pauseSnapshot').innerHTML=`<span>스테이지<b>${stageId}</b></span><span>공격/방어/속도<b>${runStats.attack}/${runStats.defense}/${runStats.speed}</b></span><span>카르마<b>${runKarma}</b></span><span>골드<b>${credits}</b></span>`;$('#pauseOverlay').classList.remove('hidden')}
function closePause(){if(ended)return;$('#pauseOverlay').classList.add('hidden');paused=false;last=performance.now()}
$('#pauseBtn').onclick=openPause;$('#resumeBtn').onclick=closePause;$('#saveHomeBtn').onclick=()=>{saveSnapshot();location.href='/'};$('#abandonBtn').onclick=()=>{if(confirm('시즌 진행을 포기할까요? 스테이지에서 쌓아온 공격·방어·속도·골드가 초기화됩니다.')){clearRun();resetCampaign(meta);saveMeta(meta);location.href='/'}};
$('#soundBtn').onclick=()=>{soundOn=!soundOn;meta.settings.sound=soundOn;saveMeta(meta);$('#soundBtn').textContent=soundOn?'🔊':'🔇'};$('#soundBtn').textContent=soundOn?'🔊':'🔇';
window.addEventListener('keydown',e=>{ensureAudio();keys[e.code]=true;if(e.code===meta.settings.stimKey){e.preventDefault();useStim()}if(e.code==='KeyQ'){e.preventDefault();useHeal()}if(e.code==='KeyE'){e.preventDefault();exchange()}if(e.code==='KeyU'){e.preventDefault();$('#battleMenu').classList.contains('hidden')?openMenu():closeMenu()}if(e.code==='Escape'){e.preventDefault();if(!$('#battleMenu').classList.contains('hidden'))closeMenu();else if(!$('#pauseOverlay').classList.contains('hidden'))closePause();else openPause()}});window.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('pointerdown',ensureAudio,{passive:true});canvas.addEventListener('dblclick',()=>{if(!paused)openMenu()});let tap=0;canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='touch'||paused)return;const n=performance.now();if(n-tap<330)openMenu();tap=n});window.addEventListener('pagehide',()=>{if(!ended)saveSnapshot()});
const joyBase=$('#joyBase'),knob=$('#joyKnob');let joyId=null;function joyReset(){joy.x=joy.y=0;knob.style.transform='translate(0,0)'}function joySet(e){const r=joyBase.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=r.width*.34,l=Math.hypot(dx,dy)||1,s=Math.min(1,max/l),px=dx*s,py=dy*s;joy.x=px/max;joy.y=py/max;knob.style.transform=`translate(${px}px,${py}px)`}joyReset();joyBase.onpointerdown=e=>{joyId=e.pointerId;joyBase.setPointerCapture(e.pointerId);joySet(e)};joyBase.onpointermove=e=>{if(e.pointerId===joyId)joySet(e)};joyBase.onpointerup=e=>{if(e.pointerId===joyId){joyId=null;joyReset()}};joyBase.onpointercancel=joyReset;
if(DEBUG){$('#debugCreditsBtn').onclick=()=>credits+=1000;$('#debugRevealBtn').onclick=()=>{fogExplored.fill(1);updateFog(true);event('FOG 공개',1)}}

// ---------- BOOT ----------
updateFog(true);let restored=false;if(stored&&RESUME&&Number(stored.stageId)===stageId)restored=restore(stored);if(!restored){event(`STAGE ${stageId} · 추락선에서 E 카르마 교환 · Q 유료 회복`,4);saveSnapshot()}else event(`작전 복구 · 카르마 ${runKarma} · 공격 ${runStats.attack}`,3);
function frame(t){const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);drawWorld();drawMinimap();updateHud();if(bannerClock<=0)$('#eventBanner').classList.remove('show');requestAnimationFrame(frame)}requestAnimationFrame(frame);
