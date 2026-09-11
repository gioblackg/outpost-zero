import { loadMeta, saveMeta, getRunPerks, loadRun, saveRun, clearRun } from './storage.js?v=5.0.0';

const $ = s => document.querySelector(s);
const canvas = $('#gameCanvas'), ctx = canvas.getContext('2d');
const minimap = $('#minimapCanvas'), mctx = minimap.getContext('2d');
ctx.imageSmoothingEnabled = true; mctx.imageSmoothingEnabled = true;

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const RESUME = params.has('resume');
const NEW_RUN = params.has('new');
const meta = loadMeta();
const perks = getRunPerks(meta);
if (NEW_RUN) clearRun();
if (DEBUG) $('#debugPanel').classList.remove('hidden');

const STAGES = {
  1:{name:'초기 격리구역',w:2400,h:1500,time:600,diff:1,exchange:0,bases:[['W','서부 전초기지','outpost',.18,.34],['E','동부 전초기지','outpost',.82,.37],['C','북부 지휘기지','command',.50,.13]]},
  2:{name:'폐허 외곽',w:2800,h:1750,time:600,diff:1.12,exchange:0,bases:[['W','서부 전초기지','outpost',.18,.33],['E','동부 전초기지','outpost',.82,.34],['F','남부 생산기지','factory',.30,.82],['C','북부 지휘기지','command',.52,.12]]},
  3:{name:'산업지대',w:3200,h:1950,time:600,diff:1.25,exchange:1,bases:[['W','서부 전초기지','outpost',.16,.32],['E','동부 전초기지','outpost',.84,.32],['F','남서 생산기지','factory',.25,.82],['T','동남 요새','fortress',.78,.80],['C','북부 지휘기지','command',.50,.11]]},
  4:{name:'고지대',w:3600,h:2200,time:600,diff:1.4,exchange:1,bases:[['W1','서부 전초기지','outpost',.15,.30],['E1','동부 전초기지','outpost',.85,.31],['F','남서 생산기지','factory',.23,.82],['T','동남 요새','fortress',.80,.80],['M','북서 요새','fortress',.29,.17],['C','북부 지휘기지','command',.57,.11]]},
  5:{name:'봉쇄선',w:4000,h:2500,time:600,diff:1.58,exchange:2,bases:[['W1','서부 전초기지','outpost',.13,.31],['E1','동부 전초기지','outpost',.87,.31],['F1','남서 생산기지','factory',.20,.83],['F2','남동 생산기지','factory',.82,.82],['T1','서북 요새','fortress',.30,.16],['T2','동북 요새','fortress',.72,.17],['C','북부 지휘기지','command',.51,.08]]}
};

const stored = !NEW_RUN ? loadRun() : null;
let stageId = RESUME && stored ? Number(stored.stageId)||1 : Number(params.get('stage')||stored?.stageId||1);
stageId = Math.max(1,Math.min(5,stageId));
if (!RESUME && stageId > Math.max(1,meta.maxStageUnlocked)) stageId = Math.max(1,Math.min(5,meta.maxStageUnlocked));
const STAGE = STAGES[stageId];
const W=STAGE.w,H=STAGE.h,GAME_LENGTH=STAGE.time,MAX_SQUAD=10;

const home={x:W/2,y:H/2,r:78};
const player={kind:'player',type:'rifle',x:home.x+135,y:home.y+15,r:15,maxHp:100+perks.maxHp,hp:100+perks.maxHp,baseSpeed:190*(1+perks.speed),baseDamage:9.5*(1+perks.damage),burstShots:0,burstClock:0,fireClock:0,aim:0,recoil:0,muzzle:0,hit:0};
const cam={x:player.x,y:player.y};
const upgradeLevels={attack:0,defense:0,speed:0};
let allies=[],enemies=[],enemyBullets=[],tracers=[],particles=[],corpses=[],floating=[];
let gameTime=0,runKarma=0,credits=0,kills=0,destroyedBases=0,paused=false,ended=false,finalHold=0,finalDestroyed=false;
let stimRemaining=0,stimCooldown=0,healCooldown=0;
let last=performance.now(),autosaveClock=0,bannerClock=0,lastTerrain='',terrainClock=0;
const keys={};
let soundOn=meta.settings.sound!==false,audioCtx=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}function rand(a,b){return a+Math.random()*(b-a)}function d(a,b){return Math.hypot(a.x-b.x,a.y-b.y)};
function keyLabel(code){return (code||'KeyR').replace('Key','').replace('Digit','')}

// ---------- MAP / TERRAIN ----------
const roads=[],swamps=[],forests=[],plateaus=[],obstacles=[];
function buildTerrain(){
  for(const spec of STAGE.bases){roads.push({x1:home.x,y1:home.y,x2:spec[3]*W,y2:spec[4]*H,w:50});}
  swamps.push({x:W*.34,y:H*.69,r:Math.min(W,H)*.085},{x:W*.71,y:H*.43,r:Math.min(W,H)*.07});
  forests.push({x:W*.77,y:H*.28,r:Math.min(W,H)*.10},{x:W*.27,y:H*.31,r:Math.min(W,H)*.09});
  if(stageId>=2)plateaus.push({x:W*.40,y:H*.05,w:W*.22,h:H*.20});
  if(stageId>=4)plateaus.push({x:W*.68,y:H*.66,w:W*.20,h:H*.22});
  const rockCount=7+stageId*3;
  for(let i=0;i<rockCount;i++){
    const a=(i*2.399)+stageId*.7,r=Math.min(W,H)*(.20+.055*(i%5));
    const x=clamp(home.x+Math.cos(a)*r,90,W-90),y=clamp(home.y+Math.sin(a)*r,90,H-90);
    if(Math.hypot(x-home.x,y-home.y)<250)continue;
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
function blocked(x,y,rad=12){if(x<rad||x>W-rad||y<rad||y>H-rad)return true;for(const o of obstacles){if(o.type==='circle'&&Math.hypot(x-o.x,y-o.y)<rad+o.r)return true;if(o.type==='rect'&&circleRect(x,y,rad,o))return true}return false}
function terrainAt(x,y){for(const z of swamps)if(Math.hypot(x-z.x,y-z.y)<z.r)return {name:'늪지 · 이동속도 감소',speed:.78,vision:1};for(const z of forests)if(Math.hypot(x-z.x,y-z.y)<z.r)return {name:'수풀 · 시야 감소',speed:.94,vision:.78};for(const z of plateaus)if(pointRect(x,y,z))return {name:'고지대 · 사거리 증가',speed:1,vision:1.17,high:true};for(const r of roads){const vx=r.x2-r.x1,vy=r.y2-r.y1,c=vx*vx+vy*vy||1,t=clamp(((x-r.x1)*vx+(y-r.y1)*vy)/c,0,1);if(Math.hypot(x-(r.x1+t*vx),y-(r.y1+t*vy))<r.w/2)return {name:'도로 · 이동속도 증가',speed:1.08,vision:1}}return{name:'',speed:1,vision:1}}
function move(u,nx,ny,speed,dt){const step=speed*terrainAt(u.x,u.y).speed*dt,ox=u.x,oy=u.y,tx=ox+nx*step,ty=oy+ny*step;if(!blocked(tx,ty,u.r)){u.x=tx;u.y=ty;return}if(!blocked(tx,oy,u.r)){u.x=tx;return}if(!blocked(ox,ty,u.r)){u.y=ty;return}const sx=-ny,sy=nx;if(!blocked(ox+sx*step*.7,oy+sy*step*.7,u.r)){u.x+=sx*step*.7;u.y+=sy*step*.7}}
function lineBlocked(x1,y1,x2,y2){const n=Math.ceil(Math.hypot(x2-x1,y2-y1)/26);for(let i=1;i<n;i++){const t=i/n,x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;for(const o of obstacles){if(o.type==='circle'&&Math.hypot(x-o.x,y-o.y)<o.r)return true;if(o.type==='rect'&&pointRect(x,y,o))return true}}return false}

// ---------- THREE-STATE FOG ----------
const EXP_SCALE=.20;
const exploreMask=document.createElement('canvas');exploreMask.width=Math.ceil(W*EXP_SCALE);exploreMask.height=Math.ceil(H*EXP_SCALE);const ex=exploreMask.getContext('2d');ex.imageSmoothingEnabled=true;
let explorationTrail=[],lastStamp=null;
function visionRadius(u){const base=u===player?235:105;return base*(terrainAt(u.x,u.y).vision||1)}
function stampExplore(x,y,rad,record=true){
  const sx=x*EXP_SCALE,sy=y*EXP_SCALE,sr=rad*EXP_SCALE;const g=ex.createRadialGradient(sx,sy,sr*.78,sx,sy,sr);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.78,'rgba(255,255,255,1)');g.addColorStop(1,'rgba(255,255,255,0)');ex.fillStyle=g;ex.beginPath();ex.arc(sx,sy,sr,0,Math.PI*2);ex.fill();
  if(record&&(!lastStamp||Math.hypot(x-lastStamp[0],y-lastStamp[1])>24)){const p=[Math.round(x),Math.round(y),Math.round(rad)];explorationTrail.push(p);lastStamp=p;if(explorationTrail.length>2200)explorationTrail.splice(0,explorationTrail.length-2200)}
}
function rebuildExplore(){ex.clearRect(0,0,exploreMask.width,exploreMask.height);lastStamp=null;for(const p of explorationTrail)stampExplore(p[0],p[1],p[2],false)}
function currentSources(){return [player,...allies.filter(a=>a.hp>0)]}
function visibleAt(x,y){if(Math.hypot(x-home.x,y-home.y)<180)return true;for(const u of currentSources())if(Math.hypot(x-u.x,y-u.y)<visionRadius(u))return true;return false}
function exploredAt(x,y){const px=Math.floor(x*EXP_SCALE),py=Math.floor(y*EXP_SCALE);if(px<0||py<0||px>=exploreMask.width||py>=exploreMask.height)return false;return ex.getImageData(px,py,1,1).data[3]>40}
function stampCurrentExploration(){stampExplore(player.x,player.y,visionRadius(player),true);for(const a of allies)if(a.hp>0)stampExplore(a.x,a.y,visionRadius(a)*.9,false)}
function drawMaskSlice(targetCtx,targetW,targetH,alpha){
  const left=cam.x-canvas.width/2,top=cam.y-canvas.height/2;
  targetCtx.save();targetCtx.globalCompositeOperation='destination-out';targetCtx.globalAlpha=alpha;
  const sx=Math.max(0,left*EXP_SCALE),sy=Math.max(0,top*EXP_SCALE),sw=Math.min(exploreMask.width-sx,canvas.width*EXP_SCALE),sh=Math.min(exploreMask.height-sy,canvas.height*EXP_SCALE);
  const dx=Math.max(0,-left),dy=Math.max(0,-top),dw=sw/EXP_SCALE,dh=sh/EXP_SCALE;
  if(sw>0&&sh>0)targetCtx.drawImage(exploreMask,sx,sy,sw,sh,dx,dy,dw,dh);
  targetCtx.restore();
}
function punchVision(targetCtx,mapMode=false){
  const sources=[{...home,r:180},...currentSources().map(u=>({...u,r:visionRadius(u)}))];
  targetCtx.save();targetCtx.globalCompositeOperation='destination-out';
  for(const s of sources){
    let x,y,r;if(mapMode){x=s.x/W*minimap.width;y=s.y/H*minimap.height;r=s.r/W*minimap.width*1.15}else{x=s.x-(cam.x-canvas.width/2);y=s.y-(cam.y-canvas.height/2);r=s.r}
    const g=targetCtx.createRadialGradient(x,y,r*.78,x,y,r);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.78,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');targetCtx.fillStyle=g;targetCtx.beginPath();targetCtx.arc(x,y,r,0,Math.PI*2);targetCtx.fill();
  }
  targetCtx.restore();
}
const fogCanvas=document.createElement('canvas');fogCanvas.width=canvas.width;fogCanvas.height=canvas.height;const fctx=fogCanvas.getContext('2d');
function drawFog(){
  fctx.clearRect(0,0,fogCanvas.width,fogCanvas.height);fctx.fillStyle='#000';fctx.fillRect(0,0,fogCanvas.width,fogCanvas.height);
  // explored areas remain as a dark, desaturated memory of the last seen terrain
  drawMaskSlice(fctx,canvas.width,canvas.height,.43); // leaves ~57% black
  punchVision(fctx,false); // current sight is fully clear
  ctx.drawImage(fogCanvas,0,0);
}

// ---------- BASES / ENEMIES ----------
const BASE_TYPE={outpost:{hp:620,r:58,tier:1,def:6,reinforce:11,respawn:21},factory:{hp:900,r:70,tier:2,def:8,reinforce:14,respawn:19},fortress:{hp:1250,r:80,tier:3,def:10,reinforce:18,respawn:18},command:{hp:1700,r:94,tier:4,def:12,reinforce:23,respawn:17}};
const enemyBases=STAGE.bases.map(s=>{const t=BASE_TYPE[s[2]],hp=Math.round(t.hp*STAGE.diff);return{id:s[0],name:s[1],type:s[2],x:s[3]*W,y:s[4]*H,r:t.r,tier:t.tier,hp,maxHp:hp,alive:true,activated:false,spawnClock:t.respawn,ruinClock:22,hit:0}});
const exchangeStations=[];if(STAGE.exchange>=1)exchangeStations.push({x:W*.18,y:H*.61,r:46,name:'서부 교환소'});if(STAGE.exchange>=2)exchangeStations.push({x:W*.83,y:H*.58,r:46,name:'동부 교환소'});
const ET={raider:{hp:54,speed:74,r:14,dmg:10,karma:11,color:'#8fab73'},runner:{hp:42,speed:116,r:11,dmg:8,karma:10,color:'#d7a363'},brute:{hp:175,speed:48,r:22,dmg:18,karma:28,color:'#9c6678'},gunner:{hp:88,speed:58,r:15,dmg:8,karma:18,color:'#baa45f',range:260}};
function enemyKind(tier){const r=Math.random();if(tier>=3&&r<.19)return'brute';if(tier>=2&&r<.38)return'gunner';if(r<.63)return'runner';return'raider'}
function spawnEnemy(x,y,type='raider',baseId=null,angry=false){const t=ET[type],mult=STAGE.diff;const e={type,x,y,r:t.r,maxHp:t.hp*mult,hp:t.hp*mult,speed:t.speed*(1+.04*(stageId-1)),dmg:t.dmg*mult,karma:Math.round(t.karma*mult),color:t.color,baseId,angry,attack:0,shot:rand(.2,.8),hit:0};enemies.push(e);return e}
function spawnAroundBase(b,count,angry=false){for(let i=0;i<count;i++){const a=Math.PI*2*i/count+rand(-.18,.18),r=b.r+70+rand(0,80);spawnEnemy(b.x+Math.cos(a)*r,b.y+Math.sin(a)*r,enemyKind(b.tier),b.id,angry)}}
function nonCommandAlive(){return enemyBases.filter(b=>b.alive&&b.type!=='command').length}
function damageBase(b,dmg){if(!b.alive)return;if(b.type==='command'&&nonCommandAlive()>0){if(b.hit<=0)event('지휘기지 보호막 · 다른 거점을 먼저 파괴하세요.',1.5);b.hit=.2;return}b.hp-=dmg;b.hit=.14;if(b.hp<=0){b.hp=0;b.alive=false;destroyedBases++;runKarma+=80+b.tier*55;sfx('boom');event(`${b.name} 파괴! 대규모 잔존 병력 출현`,2.5);spawnAroundBase(b,BASE_TYPE[b.type].reinforce+stageId*2,true);saveSnapshot();if(b.type==='command'){finalDestroyed=true;finalHold=10;event('지휘기지 붕괴 · 10초만 버티세요!',2.5)}}}

function aliveSquad(){return [player,...allies.filter(a=>a.hp>0)]}
function squadCount(){return 1+allies.filter(a=>a.hp>0).length}
function nearestTarget(u,range){let best=null,bd=range;for(const e of enemies){if(!visibleAt(e.x,e.y))continue;const dd=d(u,e);if(dd<bd&&!lineBlocked(u.x,u.y,e.x,e.y)){best=e;bd=dd}}if(!best){for(const b of enemyBases){if(!b.alive||!visibleAt(b.x,b.y))continue;const dd=d(u,b)-b.r;if(dd<bd&&!lineBlocked(u.x,u.y,b.x,b.y)){best=b;bd=dd}}}return best}
function nearestSquad(e){let best=player,bd=d(e,player);for(const a of allies){if(a.hp<=0)continue;const dd=d(e,a);if(dd<bd){best=a;bd=dd}}return [best,bd]}

// ---------- AUDIO ----------
function ensureAudio(){if(audioCtx)return;try{audioCtx=new(window.AudioContext||window.webkitAudioContext)()}catch{}}
function tone(freq=.1,dur=.06,vol=.04,type='square'){if(!soundOn)return;ensureAudio();if(!audioCtx)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(vol,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur)}
function sfx(k){if(k==='shot')tone(rand(155,185),.045,.035,'square');else if(k==='hit')tone(85,.035,.022,'square');else if(k==='kill')tone(70,.07,.035,'sawtooth');else if(k==='exchange'){tone(520,.08,.05);setTimeout(()=>tone(760,.1,.05),70)}else if(k==='upgrade')tone(620,.09,.05);else if(k==='stim')tone(240,.18,.06,'sawtooth');else if(k==='heal'){tone(430,.10,.045,'sine');setTimeout(()=>tone(690,.14,.05,'sine'),80)}else if(k==='boom')tone(55,.35,.09,'sawtooth')}

// ---------- COMBAT ----------
function attackMul(){return 1+upgradeLevels.attack*.16}function defenseMul(){return Math.max(.35,(1-perks.defense)*(1-upgradeLevels.defense*.09)/(stimRemaining>0?2:1))}function speedMul(){return (1+upgradeLevels.speed*.10)*(stimRemaining>0?2:1)}function stimDamage(){return stimRemaining>0?2:1}function fireRate(){return stimRemaining>0?.5:1}
function tracer(x1,y1,x2,y2,color='#ffe59c',life=.10){tracers.push({x1,y1,x2,y2,color,life,max:life})}
function hitEnemy(e,dmg,from){e.hp-=dmg;e.hit=.09;const dx=e.x-from.x,dy=e.y-from.y,l=Math.hypot(dx,dy)||1;e.x+=dx/l*3;e.y+=dy/l*3;sfx('hit');floating.push({x:e.x,y:e.y-20,text:`-${Math.round(dmg)}`,life:.55,color:'#ffe3a0'});if(e.hp<=0){kills++;runKarma+=e.karma;sfx('kill');corpses.push({x:e.x,y:e.y,r:e.r,life:.8,color:e.color});enemies.splice(enemies.indexOf(e),1)}}
function fireRifle(u,target,damage,ally=false){const a=Math.atan2(target.y-u.y,target.x-u.x);u.aim=a;u.recoil=.08;u.muzzle=.06;const sx=u.x+Math.cos(a)*19,sy=u.y+Math.sin(a)*19,tx=target.x+rand(-3,3),ty=target.y+rand(-3,3);tracer(sx,sy,tx,ty,ally?'#d9f5ff':'#ffe2a0');sfx('shot');if(target.maxHp&&target.type&&ET[target.type])hitEnemy(target,damage,u);else if(target.alive!==undefined)damageBase(target,damage)}
function updateShooter(u,dt,ally=false){u.fireClock=Math.max(0,(u.fireClock||0)-dt);u.burstClock=Math.max(0,(u.burstClock||0)-dt);u.recoil=Math.max(0,(u.recoil||0)-dt);u.muzzle=Math.max(0,(u.muzzle||0)-dt);const range=(ally?330:345)*(terrainAt(u.x,u.y).high?1.12:1);const target=nearestTarget(u,range);if(!target){u.burstShots=0;return}if(u.fireClock<=0&&u.burstShots<=0){u.burstShots=3;u.burstClock=0}if(u.burstShots>0&&u.burstClock<=0){fireRifle(u,target,(ally?7.2:player.baseDamage)*attackMul()*stimDamage(),ally);u.burstShots--;u.burstClock=.105*fireRate();if(u.burstShots<=0)u.fireClock=.52*fireRate()}}
function addAlly(type='rifle'){if(squadCount()>=MAX_SQUAD)return false;const a={kind:'ally',type,x:player.x+rand(-35,35),y:player.y+rand(-35,35),r:type==='flame'?16:14,hp:type==='flame'?125:88,maxHp:type==='flame'?125:88,speed:type==='flame'?158:175,fireClock:rand(0,.4),burstShots:0,burstClock:0,aim:0,recoil:0,muzzle:0};allies.push(a);return true}
const FORM=[[-48,-45],[48,-45],[-82,8],[82,8],[-52,61],[52,61],[-103,63],[103,63],[0,100]];
function updateAllies(dt){for(let i=0;i<allies.length;i++){const a=allies[i];if(a.hp<=0)continue;const f=FORM[i]||[rand(-90,90),rand(-70,90)],tx=player.x+f[0],ty=player.y+f[1],dx=tx-a.x,dy=ty-a.y,l=Math.hypot(dx,dy);if(l>26)move(a,dx/(l||1),dy/(l||1),a.speed*speedMul(),dt);if(a.type==='rifle')updateShooter(a,dt,true);else{a.fireClock=Math.max(0,a.fireClock-dt);const target=nearestTarget(a,145);if(target&&a.fireClock<=0){a.aim=Math.atan2(target.y-a.y,target.x-a.x);a.muzzle=.12;a.fireClock=.68*fireRate();for(const e of [...enemies])if(d(a,e)<150&&!lineBlocked(a.x,a.y,e.x,e.y))hitEnemy(e,12*attackMul()*stimDamage(),a);tracer(a.x,a.y,a.x+Math.cos(a.aim)*125,a.y+Math.sin(a.aim)*125,'#ff9a4d',.16);tone(105,.12,.04,'sawtooth')}}}}
function hurtUnit(u,dmg){u.hp-=dmg*defenseMul();u.hit=.14;if(u===player&&u.hp<=0)endRun(false,'전투 불능');if(u!==player&&u.hp<=0){u.hp=0;event(`${u.type==='flame'?'화염 돌격병':'소총병'} 전사`,1.2)}}
function updateEnemies(dt){for(const e of [...enemies]){e.hit=Math.max(0,e.hit-dt);e.attack=Math.max(0,e.attack-dt);e.shot=Math.max(0,e.shot-dt);const owner=enemyBases.find(b=>b.id===e.baseId);const [target,td]=nearestSquad(e);const nearHome=d(e,home)<205;
    if(nearHome){const dx=e.x-home.x,dy=e.y-home.y,l=Math.hypot(dx,dy)||1;move(e,dx/l,dy/l,e.speed,dt);continue}
    const shouldChase=e.angry||td<520||(!owner||!owner.alive&&td<680);
    if(!shouldChase&&owner){const dd=d(e,owner);if(dd>owner.r+170){move(e,(owner.x-e.x)/dd,(owner.y-e.y)/dd,e.speed*.7,dt)}continue}
    if(e.type==='gunner'){
      if(td>215){move(e,(target.x-e.x)/(td||1),(target.y-e.y)/(td||1),e.speed,dt)}
      if(td<ET.gunner.range&&!lineBlocked(e.x,e.y,target.x,target.y)&&e.shot<=0){e.shot=1.25;enemyBullets.push({x:e.x,y:e.y,vx:(target.x-e.x)/(td||1)*360,vy:(target.y-e.y)/(td||1)*360,life:1.2,dmg:e.dmg});tone(95,.05,.018)}
    }else{if(td>e.r+target.r+4)move(e,(target.x-e.x)/(td||1),(target.y-e.y)/(td||1),e.speed,dt);else if(e.attack<=0){e.attack=.78;hurtUnit(target,e.dmg)}}
  }
  for(const b of enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(d(b,home)<185){b.life=0;continue}for(const u of aliveSquad())if(b.life>0&&Math.hypot(b.x-u.x,b.y-u.y)<u.r+4){hurtUnit(u,b.dmg);b.life=0;break}}enemyBullets=enemyBullets.filter(b=>b.life>0&&!blocked(b.x,b.y,2));
}
function updateBases(dt){for(const b of enemyBases){b.hit=Math.max(0,b.hit-dt);const dd=d(player,b);if(b.alive){if(dd<600&&!b.activated){b.activated=true;spawnAroundBase(b,BASE_TYPE[b.type].def+stageId,false);event(`${b.name} 경계 병력 활성화`,1.5)}if(b.activated&&dd<820){b.spawnClock-=dt;if(b.spawnClock<=0){b.spawnClock=BASE_TYPE[b.type].respawn;spawnAroundBase(b,Math.max(2,Math.floor(2+b.tier/2)),false)}}}else if(dd<760){b.ruinClock-=dt;if(b.ruinClock<=0){b.ruinClock=24-rand(0,5);spawnAroundBase(b,2+Math.floor(b.tier/2),false)}}}}

// ---------- SKILLS / ECONOMY ----------
function nearExchange(){if(d(player,home)<home.r+90)return{name:'본기지'};for(const s of exchangeStations)if(d(player,s)<s.r+40)return s;return null}
function exchange(){const s=nearExchange();if(!s||runKarma<=0)return;credits+=runKarma;event(`${s.name} · 골드 +${runKarma}`,1.7);runKarma=0;sfx('exchange');saveSnapshot()}
function useHeal(){const cost=80;if(ended||paused)return;if(player.hp>=player.maxHp-1){event('체력이 이미 가득 찼습니다.',1);return}if(healCooldown>0){event(`회복 재사용 ${healCooldown.toFixed(1)}초`,1);return}if(credits<cost){event(`골드 ${cost} 필요`,1.1);return}credits-=cost;player.hp=Math.min(player.maxHp,player.hp+player.maxHp*.34);healCooldown=4;sfx('heal');event(`응급 회복 · -${cost}C`,1.3);saveSnapshot()}
function useStim(){if(ended||paused)return;if(!meta.stimUnlocked){event('상점에서 스팀팩을 먼저 해금하세요.',1.3);return}if(stimRemaining>0||stimCooldown>0)return;const cost=player.maxHp/50;if(player.hp<=cost+1){event('체력이 너무 낮아 스팀팩을 사용할 수 없습니다.',1.4);return}player.hp-=cost;stimRemaining=10;stimCooldown=30;sfx('stim');event('STIM · 10초간 전투 성능 ×2',1.5)}
function upgradeCost(k){const base={attack:120,defense:130,speed:105}[k];return Math.round(base*Math.pow(1.48,upgradeLevels[k]))}
function renderMenu(){
  $('#menuCredit').textContent=credits;
  const data=[['attack','공격력','⚔️',`피해량 +16% · 현재 Lv.${upgradeLevels.attack}`],['defense','방어력','🛡️',`받는 피해 감소 · 현재 Lv.${upgradeLevels.defense}`],['speed','속도','⚡',`이동속도 +10% · 현재 Lv.${upgradeLevels.speed}`]];
  $('#upgradeList').innerHTML=data.map(([k,n,ic,desc])=>`<article class="upgrade-card"><div class="card-icon">${ic}</div><div><h3>${n} Lv.${upgradeLevels[k]}</h3><p>${desc}</p></div><button class="btn" data-up="${k}">${upgradeCost(k)}C</button></article>`).join('');
  $('#upgradeList').querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{const k=b.dataset.up,c=upgradeCost(k);if(credits<c){event('골드가 부족합니다.',1);return}credits-=c;upgradeLevels[k]++;sfx('upgrade');renderMenu();saveSnapshot()});
  const stimPrice=700;
  $('#shopList').innerHTML=`
    <article class="shop-card"><div class="card-icon">🔫</div><div><h3>소총병</h3><p>3점사 자동사격 · 분대 ${squadCount()}/${MAX_SQUAD}</p></div><button class="btn" data-buy="rifle">420C</button></article>
    <article class="shop-card"><div class="card-icon">🔥</div><div><h3>화염 돌격병</h3><p>근거리 범위 공격 · 높은 체력</p></div><button class="btn" data-buy="flame">650C</button></article>
    <article class="shop-card"><div class="card-icon">💉</div><div><h3>스팀팩 영구 해금</h3><p>체력 2% 소모 · 10초간 전투 성능 ×2</p></div><button class="btn" data-buy="stim" ${meta.stimUnlocked?'disabled':''}>${meta.stimUnlocked?'해금 완료':stimPrice+'C'}</button></article>`;
  $('#shopList').querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{const k=b.dataset.buy;if(k==='stim'){if(meta.stimUnlocked)return;if(credits<stimPrice){event('골드가 부족합니다.',1);return}credits-=stimPrice;meta.stimUnlocked=true;saveMeta(meta);sfx('upgrade');event('스팀팩 영구 해금!',1.4)}else{const c=k==='rifle'?420:650;if(squadCount()>=MAX_SQUAD){event('분대가 가득 찼습니다.',1);return}if(credits<c){event('골드가 부족합니다.',1);return}credits-=c;addAlly(k);sfx('upgrade')}renderMenu();saveSnapshot()});
}
function openMenu(tab='upgrade'){if(ended)return;paused=true;$('#battleMenu').classList.remove('hidden');document.querySelectorAll('.menu-tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$('#upgradeTab').classList.toggle('hidden',tab!=='upgrade');$('#shopTab').classList.toggle('hidden',tab!=='shop');renderMenu()}
function closeMenu(){if(ended)return;$('#battleMenu').classList.add('hidden');paused=false;last=performance.now()}

// ---------- SAVE ----------
function saveSnapshot(){if(ended)return;saveRun({stageId,gameTime,runKarma,credits,kills,upgradeLevels:{...upgradeLevels},player:{x:player.x,y:player.y,hp:player.hp},allies:allies.map(a=>({type:a.type,x:a.x,y:a.y,hp:a.hp,maxHp:a.maxHp})),enemyBases:enemyBases.map(b=>({id:b.id,hp:b.hp,alive:b.alive,activated:b.activated,spawnClock:b.spawnClock,ruinClock:b.ruinClock})),enemies:enemies.slice(0,80).map(e=>({type:e.type,x:e.x,y:e.y,hp:e.hp,baseId:e.baseId,angry:e.angry})),stimRemaining,stimCooldown,healCooldown,explorationTrail:explorationTrail.slice(-2200),finalDestroyed,finalHold,ended:false})}
function restore(s){if(!s||Number(s.stageId)!==stageId)return false;gameTime=s.gameTime||0;runKarma=s.runKarma||0;credits=s.credits||0;kills=s.kills||0;Object.assign(upgradeLevels,s.upgradeLevels||{});if(s.player){player.x=s.player.x;player.y=s.player.y;player.hp=s.player.hp}allies=(s.allies||[]).map(a=>({kind:'ally',r:a.type==='flame'?16:14,speed:a.type==='flame'?158:175,fireClock:0,burstShots:0,burstClock:0,aim:0,recoil:0,muzzle:0,...a}));for(const sb of s.enemyBases||[]){const b=enemyBases.find(x=>x.id===sb.id);if(b)Object.assign(b,sb)}destroyedBases=enemyBases.filter(b=>!b.alive).length;enemies=[];for(const se of s.enemies||[]) {const e=spawnEnemy(se.x,se.y,se.type,se.baseId,se.angry);e.hp=se.hp}stimRemaining=s.stimRemaining||0;stimCooldown=s.stimCooldown||0;healCooldown=s.healCooldown||0;explorationTrail=Array.isArray(s.explorationTrail)?s.explorationTrail:[];rebuildExplore();finalDestroyed=!!s.finalDestroyed;finalHold=s.finalHold||0;return true}

// ---------- UPDATE ----------
const joy={x:0,y:0};
function update(dt){if(paused||ended)return;gameTime+=dt;autosaveClock+=dt;stimRemaining=Math.max(0,stimRemaining-dt);stimCooldown=Math.max(0,stimCooldown-dt);healCooldown=Math.max(0,healCooldown-dt);bannerClock=Math.max(0,bannerClock-dt);terrainClock=Math.max(0,terrainClock-dt);
  let dx=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+joy.x,dy=(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0)+joy.y,l=Math.hypot(dx,dy);if(l>0){dx/=l;dy/=l;move(player,dx,dy,player.baseSpeed*speedMul(),dt)}
  // Home is a sanctuary: no base damage, automatic recovery, and all karma can be converted there.
  if(d(player,home)<home.r+105)player.hp=Math.min(player.maxHp,player.hp+18*dt);
  updateShooter(player,dt,false);updateAllies(dt);updateBases(dt);updateEnemies(dt);
  for(const t of tracers)t.life-=dt;tracers=tracers.filter(t=>t.life>0);for(const c of corpses)c.life-=dt;corpses=corpses.filter(c=>c.life>0);for(const f of floating){f.life-=dt;f.y-=20*dt}floating=floating.filter(f=>f.life>0);
  stampCurrentExploration();cam.x+=(player.x-cam.x)*Math.min(1,dt*7);cam.y+=(player.y-cam.y)*Math.min(1,dt*7);cam.x=clamp(cam.x,canvas.width/2,W-canvas.width/2);cam.y=clamp(cam.y,canvas.height/2,H-canvas.height/2);
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
function drawHome(){ctx.save();ctx.translate(sx(home.x),sy(home.y));ctx.fillStyle='#1b3828';ctx.beginPath();ctx.arc(0,0,home.r+14,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#9fda91';ctx.lineWidth=5;ctx.stroke();ctx.fillStyle='#b7c9ac';ctx.fillRect(-40,-32,80,64);ctx.fillStyle='#223029';ctx.fillRect(-18,-10,36,42);ctx.fillStyle='#d9ef71';ctx.fillRect(-7,-45,14,14);ctx.fillStyle='#fff';ctx.font='800 13px Malgun Gothic';ctx.textAlign='center';ctx.fillText('HOME · 회복 / 교환',0,home.r+35);ctx.restore()}
function drawBase(b){if(!visibleAt(b.x,b.y)&&!exploredAt(b.x,b.y))return;ctx.save();ctx.translate(sx(b.x),sy(b.y));if(!b.alive){ctx.fillStyle='#272d29';ctx.fillRect(-b.r*.65,-b.r*.35,b.r*1.3,b.r*.7);ctx.fillStyle='#686a64';ctx.fillRect(-b.r*.45,-b.r*.15,b.r*.9,b.r*.25);ctx.fillStyle='#b7b7ae';ctx.font='700 11px Malgun Gothic';ctx.textAlign='center';ctx.fillText('잔존 소굴',0,b.r*.65);ctx.restore();return}const colors={outpost:'#a95050',factory:'#bc6c4c',fortress:'#875c72',command:'#ce424a'};ctx.fillStyle=colors[b.type];ctx.fillRect(-b.r*.72,-b.r*.55,b.r*1.44,b.r*1.10);ctx.fillStyle='#2a2e2a';ctx.fillRect(-b.r*.3,-b.r*.30,b.r*.6,b.r*.62);if(b.type==='command'&&nonCommandAlive()>0){ctx.strokeStyle='#7fd9ff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,b.r+10,0,Math.PI*2);ctx.stroke()}ctx.fillStyle='#111';ctx.fillRect(-b.r,-b.r-.22*b.r,b.r*2,8);ctx.fillStyle='#e8d06d';ctx.fillRect(-b.r,-b.r-.22*b.r,b.r*2*(b.hp/b.maxHp),8);ctx.fillStyle='#f3e4df';ctx.font='800 12px Malgun Gothic';ctx.textAlign='center';ctx.fillText(b.name,0,b.r+22);ctx.restore()}
function drawUnit(u,playerUnit=false){if(!playerUnit&&!visibleAt(u.x,u.y))return;ctx.save();ctx.translate(sx(u.x),sy(u.y));ctx.rotate(u.aim||0);if(u.hit>0)ctx.fillStyle='#fff';else ctx.fillStyle=playerUnit?'#83cfe5':u.type==='flame'?'#e28b5a':'#b7d4c0';ctx.fillRect(-12,-10,24,20);ctx.fillStyle='#26352e';ctx.fillRect(4,-4,22,8);if(u.muzzle>0){ctx.fillStyle='#ffe26d';ctx.beginPath();ctx.moveTo(27,0);ctx.lineTo(39,-7);ctx.lineTo(38,7);ctx.closePath();ctx.fill()}ctx.restore();if(!playerUnit&&u.hp<u.maxHp){ctx.fillStyle='#111';ctx.fillRect(sx(u.x)-16,sy(u.y)-21,32,4);ctx.fillStyle='#6fda82';ctx.fillRect(sx(u.x)-16,sy(u.y)-21,32*(u.hp/u.maxHp),4)}}
function drawEnemy(e){if(!visibleAt(e.x,e.y))return;ctx.save();ctx.translate(sx(e.x),sy(e.y));ctx.fillStyle=e.hit>0?'#fff':e.color;ctx.beginPath();ctx.arc(0,0,e.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#202c25';ctx.lineWidth=4;ctx.stroke();ctx.restore()}
function drawWorld(){drawTerrain();drawHome();for(const s of exchangeStations)if(exploredAt(s.x,s.y)){ctx.save();ctx.translate(sx(s.x),sy(s.y));ctx.fillStyle='#67bfd0';ctx.beginPath();ctx.arc(0,0,s.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0e2b31';ctx.fillRect(-20,-18,40,36);ctx.fillStyle='#d4f7ff';ctx.font='700 11px Malgun Gothic';ctx.textAlign='center';ctx.fillText('교환소',0,s.r+18);ctx.restore()}for(const b of enemyBases)drawBase(b);for(const c of corpses)if(visibleAt(c.x,c.y)){ctx.globalAlpha=c.life/.8;ctx.fillStyle=c.color;ctx.fillRect(sx(c.x)-c.r,sy(c.y)-5,c.r*2,10);ctx.globalAlpha=1}for(const e of enemies)drawEnemy(e);drawUnit(player,true);for(const a of allies)if(a.hp>0)drawUnit(a,false);for(const b of enemyBullets)if(visibleAt(b.x,b.y)){ctx.fillStyle='#ff7a65';ctx.beginPath();ctx.arc(sx(b.x),sy(b.y),3,0,Math.PI*2);ctx.fill()}for(const t of tracers){if(!visibleAt(t.x2,t.y2))continue;ctx.globalAlpha=t.life/t.max;ctx.strokeStyle=t.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx(t.x1),sy(t.y1));ctx.lineTo(sx(t.x2),sy(t.y2));ctx.stroke();ctx.globalAlpha=1}ctx.font='800 12px Malgun Gothic';ctx.textAlign='center';for(const f of floating)if(visibleAt(f.x,f.y)){ctx.globalAlpha=Math.min(1,f.life*3);ctx.fillStyle=f.color;ctx.fillText(f.text,sx(f.x),sy(f.y));ctx.globalAlpha=1}drawFog()}
function drawMinimap(){const mw=minimap.width,mh=minimap.height,mx=x=>x/W*mw,my=y=>y/H*mh;mctx.fillStyle='#344e3a';mctx.fillRect(0,0,mw,mh);for(const r of roads){mctx.strokeStyle='#5c6559';mctx.lineWidth=2;mctx.beginPath();mctx.moveTo(mx(r.x1),my(r.y1));mctx.lineTo(mx(r.x2),my(r.y2));mctx.stroke()}for(const z of swamps){mctx.fillStyle='#2b4f4c';mctx.beginPath();mctx.arc(mx(z.x),my(z.y),z.r/W*mw,0,Math.PI*2);mctx.fill()}for(const p of plateaus){mctx.fillStyle='#596a4a';mctx.fillRect(mx(p.x),my(p.y),p.w/W*mw,p.h/H*mh)}for(const b of enemyBases)if(exploredAt(b.x,b.y)){mctx.fillStyle=b.alive?'#d55b58':'#747974';mctx.fillRect(mx(b.x)-3,my(b.y)-3,6,6)}for(const s of exchangeStations)if(exploredAt(s.x,s.y)){mctx.fillStyle='#8ed8ee';mctx.fillRect(mx(s.x)-2,my(s.y)-2,4,4)}mctx.fillStyle='#b8ec9a';mctx.fillRect(mx(home.x)-3,my(home.y)-3,6,6);for(const e of enemies)if(visibleAt(e.x,e.y)){mctx.fillStyle='#ff796e';mctx.fillRect(mx(e.x)-1,my(e.y)-1,2,2)}
  // mini-map fog uses the same persistent exploration mask: black unseen, dim remembered, clear current.
  const mf=document.createElement('canvas');mf.width=mw;mf.height=mh;const q=mf.getContext('2d');q.fillStyle='#000';q.fillRect(0,0,mw,mh);q.save();q.globalCompositeOperation='destination-out';q.globalAlpha=.43;q.drawImage(exploreMask,0,0,exploreMask.width,exploreMask.height,0,0,mw,mh);q.restore();punchVision(q,true);mctx.drawImage(mf,0,0);mctx.fillStyle='#fff';mctx.beginPath();mctx.arc(mx(player.x),my(player.y),3,0,Math.PI*2);mctx.fill()
}

function updateHud(){const hp=clamp(player.hp/player.maxHp*100,0,100);$('#hpBar').style.width=`${hp}%`;$('#hpText').textContent=`${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}`;$('#karmaText').textContent=runKarma;$('#creditText').textContent=credits;const remain=Math.max(0,GAME_LENGTH-gameTime);$('#timerText').textContent=finalDestroyed?`HOLD ${Math.ceil(finalHold)}`:`${Math.floor(remain/60)}:${String(Math.floor(remain%60)).padStart(2,'0')}`;$('#missionText').textContent=`STAGE ${String(stageId).padStart(2,'0')} · ${STAGE.name} · 거점 ${destroyedBases}/${enemyBases.length}`;$('#stageMiniTitle').textContent=`STAGE ${String(stageId).padStart(2,'0')}`;$('#mapSizeLabel').textContent=`${W}×${H}`;const exg=nearExchange();$('#exchangeBtn').classList.toggle('hidden',!(exg&&runKarma>0));if(exg&&runKarma>0)$('#exchangeBtn').querySelector('span').textContent=`카르마 ${runKarma} → 골드`;$('#stimCd').textContent=!meta.stimUnlocked?`${keyLabel(meta.settings.stimKey)} · LOCK`:(stimRemaining>0?`ACTIVE ${stimRemaining.toFixed(1)}`:(stimCooldown>0?`${stimCooldown.toFixed(1)}s`:`${keyLabel(meta.settings.stimKey)} · READY`));$('#stimBtn').classList.toggle('cooldown',!meta.stimUnlocked||stimCooldown>0);$('#stimBtn').classList.toggle('active',stimRemaining>0);$('#healCd').textContent=healCooldown>0?`${healCooldown.toFixed(1)}s`:`Q · 80C`;$('#healBtn').classList.toggle('cooldown',healCooldown>0||credits<80)}
function event(text,time=1.5){$('#eventBanner').textContent=text;$('#eventBanner').classList.add('show');bannerClock=time;setTimeout(()=>{if(bannerClock<=0)$('#eventBanner').classList.remove('show')},time*1000+80)}
function endRun(win,reason){if(ended)return;ended=true;paused=true;clearRun();const xp=Math.round(kills*.55+destroyedBases*35+(win?140:30));meta.accountXp=(meta.accountXp||0)+xp;meta.runs=(meta.runs||0)+1;if(win){meta.wins=(meta.wins||0)+1;if(!meta.completedStages.includes(stageId))meta.completedStages.push(stageId);meta.maxStageUnlocked=Math.max(meta.maxStageUnlocked,Math.min(20,stageId+1))}saveMeta(meta);$('#endTitle').textContent=win?`STAGE ${stageId} 클리어`:'작전 실패';$('#endReason').textContent=reason;$('#endRewards').innerHTML=`<div><span>계정 XP</span><b>+${xp}</b></div><div><span>처치</span><b>${kills}</b></div><div><span>파괴 거점</span><b>${destroyedBases}/${enemyBases.length}</b></div><div><span>미교환 카르마</span><b>${runKarma}</b></div>`;$('#endScreen').classList.remove('hidden')}

// ---------- INPUT / UI ----------
$('#menuBtn').onclick=()=>openMenu('upgrade');$('#closeMenuBtn').onclick=closeMenu;document.querySelectorAll('.menu-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.menu-tab').forEach(x=>x.classList.toggle('active',x===b));$('#upgradeTab').classList.toggle('hidden',b.dataset.tab!=='upgrade');$('#shopTab').classList.toggle('hidden',b.dataset.tab!=='shop');renderMenu()});$('#exchangeBtn').onclick=exchange;$('#stimBtn').onclick=useStim;$('#healBtn').onclick=useHeal;
function openPause(){if(ended||!$('#battleMenu').classList.contains('hidden'))return;paused=true;$('#pauseSnapshot').innerHTML=`<span>스테이지<b>${stageId}</b></span><span>분대<b>${squadCount()}/${MAX_SQUAD}</b></span><span>카르마<b>${runKarma}</b></span><span>골드<b>${credits}</b></span>`;$('#pauseOverlay').classList.remove('hidden')}
function closePause(){if(ended)return;$('#pauseOverlay').classList.add('hidden');paused=false;last=performance.now()}
$('#pauseBtn').onclick=openPause;$('#resumeBtn').onclick=closePause;$('#saveHomeBtn').onclick=()=>{saveSnapshot();location.href='/'};$('#abandonBtn').onclick=()=>{if(confirm('현재 작전을 포기할까요? 미교환 카르마와 출격 중 성장은 사라집니다.')){clearRun();location.href='/'}};
$('#soundBtn').onclick=()=>{soundOn=!soundOn;meta.settings.sound=soundOn;saveMeta(meta);$('#soundBtn').textContent=soundOn?'🔊':'🔇'};$('#soundBtn').textContent=soundOn?'🔊':'🔇';
window.addEventListener('keydown',e=>{ensureAudio();keys[e.code]=true;if(e.code===meta.settings.stimKey){e.preventDefault();useStim()}if(e.code==='KeyQ'){e.preventDefault();useHeal()}if(e.code==='KeyE'){e.preventDefault();exchange()}if(e.code==='KeyU'){e.preventDefault();$('#battleMenu').classList.contains('hidden')?openMenu():closeMenu()}if(e.code==='Escape'){e.preventDefault();if(!$('#battleMenu').classList.contains('hidden'))closeMenu();else if(!$('#pauseOverlay').classList.contains('hidden'))closePause();else openPause()}});window.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('pointerdown',ensureAudio,{passive:true});canvas.addEventListener('dblclick',()=>{if(!paused)openMenu()});let tap=0;canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='touch'||paused)return;const n=performance.now();if(n-tap<330)openMenu();tap=n});window.addEventListener('pagehide',()=>{if(!ended)saveSnapshot()});
const joyBase=$('#joyBase'),knob=$('#joyKnob');let joyId=null;function joyReset(){joy.x=joy.y=0;knob.style.transform='translate(0,0)'}function joySet(e){const r=joyBase.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=r.width*.34,l=Math.hypot(dx,dy)||1,s=Math.min(1,max/l),px=dx*s,py=dy*s;joy.x=px/max;joy.y=py/max;knob.style.transform=`translate(${px}px,${py}px)`}joyReset();joyBase.onpointerdown=e=>{joyId=e.pointerId;joyBase.setPointerCapture(e.pointerId);joySet(e)};joyBase.onpointermove=e=>{if(e.pointerId===joyId)joySet(e)};joyBase.onpointerup=e=>{if(e.pointerId===joyId){joyId=null;joyReset()}};joyBase.onpointercancel=joyReset;

if(DEBUG){$('#debugCreditsBtn').onclick=()=>credits+=1000;$('#debugSquadBtn').onclick=()=>addAlly('rifle');$('#debugRevealBtn').onclick=()=>{explorationTrail=[[W/2,H/2,Math.max(W,H)*1.2]];rebuildExplore();event('FOG 공개',1)}}

// ---------- BOOT ----------
stampExplore(home.x,home.y,190,true);let restored=false;if(stored&&RESUME&&Number(stored.stageId)===stageId)restored=restore(stored);if(!restored){event(`STAGE ${stageId} · 기지는 안전지대입니다. E 교환 · Q 유료 회복`,4);saveSnapshot()}else event(`작전 복구 · 카르마 ${runKarma} · 분대 ${squadCount()}/${MAX_SQUAD}`,3);
function frame(t){const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);drawWorld();drawMinimap();updateHud();if(bannerClock<=0)$('#eventBanner').classList.remove('show');requestAnimationFrame(frame)}requestAnimationFrame(frame);
