import { loadMeta, saveMeta, getRunPerks, accountLevelFromXp, loadRun, saveRun, clearRun } from './storage.js?v=4.0.1';

const $ = s => document.querySelector(s);
const canvas = $('#gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const minimap = $('#minimapCanvas');
const mctx = minimap.getContext('2d');
mctx.imageSmoothingEnabled = false;

const meta = loadMeta();
const metaPerks = getRunPerks(meta);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const RESUME_REQUESTED = params.has('resume');
const NEW_REQUESTED = params.has('new');
if (NEW_REQUESTED) clearRun();
if (DEBUG) $('#debugPanel').classList.remove('hidden');

const W = 3600;
const H = 2200;
const GAME_LENGTH = 10 * 60;
const MAX_SQUAD = 10;
const HOME_SAFE_RADIUS = 150;

let last = performance.now();
let gameTime = 0;
let paused = false;
let ended = false;
let finalDestroyed = false;
let finalHold = 0;
let bannerTimer = 0;
let homeUnderAttack = 0;
let homeAlarmClock = 0;
let assaultClock = 34;
let threat = 12;
let kills = 0;
let runKarma = 0;
let credits = 0;
let runSalvage = 0;
let destroyedBases = 0;
let keys = {};
let captureStimKey = false;
let soundOn = meta.settings.sound !== false;
let audioCtx = null;
let masterGain = null;
let lastShotSfx = 0;
let lastKillSfx = 0;
let lastTouchTap = 0;
let autosaveClock = 0;
let settingsReturnToPause = false;
let storyResumeAfterClose = true;
let introBlocking = false;
let lastTerrainLabel = '';
let terrainHintClock = 0;
let fogClock = 0;

const cam = { x: W / 2, y: H / 2 };
const home = { x: W / 2, y: H / 2, r: 90, hp: 1400, maxHp: 1400 };
const player = {
  kind: 'player', type: 'rifle', x: W / 2 + 170, y: H / 2 + 30, r: 16,
  hp: 120 + metaPerks.maxHp, maxHp: 120 + metaPerks.maxHp,
  baseSpeed: 205 * (1 + metaPerks.speed), baseDamage: 17 * (1 + metaPerks.damage),
  fireClock: 0, burstShots: 0, burstClock: 0, aimAngle: 0, recoil: 0, muzzle: 0,
  invuln: 0
};

const upgradeLevels = { attack: 0, defense: 0, speed: 0 };
let stimRemaining = 0;
let stimCooldown = 0;
let bankedKarma = 0;

let allies = [];
let enemies = [];
let bullets = [];
let enemyBullets = [];
let tracers = [];
let corpses = [];
let particles = [];
let floating = [];

const exchangeStations = [
  { id:'west', x: W/2 - 720, y: H/2 + 40, r: 54, name:'서부 카르마 교환소' },
  { id:'east', x: W/2 + 720, y: H/2 - 40, r: 54, name:'동부 카르마 교환소' }
];


// V4 terrain / fog. The map is still 2D, but cliffs, obstacles, roads and swamps
// change movement and line of fire so the battlefield no longer feels flat.
const roads = [
  {x1:1800,y1:1100,x2:650,y2:650,w:54},
  {x1:1800,y1:1100,x2:2950,y2:650,w:54},
  {x1:1800,y1:1100,x2:720,y2:1710,w:54},
  {x1:1800,y1:1100,x2:2880,y2:1710,w:54},
  {x1:1800,y1:1100,x2:1800,y2:250,w:58}
];
const swamps = [
  {x:1160,y:1450,r:230,label:'늪지'},
  {x:2440,y:920,r:190,label:'습지'}
];
const forests = [
  {x:2520,y:690,r:260,label:'폐허 숲'},
  {x:980,y:820,r:220,label:'수풀 지대'}
];
const plateaus = [
  {x:1420,y:70,w:760,h:410,label:'북부 고지대'},
  {x:2520,y:1420,w:760,h:590,label:'동남 고지대'}
];
const obstacles = [
  // North plateau cliffs. South gap is the ramp.
  {type:'rect',x:1420,y:70,w:38,h:400,kind:'cliff'},
  {type:'rect',x:2142,y:70,w:38,h:400,kind:'cliff'},
  {type:'rect',x:1420,y:70,w:760,h:34,kind:'cliff'},
  {type:'rect',x:1420,y:446,w:285,h:34,kind:'cliff'},
  {type:'rect',x:1895,y:446,w:285,h:34,kind:'cliff'},
  // South-east plateau cliffs. West-side gap is the ramp.
  {type:'rect',x:2520,y:1420,w:760,h:34,kind:'cliff'},
  {type:'rect',x:3242,y:1420,w:38,h:590,kind:'cliff'},
  {type:'rect',x:2520,y:1976,w:760,h:34,kind:'cliff'},
  {type:'rect',x:2520,y:1420,w:38,h:190,kind:'cliff'},
  {type:'rect',x:2520,y:1790,w:38,h:220,kind:'cliff'},
  // Rocks and ruins.
  {type:'circle',x:1420,y:1040,r:68,kind:'rock'},
  {type:'circle',x:1550,y:1390,r:54,kind:'rock'},
  {type:'circle',x:2060,y:1310,r:62,kind:'rock'},
  {type:'circle',x:2260,y:1650,r:72,kind:'rock'},
  {type:'circle',x:900,y:1210,r:58,kind:'rock'},
  {type:'rect',x:470,y:980,w:170,h:90,kind:'ruin'},
  {type:'rect',x:2960,y:990,w:180,h:100,kind:'ruin'},
  {type:'rect',x:1090,y:420,w:150,h:80,kind:'ruin'},
  {type:'rect',x:2200,y:430,w:150,h:82,kind:'ruin'}
];

const FOG_CELL = 72;
const FOG_COLS = Math.ceil(W / FOG_CELL);
const FOG_ROWS = Math.ceil(H / FOG_CELL);
const explored = new Uint8Array(FOG_COLS * FOG_ROWS);

const STORY_RECORDS = {
  'west-outpost': {title:'기록 01 · 감시망', text:'적 전투체들은 무작위로 움직이지 않는다. 모든 경계 신호가 북쪽 지휘망으로 향하고 있다.'},
  'east-outpost': {title:'기록 02 · 생존 신호', text:'폐허 바깥에서 짧은 구조 신호가 잡혔다. 우리 외에도 살아남은 사람이 있다.'},
  'factory': {title:'기록 03 · 생산시설', text:'카르마는 단순한 동력원이 아니다. 전투 명령 데이터와 함께 저장되고 있다.'},
  'fortress': {title:'기록 04 · KARMA PROJECT', text:'인간 장비와의 호환 시험 기록이 발견됐다. 이 기술은 적의 것이 아니었다.'},
  'command': {title:'기록 05 · 원점', text:'지휘망의 설계 서명은 인간 군 연구소의 것이다. 우리가 만든 것이 우리를 사냥하고 있다.'}
};

const BASE_TYPES = {
  outpost:  { label:'전초기지', hp:720,  r:62, tier:1, color:'#b85d5d', defender:5, reinforce:9,  respawn:28 },
  factory:  { label:'생산기지', hp:1100, r:76, tier:2, color:'#c97856', defender:8, reinforce:13, respawn:24 },
  fortress: { label:'요새',     hp:1550, r:88, tier:3, color:'#9e5d73', defender:10,reinforce:17, respawn:22 },
  command:  { label:'지휘기지', hp:2400, r:104,tier:4, color:'#d84d55', defender:14,reinforce:24, respawn:19, final:true }
};

const enemyBases = [
  makeEnemyBase('west-outpost','서부 전초기지','outpost',650,650),
  makeEnemyBase('east-outpost','동부 전초기지','outpost',2950,650),
  makeEnemyBase('factory','남서 생산기지','factory',720,1710),
  makeEnemyBase('fortress','남동 요새','fortress',2880,1710),
  makeEnemyBase('command','북부 지휘기지','command',1800,250)
];

function makeEnemyBase(id,name,type,x,y){
  const d = BASE_TYPES[type];
  return { id,name,type,x,y,r:d.r,hp:d.hp,maxHp:d.hp,tier:d.tier,alive:true,activated:false,spawnClock:d.respawn,ruinSpawnClock:22+Math.random()*8,hit:0 };
}

const ENEMY_TYPES = {
  raider: { hp:46, speed:78, r:14, dmg:10, karma:9, color:'#83a66e', melee:true },
  runner: { hp:32, speed:126,r:11, dmg:8,  karma:8, color:'#dea36a', melee:true },
  brute:  { hp:150,speed:52, r:23, dmg:19, karma:24,color:'#9b6677', melee:true },
  gunner: { hp:72, speed:64, r:15, dmg:9,  karma:16,color:'#b8a15e', range:285 }
};

const FORMATION = [
  [-48,-54],[48,-54],[-82,0],[82,0],[-52,60],[52,60],[-105,62],[105,62],[0,98]
];

function rand(a,b){ return a + Math.random() * (b-a); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

function pointInRect(x,y,r){ return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h; }
function pointInCircle(x,y,c){ return Math.hypot(x-c.x,y-c.y)<=c.r; }
function circleRectCollide(x,y,rad,r){
  const nx=clamp(x,r.x,r.x+r.w), ny=clamp(y,r.y,r.y+r.h);
  return Math.hypot(x-nx,y-ny) < rad;
}
function positionBlocked(x,y,rad=12){
  if(x<rad||x>W-rad||y<rad||y>H-rad)return true;
  for(const o of obstacles){
    if(o.type==='circle' && Math.hypot(x-o.x,y-o.y)<rad+o.r)return true;
    if(o.type==='rect' && circleRectCollide(x,y,rad,o))return true;
  }
  return false;
}
function findOpenPoint(x,y,rad=12){
  if(!positionBlocked(x,y,rad))return {x,y};
  for(let ring=1;ring<=8;ring++){
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2, rr=ring*32;
      const nx=clamp(x+Math.cos(a)*rr,rad,W-rad),ny=clamp(y+Math.sin(a)*rr,rad,H-rad);
      if(!positionBlocked(nx,ny,rad))return {x:nx,y:ny};
    }
  }
  return {x:clamp(x,rad,W-rad),y:clamp(y,rad,H-rad)};
}
function distancePointToSegment(px,py,x1,y1,x2,y2){
  const vx=x2-x1,vy=y2-y1,wx=px-x1,wy=py-y1;
  const c2=vx*vx+vy*vy||1;const t=clamp((wx*vx+wy*vy)/c2,0,1);
  return Math.hypot(px-(x1+t*vx),py-(y1+t*vy));
}
function terrainInfoAt(x,y){
  for(const z of swamps)if(pointInCircle(x,y,z))return {label:'늪지 · 이동 -22%',speed:.78,vision:1};
  for(const z of forests)if(pointInCircle(x,y,z))return {label:'수풀 · 시야 감소',speed:.95,vision:.78};
  for(const z of plateaus)if(pointInRect(x,y,z))return {label:'고지대 · 사거리 +12%',speed:1,vision:1.08,high:true};
  for(const r of roads)if(distancePointToSegment(x,y,r.x1,r.y1,r.x2,r.y2)<=r.w/2)return {label:'도로 · 이동 +10%',speed:1.10,vision:1};
  return {label:'',speed:1,vision:1};
}
function moveByVector(u,nx,ny,speed,dt){
  const mul=terrainInfoAt(u.x,u.y).speed;
  const step=speed*mul*dt;
  const ox=u.x,oy=u.y;let tx=ox+nx*step,ty=oy+ny*step;
  if(!positionBlocked(tx,ty,u.r||12)){u.x=tx;u.y=ty;return;}
  if(!positionBlocked(tx,oy,u.r||12)){u.x=tx;return;}
  if(!positionBlocked(ox,ty,u.r||12)){u.y=ty;return;}
  // Small side-step helps followers slide around rocks instead of freezing.
  const sx=-ny,sy=nx;
  tx=ox+sx*step*.75;ty=oy+sy*step*.75;
  if(!positionBlocked(tx,ty,u.r||12)){u.x=tx;u.y=ty;}
}
function lineBlocked(x1,y1,x2,y2){
  const d=Math.hypot(x2-x1,y2-y1);const n=Math.max(2,Math.ceil(d/24));
  for(let i=1;i<n;i++){
    const t=i/n,x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;
    for(const o of obstacles){
      if(o.type==='circle'&&Math.hypot(x-o.x,y-o.y)<o.r)return true;
      if(o.type==='rect'&&pointInRect(x,y,o))return true;
    }
  }
  return false;
}
function rangeMulAt(x,y){ return terrainInfoAt(x,y).high ? 1.12 : 1; }
function visionRadiusFor(u){ return 410*(terrainInfoAt(u.x,u.y).vision||1); }
function currentlyVisible(x,y){
  if(Math.hypot(x-home.x,y-home.y)<255)return true;
  for(const u of aliveSquad())if(Math.hypot(x-u.x,y-u.y)<=visionRadiusFor(u))return true;
  return false;
}
function fogIndex(cx,cy){ return cy*FOG_COLS+cx; }
function exploredAt(x,y){
  const cx=clamp(Math.floor(x/FOG_CELL),0,FOG_COLS-1),cy=clamp(Math.floor(y/FOG_CELL),0,FOG_ROWS-1);
  return explored[fogIndex(cx,cy)]===1;
}
function updateExploration(force=false){
  fogClock-=force?999:0;
  const sources=[home,...aliveSquad()];
  for(const src of sources){
    const rad=src===home?270:visionRadiusFor(src);
    const minx=clamp(Math.floor((src.x-rad)/FOG_CELL),0,FOG_COLS-1),maxx=clamp(Math.floor((src.x+rad)/FOG_CELL),0,FOG_COLS-1);
    const miny=clamp(Math.floor((src.y-rad)/FOG_CELL),0,FOG_ROWS-1),maxy=clamp(Math.floor((src.y+rad)/FOG_CELL),0,FOG_ROWS-1);
    for(let cy=miny;cy<=maxy;cy++)for(let cx=minx;cx<=maxx;cx++){
      const x=cx*FOG_CELL+FOG_CELL/2,y=cy*FOG_CELL+FOG_CELL/2;
      if(Math.hypot(x-src.x,y-src.y)<=rad)explored[fogIndex(cx,cy)]=1;
    }
  }
}
function aliveSquad(){ return [player, ...allies.filter(a=>a.hp>0)]; }
function squadCount(){ return 1 + allies.length; }
function attackMul(){ return 1 + upgradeLevels.attack * .15; }
function defenseMul(){
  const permanent = Math.max(.55, 1 - (metaPerks.defense || 0));
  const run = Math.max(.55, 1 - upgradeLevels.defense * .055);
  const stim = stimRemaining > 0 ? .5 : 1;
  return permanent * run * stim;
}
function speedMul(){ return 1 + upgradeLevels.speed * .07; }
function stimMoveMul(){ return stimRemaining>0 ? 2 : 1; }
function stimFireMul(){ return stimRemaining>0 ? 2 : 1; }
function stimDamageMul(){ return stimRemaining>0 ? 2 : 1; }
function stimDuration(){ return 10; }
function stimMaxCd(){ return 30; }
function karmaRate(){ return 1; }

function ensureAudio(){
  if (!soundOn) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!masterGain) {
      masterGain = audioCtx.createGain();
      masterGain.gain.value = .55;
      masterGain.connect(audioCtx.destination);
    }
  } catch {}
}

function tone(freq=220,dur=.08,vol=.08,type='square',endFreq=null,delay=0){
  if (!soundOn) return;
  ensureAudio(); if (!audioCtx || !masterGain) return;
  const now = audioCtx.currentTime + delay;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq,now);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),now+dur);
  g.gain.setValueAtTime(vol,now); g.gain.exponentialRampToValueAtTime(.0001,now+dur);
  o.connect(g); g.connect(masterGain); o.start(now); o.stop(now+dur+.01);
}

function noise(dur=.06,vol=.06,delay=0){
  if (!soundOn) return;
  ensureAudio(); if (!audioCtx || !masterGain) return;
  const length=Math.max(1,Math.floor(audioCtx.sampleRate*dur));
  const buffer=audioCtx.createBuffer(1,length,audioCtx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<length;i++) data[i]=(Math.random()*2-1)*(1-i/length);
  const src=audioCtx.createBufferSource(); src.buffer=buffer;
  const g=audioCtx.createGain(); const now=audioCtx.currentTime+delay;
  g.gain.setValueAtTime(vol,now); g.gain.exponentialRampToValueAtTime(.0001,now+dur);
  src.connect(g);g.connect(masterGain);src.start(now);src.stop(now+dur+.01);
}

function sfx(name){
  if (!soundOn) return;
  const now=performance.now();
  if(name==='shot' && now-lastShotSfx<34) return;
  if(name==='kill' && now-lastKillSfx<55) return;
  if(name==='shot') lastShotSfx=now;
  if(name==='kill') lastKillSfx=now;
  switch(name){
    case 'shot': {
      const pitch=rand(150,188); tone(pitch,.034,.075,'square',pitch*.62); noise(.032,.06); tone(rand(62,78),.055,.035,'sawtooth',42);
      break;
    }
    case 'hit': tone(rand(72,96),.045,.05,'sawtooth',48); noise(.025,.025); break;
    case 'kill': tone(108,.07,.055,'square',62); noise(.06,.05); break;
    case 'baseHit': tone(72,.13,.10,'sawtooth',45); noise(.08,.07); break;
    case 'alarm': tone(380,.12,.11,'square'); tone(250,.15,.10,'square',null,.14); break;
    case 'exchange': tone(520,.10,.08,'square'); tone(760,.14,.08,'square',null,.09); break;
    case 'upgrade': tone(440,.08,.07,'square'); tone(660,.10,.08,'square',null,.07); tone(880,.12,.06,'square',null,.15); break;
    case 'recruit': tone(280,.09,.08,'square'); tone(420,.12,.08,'square',null,.08); break;
    case 'stim': noise(.16,.08); tone(110,.24,.11,'sawtooth',430); break;
    case 'enemyBase': tone(210,.13,.09,'square'); tone(160,.13,.09,'square',null,.16); break;
    case 'destroy': noise(.32,.14); tone(95,.35,.11,'sawtooth',38); break;
    case 'win': tone(390,.15,.09,'square'); tone(590,.18,.09,'square',null,.14); tone(820,.24,.09,'square',null,.28); break;
    case 'lose': tone(210,.25,.09,'sawtooth',90); tone(120,.35,.08,'sawtooth',55,.2); break;
  }
}

function event(text,duration=2.4){
  $('#eventBanner').textContent=text;
  $('#eventBanner').classList.add('show');
  bannerTimer=duration;
}

function floatingText(x,y,text,color='#fff',life=.75){ floating.push({x,y,text,color,life}); }
function burst(x,y,color='#f0c36d',count=8,power=120){
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2, sp=rand(power*.35,power);
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rand(.25,.7),color,size:rand(2,5)});
  }
}

function weightedEnemy(tier=1){
  const r=Math.random();
  if(tier>=3 && r<.14) return 'gunner';
  if(tier>=2 && r<.30) return 'brute';
  if(r<.55) return 'runner';
  return 'raider';
}

function spawnEnemyAt(x,y,kind='raider',ownerBaseId=null,objective='guard'){
  if(enemies.length>150) return null;
  const spec=ENEMY_TYPES[kind];
  const open=findOpenPoint(x,y,spec.r);x=open.x;y=open.y;
  const hpScale=1 + gameTime/1300 + threat*.0022;
  const dmgScale=1 + gameTime/1800 + threat*.0018;
  const e={
    x,y,type:kind,ownerBaseId,objective,r:spec.r,
    hp:spec.hp*hpScale,maxHp:spec.hp*hpScale,speed:spec.speed,dmg:spec.dmg*dmgScale,karma:spec.karma,
    attack:rand(0,.4),hit:0,kx:0,ky:0,homeBound:objective==='home',wander:Math.random()*Math.PI*2
  };
  enemies.push(e); return e;
}

function spawnAroundBase(b,count,objective='guard',ringMin=105,ringMax=220){
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2, r=rand(ringMin,ringMax);
    spawnEnemyAt(b.x+Math.cos(a)*r,b.y+Math.sin(a)*r,weightedEnemy(b.tier),b.id,objective);
  }
}

function activateBase(b){
  if(!b.alive || b.activated) return;
  b.activated=true;
  const d=BASE_TYPES[b.type];
  spawnAroundBase(b,d.defender + Math.floor(threat/35),'guard');
  event(`⚠ ${b.name} 경계망 활성화`,2.6); sfx('enemyBase');
}

function spawnRetaliation(b){
  const d=BASE_TYPES[b.type];
  const count=d.reinforce + Math.floor(threat/16);
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2, r=rand(240,390);
    const kind = i%6===0 && b.tier>=2 ? 'brute' : (i%7===0 && b.tier>=3 ? 'gunner' : weightedEnemy(Math.max(1,b.tier)));
    spawnEnemyAt(b.x+Math.cos(a)*r,b.y+Math.sin(a)*r,kind,null,'hunt');
  }
  event(`🚨 ${b.name} 파괴 — 대규모 증원군 접근!`,3.4); sfx('destroy');
}

function spawnHomeAssault(){
  const alive=enemyBases.filter(b=>b.alive);
  if(!alive.length) return;
  const source=alive[Math.floor(Math.random()*alive.length)];
  const count=Math.min(18,3 + Math.floor(threat/14) + Math.floor(gameTime/180));
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2, r=rand(120,210);
    spawnEnemyAt(source.x+Math.cos(a)*r,source.y+Math.sin(a)*r,weightedEnemy(source.tier),source.id,'home');
  }
  event(`적 공격대 ${count}기 — 본기지로 이동 중`,2.7);
}

function damageEnemyBase(b,dmg){
  if(!b?.alive) return;
  b.hp-=dmg; b.hit=.10;
  if(b.hp<=0){
    b.hp=0;b.alive=false;b.ruinSpawnClock=BASE_TYPES[b.type].final?5:rand(18,28);destroyedBases++;runKarma+=60*b.tier;
    threat=clamp(threat-(7+b.tier*3),0,100);
    burst(b.x,b.y,'#ff8b70',30,260);
    floatingText(b.x,b.y-110,`KARMA +${60*b.tier}`,'#ffd36d',1.2);
    spawnRetaliation(b);
    unlockStoryRecord(b.id);
    saveSnapshot('base-destroyed');
    if(BASE_TYPES[b.type].final){
      finalDestroyed=true;finalHold=12;
      event('지휘기지 파괴! 폐허에서 쏟아지는 마지막 역습을 12초 버티세요!',4);
    } else {
      event(`${b.name} 파괴 · 폐허에서는 잔존 병력이 계속 출현합니다.`,3.1);
    }
  }
}

function nearestCombatTarget(x,y,maxRange=650){
  const effective=maxRange*rangeMulAt(x,y);
  let target=null,best=effective;
  for(const e of enemies){
    const d=Math.hypot(x-e.x,y-e.y);
    if(d<best && !lineBlocked(x,y,e.x,e.y)){best=d;target=e;}
  }
  if(target) return {kind:'enemy',target,d:best};
  for(const b of enemyBases){
    if(!b.alive) continue;
    const d=Math.hypot(x-b.x,y-b.y)-b.r;
    if(d<best && !lineBlocked(x,y,b.x,b.y)){best=d;target=b;}
  }
  return target ? {kind:'base',target,d:best} : null;
}

function applyFriendlyHit(target,damage,angle){
  if(!target) return;
  if(target.hp === undefined) return;
  target.hp -= damage;
  target.hit = .12;
  if(target.kx !== undefined){
    target.kx += Math.cos(angle) * 58;
    target.ky += Math.sin(angle) * 58;
  }
  burst(target.x,target.y,'#f4d5a1',2,48);
  if(Math.random()<.55) sfx('hit');
  if(target.hp<=0) killEnemy(target,angle);
}

function rifleShot(u,found,baseDamage,soundChance=1){
  if(!found?.target) return;
  const t=found.target;
  const angle=Math.atan2(t.y-u.y,t.x-u.x);
  u.aimAngle=angle;u.recoil=.10;u.muzzle=.065;
  const muzzleX=u.x+Math.cos(angle)*23,muzzleY=u.y+Math.sin(angle)*23;
  const spread=rand(-.018,.018);
  const endX=t.x+Math.cos(angle+Math.PI/2)*rand(-3,3),endY=t.y+Math.sin(angle+Math.PI/2)*rand(-3,3);
  tracers.push({x1:muzzleX,y1:muzzleY,x2:endX,y2:endY,life:.07,maxLife:.07});
  particles.push({x:u.x-Math.sin(angle)*5,y:u.y+Math.cos(angle)*5,vx:-Math.sin(angle)*rand(55,90)-Math.cos(angle)*20,vy:Math.cos(angle)*rand(55,90)-Math.sin(angle)*20,life:.32,color:'#d8b85e',size:2});
  const damage=baseDamage*attackMul()*stimDamageMul();
  if(found.kind==='enemy') applyFriendlyHit(t,damage,angle+spread); else damageEnemyBase(t,damage);
  if(Math.random()<soundChance)sfx('shot');
}

function updateRifleFire(u,dt,baseDamage,range,cycle,soundChance=1){
  u.recoil=Math.max(0,(u.recoil||0)-dt);
  u.muzzle=Math.max(0,(u.muzzle||0)-dt);
  if((u.burstShots||0)>0){
    u.burstClock-=dt;
    if(u.burstClock<=0){
      const found=nearestCombatTarget(u.x,u.y,range);
      if(!found){u.burstShots=0;u.fireClock=.18;return;}
      rifleShot(u,found,baseDamage,soundChance);
      u.burstShots--;
      u.burstClock=.09/stimFireMul();
      if(u.burstShots<=0)u.fireClock=cycle/stimFireMul();
    }
    return;
  }
  u.fireClock-=dt;
  if(u.fireClock>0)return;
  const found=nearestCombatTarget(u.x,u.y,range);
  if(!found)return;
  u.burstShots=3;u.burstClock=0;
}

function autoFirePlayer(dt){
  updateRifleFire(player,dt,player.baseDamage,620,.48,1);
}

function updatePlayer(dt){
  let dx=0,dy=0;
  if(keys.KeyW||keys.ArrowUp)dy--; if(keys.KeyS||keys.ArrowDown)dy++;
  if(keys.KeyA||keys.ArrowLeft)dx--; if(keys.KeyD||keys.ArrowRight)dx++;
  dx+=joy.x;dy+=joy.y;
  const mag=Math.hypot(dx,dy);
  if(mag>.08){
    const sp=player.baseSpeed*speedMul()*stimMoveMul();
    moveByVector(player,dx/mag,dy/mag,sp,dt);
    if(stimRemaining>0 && Math.random()<dt*22) particles.push({x:player.x,y:player.y+12,vx:rand(-25,25),vy:rand(20,60),life:.3,color:'#d9f06a',size:3});
  }
  player.x=clamp(player.x,28,W-28);player.y=clamp(player.y,28,H-28);
  player.invuln=Math.max(0,player.invuln-dt);
  stimRemaining=Math.max(0,stimRemaining-dt);
  stimCooldown=Math.max(0,stimCooldown-dt);
  autoFirePlayer(dt);

  if(dist(player,home)<HOME_SAFE_RADIUS+35){
    player.hp=Math.min(player.maxHp,player.hp+4*dt);
  }
}

function addAlly(type='rifle'){
  if(squadCount()>=MAX_SQUAD) return false;
  const isFlame=type==='flame';
  const hp=isFlame?132:88;
  const spawn=findOpenPoint(player.x+rand(-35,35),player.y+rand(-35,35),isFlame?15:13);
  allies.push({
    kind:'ally',type,x:spawn.x,y:spawn.y,r:isFlame?15:13,
    hp,maxHp:hp,baseSpeed:isFlame?202:215,fireClock:rand(0,.5),burstShots:0,burstClock:0,aimAngle:0,recoil:0,muzzle:0,invuln:0,slot:allies.length
  });
  reindexAllies();return true;
}

function reindexAllies(){ allies.forEach((a,i)=>a.slot=i); }

function nearestEnemyTo(x,y,range=99999){
  let target=null,best=range;
  for(const e of enemies){const d=Math.hypot(x-e.x,y-e.y);if(d<best){best=d;target=e;}}
  return target?{target,d:best}:null;
}

function updateAllies(dt){
  for(let i=allies.length-1;i>=0;i--){
    const a=allies[i];
    if(a.hp<=0){burst(a.x,a.y,'#9edcf1',12,130);floatingText(a.x,a.y-20,'분대원 전사','#ff8e84',1);allies.splice(i,1);reindexAllies();continue;}
    a.invuln=Math.max(0,a.invuln-dt);if(a.type!=='rifle')a.fireClock-=dt;
    const form=FORMATION[a.slot]||[0,100+a.slot*10];
    let tx=player.x+form[0],ty=player.y+form[1];
    const near=nearestEnemyTo(a.x,a.y,a.type==='flame'?270:520);
    if(a.type==='flame' && near && dist(player,near.target)<310){
      const d=Math.max(1,near.d);tx=near.target.x+(a.x-near.target.x)/d*82;ty=near.target.y+(a.y-near.target.y)/d*82;
    }
    const dx=tx-a.x,dy=ty-a.y,d=Math.hypot(dx,dy);
    if(d>8){const sp=a.baseSpeed*speedMul()*stimMoveMul()*(d>250?1.7:1);moveByVector(a,dx/d,dy/d,sp,dt);}
    if(dist(a,home)<HOME_SAFE_RADIUS+35) a.hp=Math.min(a.maxHp,a.hp+3*dt);
    if(a.type!=='rifle'){a.recoil=Math.max(0,(a.recoil||0)-dt);a.muzzle=Math.max(0,(a.muzzle||0)-dt);}

    if(a.type==='rifle'){
      updateRifleFire(a,dt,12.5*(1+metaPerks.damage),520,.66,.58);
    } else {
      if(a.fireClock<=0){
        let targetInfo=nearestEnemyTo(a.x,a.y,128);
        let target=targetInfo?.target || enemyBases.find(b=>b.alive&&Math.hypot(a.x-b.x,a.y-b.y)<b.r+100);
        if(target && !lineBlocked(a.x,a.y,target.x,target.y)){
          a.fireClock=.78/stimFireMul();
          const dmg=23*(1+metaPerks.damage)*attackMul()*stimDamageMul();
          const ang=Math.atan2(target.y-a.y,target.x-a.x);a.aimAngle=ang;a.recoil=.08;a.muzzle=.07;
          for(const e of [...enemies]){
            const dd=dist(a,e);if(dd>142)continue;
            const ea=Math.atan2(e.y-a.y,e.x-a.x);let diff=Math.atan2(Math.sin(ea-ang),Math.cos(ea-ang));
            if(Math.abs(diff)<.72){e.hp-=dmg;e.hit=.11;if(e.hp<=0)killEnemy(e);}
          }
          for(const b of enemyBases){if(b.alive&&dist(a,b)<b.r+118)damageEnemyBase(b,dmg*.8);}
          for(let p=0;p<12;p++)particles.push({x:a.x+Math.cos(ang)*18,y:a.y+Math.sin(ang)*18,vx:Math.cos(ang+rand(-.55,.55))*rand(90,220),vy:Math.sin(ang+rand(-.55,.55))*rand(90,220),life:rand(.12,.32),color:'#ffb15f',size:rand(3,6)});
          tone(105,.06,.045,'sawtooth',70);
        }
      }
    }
  }
}

function chooseEnemyTarget(e){
  const squad=aliveSquad();
  let nearest=null,best=99999;
  for(const u of squad){const d=dist(e,u);if(d<best){best=d;nearest=u;}}
  const owner=enemyBases.find(b=>b.id===e.ownerBaseId);
  if(e.objective==='home'){
    if(nearest && best<190) return nearest;
    return home;
  }
  if(e.objective==='ruin' && owner){
    if(nearest && best<520) return nearest;
    return owner;
  }
  if(e.objective==='hunt' || !owner || !owner.alive) return nearest||home;
  if(nearest && best<560) return nearest;
  return owner;
}

function hitSquadUnit(u,dmg){
  if(u===player){
    if(player.invuln>0)return;
    player.hp-=dmg*defenseMul();player.invuln=.24;
    floatingText(player.x,player.y-22,`-${Math.round(dmg*defenseMul())}`,'#ffb0a7',.55);sfx('hit');
    if(player.hp<=0) endRun(false,'지휘 전투원이 쓰러졌습니다.');
  } else {
    if(u.invuln>0)return;
    u.hp-=dmg*defenseMul();u.invuln=.22;
    floatingText(u.x,u.y-20,`-${Math.round(dmg*defenseMul())}`,'#ffb0a7',.5);
  }
}

function onHomeHit(dmg){
  home.hp-=dmg;homeUnderAttack=2.8;$('#damageVignette').classList.add('active');
  setTimeout(()=>$('#damageVignette').classList.remove('active'),180);
  floatingText(home.x,home.y-92,`-${Math.round(dmg)}`,'#ff8e84',.65);sfx('baseHit');
  if(homeAlarmClock<=0){sfx('alarm');homeAlarmClock=2.2;event('🚨 본기지가 공격받고 있습니다!',1.9);}
  if(home.hp<=0) endRun(false,'본기지가 파괴되었습니다.');
}

function updateEnemies(dt){
  for(const b of enemyBases) b.hit=Math.max(0,b.hit-dt);
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];e.hit=Math.max(0,e.hit-dt);e.attack-=dt;e.x+=(e.kx||0)*dt;e.y+=(e.ky||0)*dt;e.kx=(e.kx||0)*Math.exp(-9*dt);e.ky=(e.ky||0)*Math.exp(-9*dt);
    const target=chooseEnemyTarget(e);if(!target)continue;
    let dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1;
    const spec=ENEMY_TYPES[e.type];

    if(target===home || target===player || target.kind==='ally'){
      if(spec.range){
        if(d>spec.range*.82 || lineBlocked(e.x,e.y,target.x,target.y)){moveByVector(e,dx/d,dy/d,e.speed,dt);}
        if(d<=spec.range && !lineBlocked(e.x,e.y,target.x,target.y) && e.attack<=0){
          e.attack=1.25;const a=Math.atan2(dy,dx);
          enemyBullets.push({x:e.x,y:e.y,vx:Math.cos(a)*340,vy:Math.sin(a)*340,r:4,life:1.5,damage:e.dmg});
          tone(125,.05,.035,'square',95);
        }
      } else {
        if(d>e.r+(target.r||15)+3){moveByVector(e,dx/d,dy/d,e.speed,dt);}
        if(d<=e.r+(target.r||15)+5 && e.attack<=0){
          e.attack=e.type==='brute'?1.15:.82;
          if(target===home)onHomeHit(e.dmg);else hitSquadUnit(target,e.dmg);
        }
      }
    } else {
      // target is its own base: return to guard perimeter
      const desired=target.r+rand(100,160);
      if(d>desired){moveByVector(e,dx/d,dy/d,e.speed*.6,dt);}
    }
  }
}

function updateFriendlyBullets(dt){
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(b.life<=0){bullets.splice(i,1);continue;}
    let consumed=false;
    for(const e of [...enemies]){
      if(Math.hypot(b.x-e.x,b.y-e.y)<b.r+e.r){
        e.hp-=b.damage;e.hit=.09;floatingText(e.x,e.y-18,Math.round(b.damage),'#fff4bd',.36);
        if(e.hp<=0)killEnemy(e); consumed=true;break;
      }
    }
    if(!consumed){
      for(const eb of enemyBases){
        if(!eb.alive)continue;
        if(Math.hypot(b.x-eb.x,b.y-eb.y)<b.r+eb.r){damageEnemyBase(eb,b.damage);consumed=true;break;}
      }
    }
    if(consumed)bullets.splice(i,1);
  }
}

function updateEnemyBullets(dt){
  for(let i=enemyBullets.length-1;i>=0;i--){
    const b=enemyBullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(b.life<=0){enemyBullets.splice(i,1);continue;}
    if(positionBlocked(b.x,b.y,b.r||3)){burst(b.x,b.y,'#e7c784',3,55);enemyBullets.splice(i,1);continue;}
    let hit=false;
    for(const u of aliveSquad()){
      if(Math.hypot(b.x-u.x,b.y-u.y)<b.r+u.r){hitSquadUnit(u,b.damage);hit=true;break;}
    }
    if(!hit && Math.hypot(b.x-home.x,b.y-home.y)<b.r+home.r){onHomeHit(b.damage);hit=true;}
    if(hit)enemyBullets.splice(i,1);
  }
}

function killEnemy(e,angle=0){
  const idx=enemies.indexOf(e);if(idx<0)return;
  enemies.splice(idx,1);kills++;runKarma+=e.karma;
  if(kills===1) event('미확인 에너지 감지 · KARMA가 축적됩니다.',2.8);
  corpses.push({x:e.x,y:e.y,r:e.r,type:e.type,vx:Math.cos(angle)*75,vy:Math.sin(angle)*75,life:.55,maxLife:.55,rot:angle});
  floatingText(e.x,e.y-22,`+${e.karma} K`,'#ffd36d',.7);burst(e.x,e.y,e.type==='brute'?'#c88998':'#d6b66c',5,90);sfx('kill');
}

function updateEnemyBases(dt){
  for(const b of enemyBases){
    const d=dist(player,b);
    if(!b.alive){
      b.ruinSpawnClock-=dt;
      if(b.ruinSpawnClock<=0){
        const isFinal=BASE_TYPES[b.type].final;
        b.ruinSpawnClock=isFinal?rand(5,7):rand(20,30)-b.tier;
        const count=isFinal?Math.min(6,3+b.tier):Math.min(4,1+Math.ceil(b.tier/2));
        spawnAroundBase(b,count,'ruin',70,155);
      }
      continue;
    }
    if(d<480+b.tier*20)activateBase(b);
    if(!b.activated && threat<45)continue;
    b.spawnClock-=dt;
    if(b.spawnClock<=0){
      const def=BASE_TYPES[b.type];b.spawnClock=def.respawn*(1-threat*.004);
      const localCount=Math.min(6,1+b.tier+Math.floor(threat/45));
      spawnAroundBase(b,localCount,d<650?'guard':(threat>65?'home':'guard'),110,190);
    }
  }
}

function updateThreat(dt){
  const power=enemyBases.filter(b=>b.alive).reduce((sum,b)=>sum+b.tier,0);
  const camping=dist(player,home)<330 ? .045 : 0;
  threat=clamp(threat + dt*(power*.0075 + camping),0,100);
  assaultClock-=dt;
  if(assaultClock<=0){
    spawnHomeAssault();
    assaultClock=Math.max(16,42-threat*.25);
  }
}

function nearbyExchange(){
  if(dist(player,home)<HOME_SAFE_RADIUS+18) return {x:home.x,y:home.y,name:'본기지',home:true};
  for(const s of exchangeStations) if(dist(player,s)<s.r+30) return s;
  return null;
}

function exchangeKarma(){
  if(paused||ended||runKarma<=0)return;
  const station=nearbyExchange();if(!station){event('카르마 교환소 또는 본기지에서 교환할 수 있습니다.',1.8);return;}
  const gain=Math.floor(runKarma*karmaRate());
  credits+=gain;bankedKarma+=runKarma;runKarma=0;sfx('exchange');event(`${station.name} · 크레딧 +${gain}`,2.2);saveSnapshot('exchange');
  burst(player.x,player.y,'#80d9e8',14,90);
}

function useStim(){
  if(paused||ended||stimCooldown>0)return;
  if(!meta.stimUnlocked){event('스팀팩은 상점에서 한 번 구매하면 영구 해금됩니다.',2.1);return;}
  const cost=player.maxHp/50;
  if(player.hp<=cost+1){event('체력이 너무 낮아 스팀팩을 사용할 수 없습니다.',1.8);return;}
  player.hp-=cost;
  stimRemaining=stimDuration();stimCooldown=stimMaxCd();sfx('stim');event('스팀팩 가동 · 10초간 공격·연사·이동·방어 성능 2배',2.4);
}

const UPGRADE_DEFS={
  attack:{name:'공격력',icon:'▲',desc:'분대 전체 피해량 +15% / LV',baseCost:120,growth:1.42},
  defense:{name:'방어력',icon:'◆',desc:'분대 전체 받는 피해 약 -5.5% / LV',baseCost:110,growth:1.45},
  speed:{name:'속도',icon:'»',desc:'분대 이동속도 +7% / LV',baseCost:95,growth:1.43}
};
function upgradeCost(id){const d=UPGRADE_DEFS[id],lv=upgradeLevels[id];return Math.floor(d.baseCost*Math.pow(d.growth,lv)/10)*10;}
function buyUpgrade(id){
  const cost=upgradeCost(id);if(credits<cost)return;
  credits-=cost;upgradeLevels[id]++;sfx('upgrade');renderBattleMenu();saveSnapshot('upgrade');
}

function recruitCost(type){
  const n=allies.filter(a=>a.type===type).length;
  return type==='rifle' ? 320+n*85 : 480+n*120;
}
function recruit(type){
  if(squadCount()>=MAX_SQUAD)return;
  const cost=recruitCost(type);if(credits<cost)return;
  credits-=cost;if(addAlly(type)){sfx('recruit');event(type==='rifle'?'소총병이 분대에 합류했습니다.':'화염 돌격병이 분대에 합류했습니다.',1.8);}renderBattleMenu();saveSnapshot('recruit');
}

function upgradeStatLine(id){
  if(id==='attack')return `현재 +${Math.round((attackMul()-1)*100)}%`;
  if(id==='defense')return `현재 추가 방어 ${Math.round((1-Math.max(.55,1-upgradeLevels.defense*.055))*100)}%`;
  return `현재 +${Math.round((speedMul()-1)*100)}%`;
}

function renderBattleMenu(){
  $('#menuCredit').textContent=credits;
  const holder=$('#upgradeList');holder.innerHTML='';
  for(const [id,d] of Object.entries(UPGRADE_DEFS)){
    const cost=upgradeCost(id),lv=upgradeLevels[id];
    const card=document.createElement('article');card.className='fixed-upgrade-card';
    card.innerHTML=`<div class="upgrade-icon">${d.icon}</div><div class="upgrade-copy"><strong>${d.name} <em>LV.${lv}</em></strong><span>${d.desc}</span><small>${upgradeStatLine(id)}</small></div><button class="btn small" ${credits<cost?'disabled':''}>${cost} C</button>`;
    card.querySelector('button').onclick=()=>buyUpgrade(id);holder.appendChild(card);
  }
  const rifleCount=allies.filter(a=>a.type==='rifle').length,flameCount=allies.filter(a=>a.type==='flame').length;
  const full=squadCount()>=MAX_SQUAD;
  const stimCost=700;
  $('#shopList').innerHTML=`
    <article class="shop-card"><div class="unit-avatar rifle-avatar">R</div><div><strong>소총병</strong><span>3점사 원거리 화력 · 자동 추종</span><small>현재 ${rifleCount}명 · 분대 ${squadCount()}/${MAX_SQUAD}</small></div><button class="btn small" id="buyRifle" ${full||credits<recruitCost('rifle')?'disabled':''}>${full?'FULL':recruitCost('rifle')+' C'}</button></article>
    <article class="shop-card"><div class="unit-avatar flame-avatar">F</div><div><strong>화염 돌격병</strong><span>근거리 부채꼴 화염 · 밀집 적 처리</span><small>현재 ${flameCount}명 · 체력이 더 높음</small></div><button class="btn small" id="buyFlame" ${full||credits<recruitCost('flame')?'disabled':''}>${full?'FULL':recruitCost('flame')+' C'}</button></article>
    <article class="shop-card stim-shop-card"><div class="unit-avatar stim-avatar">S</div><div><strong>스팀팩 · 영구 해금</strong><span>HP 2% 소모 · 10초간 전투 성능 2배</span><small>${meta.stimUnlocked?'이미 영구 해금됨':'한 번 구매하면 이후 모든 출격에서 사용 가능'}</small></div><button class="btn small" id="buyStim" ${meta.stimUnlocked||credits<stimCost?'disabled':''}>${meta.stimUnlocked?'OWNED':stimCost+' C'}</button></article>`;
  $('#buyRifle')?.addEventListener('click',()=>recruit('rifle'));
  $('#buyFlame')?.addEventListener('click',()=>recruit('flame'));
  $('#buyStim')?.addEventListener('click',()=>{
    if(meta.stimUnlocked||credits<stimCost)return;
    credits-=stimCost;meta.stimUnlocked=true;saveMeta(meta);sfx('upgrade');event('스팀팩 영구 해금! R키로 사용할 수 있습니다.',2.4);renderBattleMenu();saveSnapshot('stim-unlock');
  });
}

function openBattleMenu(tab='upgrade'){
  if(ended)return;paused=true;renderBattleMenu();
  document.querySelectorAll('.menu-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  $('#upgradeTab').classList.toggle('hidden',tab!=='upgrade');$('#shopTab').classList.toggle('hidden',tab!=='shop');
  $('#battleMenu').classList.remove('hidden');
}
function closeBattleMenu(){if(ended)return;$('#battleMenu').classList.add('hidden');paused=false;last=performance.now();}

function keyLabel(code){
  if(code?.startsWith('Key'))return code.slice(3);
  if(code?.startsWith('Digit'))return code.slice(5);
  return ({Space:'SPACE',ShiftLeft:'L-SHIFT',ShiftRight:'R-SHIFT',ControlLeft:'L-CTRL',ControlRight:'R-CTRL',AltLeft:'L-ALT',AltRight:'R-ALT'})[code]||code||'R';
}
function validStimKey(code){return /^((Key|Digit)[A-Z0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight)$/.test(code||'') && !['KeyW','KeyA','KeyS','KeyD','KeyE','KeyU'].includes(code);}
function openSettings(fromPause=false){if(ended)return;settingsReturnToPause=fromPause;paused=true;if(fromPause)$('#pauseOverlay').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);$('#settingsOverlay').classList.remove('hidden');}
function closeSettings(){
  captureStimKey=false;$('#keyCaptureHint').classList.add('hidden');$('#settingsOverlay').classList.add('hidden');
  if(settingsReturnToPause){settingsReturnToPause=false;openPauseMenu();return;}
  paused=false;last=performance.now();
}

function unlockStoryRecord(id){
  const rec=STORY_RECORDS[id];if(!rec)return;
  meta.storyUnlocked ||= [];
  if(meta.storyUnlocked.includes(id))return;
  meta.storyUnlocked.push(id);saveMeta(meta);
  storyResumeAfterClose=true;paused=true;
  $('#storyEyebrow').textContent='FIELD RECORD RECOVERED';
  $('#storyTitle').textContent=rec.title;$('#storyText').textContent=rec.text;
  $('#storyOverlay').classList.remove('hidden');
}
function closeStoryRecord(){
  $('#storyOverlay').classList.add('hidden');
  if(storyResumeAfterClose&&!ended){paused=false;last=performance.now();}
}

function saveSnapshot(reason='auto'){
  if(ended)return false;
  const snapshot={
    reason,gameTime,finalDestroyed,finalHold,threat,kills,runKarma,credits,bankedKarma,destroyedBases,assaultClock,
    home:{hp:home.hp},
    player:{x:player.x,y:player.y,hp:player.hp,aimAngle:player.aimAngle},
    upgradeLevels:{...upgradeLevels},stimRemaining,stimCooldown,
    allies:allies.map(a=>({type:a.type,x:a.x,y:a.y,hp:a.hp,maxHp:a.maxHp,slot:a.slot,aimAngle:a.aimAngle||0,fireClock:a.fireClock||0,burstShots:a.burstShots||0,burstClock:a.burstClock||0})),
    enemies:enemies.slice(0,150).map(e=>({x:e.x,y:e.y,type:e.type,ownerBaseId:e.ownerBaseId,objective:e.objective,hp:e.hp,maxHp:e.maxHp,speed:e.speed,dmg:e.dmg,karma:e.karma,r:e.r,attack:e.attack||0,kx:e.kx||0,ky:e.ky||0,hit:e.hit||0,wander:e.wander||0})),
    enemyBases:enemyBases.map(b=>({id:b.id,hp:b.hp,alive:b.alive,activated:b.activated,spawnClock:b.spawnClock,ruinSpawnClock:b.ruinSpawnClock})),
    explored:Array.from(explored)
  };
  return saveRun(snapshot);
}

function restoreSnapshot(snap){
  if(!snap)return false;
  gameTime=Number(snap.gameTime)||0;finalDestroyed=!!snap.finalDestroyed;finalHold=Number(snap.finalHold)||0;
  threat=clamp(Number(snap.threat)||12,0,100);kills=Number(snap.kills)||0;runKarma=Number(snap.runKarma)||0;credits=Number(snap.credits)||0;
  bankedKarma=Number(snap.bankedKarma)||0;destroyedBases=Number(snap.destroyedBases)||0;assaultClock=Number(snap.assaultClock)||28;
  if(snap.home)home.hp=clamp(Number(snap.home.hp)||home.maxHp,0,home.maxHp);
  if(snap.player){player.x=Number(snap.player.x)||player.x;player.y=Number(snap.player.y)||player.y;player.hp=clamp(Number(snap.player.hp)||player.maxHp,1,player.maxHp);player.aimAngle=Number(snap.player.aimAngle)||0;}
  if(snap.upgradeLevels){upgradeLevels.attack=Number(snap.upgradeLevels.attack)||0;upgradeLevels.defense=Number(snap.upgradeLevels.defense)||0;upgradeLevels.speed=Number(snap.upgradeLevels.speed)||0;}
  stimRemaining=Number(snap.stimRemaining)||0;stimCooldown=Number(snap.stimCooldown)||0;
  allies=(snap.allies||[]).slice(0,MAX_SQUAD-1).map((a,i)=>({kind:'ally',type:a.type==='flame'?'flame':'rifle',x:a.x,y:a.y,r:a.type==='flame'?15:13,hp:a.hp,maxHp:a.maxHp|| (a.type==='flame'?132:88),baseSpeed:a.type==='flame'?202:215,fireClock:a.fireClock||0,burstShots:a.burstShots||0,burstClock:a.burstClock||0,aimAngle:a.aimAngle||0,recoil:0,muzzle:0,invuln:0,slot:i}));
  enemies=(snap.enemies||[]).slice(0,150).map(e=>({...e,kind:'enemy',attack:e.attack||0,hit:0,kx:e.kx||0,ky:e.ky||0}));
  for(const saved of snap.enemyBases||[]){const b=enemyBases.find(x=>x.id===saved.id);if(b)Object.assign(b,{hp:saved.hp,alive:saved.alive,activated:saved.activated,spawnClock:saved.spawnClock,ruinSpawnClock:saved.ruinSpawnClock});}
  destroyedBases=enemyBases.filter(b=>!b.alive).length;
  if(Array.isArray(snap.explored))for(let i=0;i<Math.min(explored.length,snap.explored.length);i++)explored[i]=snap.explored[i]?1:0;
  reindexAllies();cam.x=player.x;cam.y=player.y;updateExploration(true);return true;
}

function openPauseMenu(){
  if(ended||introBlocking||!$('#storyOverlay').classList.contains('hidden'))return;
  paused=true;
  const remain=Math.max(0,GAME_LENGTH-gameTime),m=Math.floor(remain/60),sec=Math.floor(remain%60);
  $('#pauseSnapshot').innerHTML=`<span>남은 시간 <b>${m}:${String(sec).padStart(2,'0')}</b></span><span>카르마 <b>${runKarma}</b></span><span>크레딧 <b>${credits}</b></span><span>분대 <b>${squadCount()}/${MAX_SQUAD}</b></span>`;
  $('#pauseOverlay').classList.remove('hidden');saveSnapshot('pause');
}
function closePauseMenu(){if(ended)return;$('#pauseOverlay').classList.add('hidden');paused=false;last=performance.now();}
function saveAndGoHome(){saveSnapshot('home');location.href='/';}
function openAbandonConfirm(){paused=true;$('#pauseOverlay').classList.add('hidden');$('#abandonOverlay').classList.remove('hidden');}
function closeAbandonConfirm(){ $('#abandonOverlay').classList.add('hidden');$('#pauseOverlay').classList.remove('hidden'); }
function abandonRun(){clearRun();location.href='/';}

function updateTerrainHint(dt){
  const label=terrainInfoAt(player.x,player.y).label;
  if(label!==lastTerrainLabel){lastTerrainLabel=label;if(label){$('#terrainHint').textContent=label;$('#terrainHint').classList.remove('hidden');terrainHintClock=1.8;}}
  if(terrainHintClock>0){terrainHintClock-=dt;if(terrainHintClock<=0)$('#terrainHint').classList.add('hidden');}
}

function update(dt){
  if(paused||ended)return;
  gameTime+=dt;autosaveClock+=dt;fogClock+=dt;
  if(!finalDestroyed && gameTime>=GAME_LENGTH){endRun(false,'10분 내 적 지휘기지를 파괴하지 못했습니다.');return;}
  if(finalDestroyed){finalHold-=dt;if(finalHold<=0){endRun(true,'적 지휘기지를 파괴하고 마지막 역습까지 버텼습니다.');return;}}
  updatePlayer(dt);updateAllies(dt);updateEnemies(dt);updateFriendlyBullets(dt);updateEnemyBullets(dt);updateEnemyBases(dt);updateThreat(dt);
  if(fogClock>=.20){updateExploration();fogClock=0;}
  updateTerrainHint(dt);
  if(autosaveClock>=10){saveSnapshot('auto');autosaveClock=0;}
  homeUnderAttack=Math.max(0,homeUnderAttack-dt);homeAlarmClock=Math.max(0,homeAlarmClock-dt);
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;if(p.life<=0)particles.splice(i,1);}
  for(let i=floating.length-1;i>=0;i--){const f=floating[i];f.y-=24*dt;f.life-=dt;if(f.life<=0)floating.splice(i,1);}
  for(let i=tracers.length-1;i>=0;i--){tracers[i].life-=dt;if(tracers[i].life<=0)tracers.splice(i,1);}
  for(let i=corpses.length-1;i>=0;i--){const c=corpses[i];c.x+=c.vx*dt;c.y+=c.vy*dt;c.vx*=Math.exp(-7*dt);c.vy*=Math.exp(-7*dt);c.life-=dt;if(c.life<=0)corpses.splice(i,1);}
  if(bannerTimer>0){bannerTimer-=dt;if(bannerTimer<=0)$('#eventBanner').classList.remove('show');}
  cam.x+=(player.x-cam.x)*Math.min(1,dt*5);cam.y+=(player.y-cam.y)*Math.min(1,dt*5);
}

function drawGround(){
  ctx.fillStyle='#29462f';ctx.fillRect(0,0,W,H);

  // broad terrain patches
  ctx.fillStyle='#31533a';
  for(let x=90;x<W;x+=310)for(let y=85;y<H;y+=270){
    if(Math.abs(x-home.x)<300&&Math.abs(y-home.y)<280)continue;
    ctx.fillRect(x,y,24,10);ctx.fillRect(x+14,y-10,9,9);ctx.fillRect(x-15,y+14,12,6);
  }

  // roads
  ctx.save();ctx.lineCap='round';
  for(const r of roads){
    ctx.strokeStyle='#4a5142';ctx.lineWidth=r.w+12;ctx.globalAlpha=.58;ctx.beginPath();ctx.moveTo(r.x1,r.y1);ctx.lineTo(r.x2,r.y2);ctx.stroke();
    ctx.strokeStyle='#66705a';ctx.lineWidth=r.w;ctx.globalAlpha=.68;ctx.beginPath();ctx.moveTo(r.x1,r.y1);ctx.lineTo(r.x2,r.y2);ctx.stroke();
    ctx.strokeStyle='#829078';ctx.lineWidth=3;ctx.setLineDash([18,18]);ctx.globalAlpha=.45;ctx.beginPath();ctx.moveTo(r.x1,r.y1);ctx.lineTo(r.x2,r.y2);ctx.stroke();ctx.setLineDash([]);
  }
  ctx.restore();ctx.globalAlpha=1;

  // swamps
  for(const z of swamps){
    ctx.save();ctx.translate(z.x,z.y);ctx.fillStyle='#254c49';ctx.globalAlpha=.9;ctx.beginPath();ctx.arc(0,0,z.r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#3f7770';ctx.lineWidth=8;ctx.globalAlpha=.45;for(let rr=z.r*.35;rr<z.r;rr+=52){ctx.beginPath();ctx.arc(0,0,rr,.4,2.4);ctx.stroke();ctx.beginPath();ctx.arc(0,0,rr,3.5,5.4);ctx.stroke();}
    ctx.restore();ctx.globalAlpha=1;
  }

  // raised plateaus
  for(const p of plateaus){
    ctx.fillStyle='#3a5a3d';ctx.fillRect(p.x,p.y,p.w,p.h);
    ctx.fillStyle='#466947';ctx.fillRect(p.x+18,p.y+18,p.w-36,p.h-36);
    ctx.strokeStyle='#708065';ctx.lineWidth=3;ctx.setLineDash([14,9]);ctx.strokeRect(p.x+24,p.y+24,p.w-48,p.h-48);ctx.setLineDash([]);
  }

  // forests - decorative clusters, but they reduce vision while standing inside.
  for(const z of forests){
    ctx.save();ctx.translate(z.x,z.y);ctx.globalAlpha=.92;
    for(let i=0;i<18;i++){
      const a=(i*2.17)%6.28,rr=(i%6)/6*z.r*.78+36;const x=Math.cos(a)*rr,y=Math.sin(a)*rr;
      ctx.fillStyle='#193c28';ctx.fillRect(x-8,y-8,16,16);ctx.fillStyle='#2d6340';ctx.fillRect(x-15,y-20,30,18);ctx.fillStyle='#39784b';ctx.fillRect(x-8,y-30,16,15);
    }
    ctx.restore();ctx.globalAlpha=1;
  }

  for(const o of obstacles) drawObstacle(o);
}

function drawObstacle(o){
  ctx.save();
  if(o.type==='circle'){
    ctx.translate(o.x,o.y);ctx.fillStyle='#1f2c27';ctx.beginPath();ctx.ellipse(8,11,o.r*1.05,o.r*.82,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#68756a';ctx.beginPath();ctx.arc(0,0,o.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#899487';ctx.beginPath();ctx.arc(-o.r*.25,-o.r*.28,o.r*.38,0,Math.PI*2);ctx.fill();
  }else if(o.kind==='cliff'){
    ctx.fillStyle='#243328';ctx.fillRect(o.x+7,o.y+9,o.w,o.h);ctx.fillStyle='#6c735d';ctx.fillRect(o.x,o.y,o.w,o.h);ctx.fillStyle='#91977b';
    if(o.w>o.h){for(let x=o.x+8;x<o.x+o.w;x+=28)ctx.fillRect(x,o.y+4,16,5);}else{for(let y=o.y+8;y<o.y+o.h;y+=28)ctx.fillRect(o.x+4,y,5,16);}
  }else{
    ctx.fillStyle='#202923';ctx.fillRect(o.x+8,o.y+10,o.w,o.h);ctx.fillStyle='#5e655b';ctx.fillRect(o.x,o.y,o.w,o.h);ctx.fillStyle='#343a34';
    for(let x=o.x+12;x<o.x+o.w-10;x+=35)ctx.fillRect(x,o.y+12,19,18);
  }
  ctx.restore();
}

function drawFogOverlay(){
  const halfW=520,halfH=310;
  const minCx=clamp(Math.floor((cam.x-halfW)/FOG_CELL)-1,0,FOG_COLS-1),maxCx=clamp(Math.floor((cam.x+halfW)/FOG_CELL)+1,0,FOG_COLS-1);
  const minCy=clamp(Math.floor((cam.y-halfH)/FOG_CELL)-1,0,FOG_ROWS-1),maxCy=clamp(Math.floor((cam.y+halfH)/FOG_CELL)+1,0,FOG_ROWS-1);
  for(let cy=minCy;cy<=maxCy;cy++)for(let cx=minCx;cx<=maxCx;cx++){
    const x=cx*FOG_CELL,y=cy*FOG_CELL,centerX=x+FOG_CELL/2,centerY=y+FOG_CELL/2;
    if(currentlyVisible(centerX,centerY))continue;
    const seen=explored[fogIndex(cx,cy)]===1;
    ctx.fillStyle=seen?'rgba(4,10,7,.58)':'rgba(2,5,4,.96)';ctx.fillRect(x-1,y-1,FOG_CELL+2,FOG_CELL+2);
  }
}

function drawHome(){
  ctx.fillStyle='#213a2c';ctx.beginPath();ctx.arc(home.x,home.y,home.r+45,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#6d8a6f';ctx.lineWidth=5;ctx.stroke();
  ctx.fillStyle='#25392f';ctx.fillRect(home.x-92,home.y-76,184,152);
  ctx.strokeStyle=homeUnderAttack>0?'#ff756d':'#9a8d67';ctx.lineWidth=8;ctx.strokeRect(home.x-92,home.y-76,184,152);
  ctx.fillStyle='#d3c37c';ctx.fillRect(home.x-42,home.y-36,84,72);ctx.fillStyle='#1b2a22';ctx.fillRect(home.x-18,home.y+4,36,32);
  ctx.fillStyle='#d9f06a';ctx.fillRect(home.x-4,home.y-58,8,22);
  ctx.font='bold 13px monospace';ctx.textAlign='center';ctx.fillStyle='#f2efdd';ctx.fillText('HOME / EXCHANGE',home.x,home.y+110);
}

function drawExchangeStations(){
  for(const s of exchangeStations){
    ctx.save();ctx.translate(s.x,s.y);ctx.fillStyle='#163c43';ctx.beginPath();ctx.arc(0,0,s.r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#75d8e6';ctx.lineWidth=5;ctx.stroke();ctx.rotate(Math.PI/4);ctx.fillStyle='#75d8e6';ctx.fillRect(-17,-17,34,34);ctx.fillStyle='#193037';ctx.fillRect(-9,-9,18,18);ctx.restore();
    ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillStyle='#bcecf1';ctx.fillText('KARMA EXCHANGE',s.x,s.y+s.r+20);
  }
}

function drawEnemyBase(b){
  const d=BASE_TYPES[b.type];
  if(b.alive){
    ctx.globalAlpha=.09;ctx.fillStyle=d.color;ctx.beginPath();ctx.arc(b.x,b.y,360+b.tier*25,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  }
  ctx.save();ctx.translate(b.x,b.y);
  if(!b.alive){
    ctx.fillStyle='#3b3a36';ctx.fillRect(-b.r,-b.r*.45,b.r*2,b.r*.9);ctx.strokeStyle='#6c5f57';ctx.lineWidth=5;ctx.strokeRect(-b.r,-b.r*.45,b.r*2,b.r*.9);
    ctx.fillStyle='#1d231f';for(let i=-2;i<=2;i++)ctx.fillRect(i*22-7,-22+((i+2)%3)*9,14,20+((i+3)%2)*10);ctx.restore();ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillStyle='#c6a99d';ctx.fillText('잔존 소굴 · 적 계속 출현',b.x,b.y+b.r+22);return;
  }
  ctx.fillStyle=b.hit>0?'#f2d9cb':d.color;ctx.fillRect(-b.r,-b.r*.65,b.r*2,b.r*1.3);
  ctx.strokeStyle='#392827';ctx.lineWidth=7;ctx.strokeRect(-b.r,-b.r*.65,b.r*2,b.r*1.3);
  ctx.fillStyle='#202b27';ctx.fillRect(-b.r*.52,-b.r*.35,b.r*1.04,b.r*.7);
  if(b.type==='factory'){ctx.fillStyle='#d1a07c';ctx.fillRect(-b.r*.35,-b.r*1.08,b.r*.25,b.r*.55);ctx.fillRect(b.r*.12,-b.r*.95,b.r*.22,b.r*.42);}
  if(b.type==='fortress'){ctx.fillStyle='#5e3d4b';ctx.fillRect(-b.r*.8,-b.r*.95,b.r*.38,b.r*.5);ctx.fillRect(b.r*.42,-b.r*.95,b.r*.38,b.r*.5);}
  if(b.type==='command'){ctx.fillStyle='#ff7979';ctx.fillRect(-6,-b.r*1.2,12,b.r*.55);ctx.beginPath();ctx.arc(0,-b.r*1.22,16,0,Math.PI*2);ctx.fill();}
  ctx.restore();
  ctx.fillStyle='#120e0e';ctx.fillRect(b.x-b.r,b.y-b.r-22,b.r*2,8);ctx.fillStyle='#ff7b72';ctx.fillRect(b.x-b.r,b.y-b.r-22,b.r*2*(b.hp/b.maxHp),8);
  ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillStyle='#f4d9d3';ctx.fillText(`${b.name} ★${b.tier}`,b.x,b.y+b.r+25);
}

function drawUnit(u,isPlayer=false){
  const stim=stimRemaining>0;
  ctx.save();ctx.translate(u.x,u.y);
  if(isPlayer){
    ctx.fillStyle=u.invuln>0?'#fff':stim?'#d9f06a':'#9edcf1';ctx.fillRect(-15,-14,30,28);ctx.fillStyle='#26372f';ctx.fillRect(-10,-7,7,7);ctx.fillRect(3,-7,7,7);ctx.fillStyle='#d9f06a';ctx.fillRect(-5,8,10,10);
  } else if(u.type==='rifle'){
    ctx.fillStyle=u.invuln>0?'#fff':stim?'#d9f06a':'#9fc5df';ctx.fillRect(-12,-12,24,24);ctx.fillStyle='#dce7ca';ctx.fillRect(-5,-6,6,6);
  } else {
    ctx.fillStyle=u.invuln>0?'#fff':stim?'#ffe48d':'#dc8d55';ctx.fillRect(-14,-13,28,26);ctx.fillStyle='#ffd08a';ctx.fillRect(-6,-6,7,7);
  }
  if(isPlayer||u.type==='rifle'){
    ctx.save();ctx.rotate(u.aimAngle||0);const kick=(u.recoil||0)*38;ctx.fillStyle='#26372f';ctx.fillRect(4-kick,-3,19,6);ctx.fillStyle='#52665a';ctx.fillRect(15-kick,-2,10,4);
    if((u.muzzle||0)>0){ctx.fillStyle='#ffe17a';ctx.fillRect(25-kick,-5,9,10);ctx.fillStyle='#fff3bd';ctx.fillRect(29-kick,-2,9,4);}ctx.restore();
  } else {
    ctx.save();ctx.rotate(u.aimAngle||0);ctx.fillStyle='#5d352a';ctx.fillRect(7,-4,15,8);ctx.restore();
  }
  ctx.restore();
  if(!isPlayer){ctx.fillStyle='#0f1511';ctx.fillRect(u.x-u.r,u.y-u.r-8,u.r*2,4);ctx.fillStyle='#7bdba1';ctx.fillRect(u.x-u.r,u.y-u.r-8,u.r*2*(u.hp/u.maxHp),4);}
}

function drawWorld(){
  const sx=canvas.width/960,sy=canvas.height/540;ctx.setTransform(sx,0,0,sy,0,0);ctx.clearRect(0,0,960,540);
  const ox=480-cam.x,oy=270-cam.y;ctx.save();ctx.translate(ox,oy);
  drawGround();drawExchangeStations();drawHome();
  for(const b of enemyBases)drawEnemyBase(b);
  for(const c of corpses){if(!currentlyVisible(c.x,c.y))continue;ctx.save();ctx.globalAlpha=Math.max(0,c.life/c.maxLife);ctx.translate(c.x,c.y);ctx.rotate(c.rot||0);ctx.fillStyle='#6b5d55';ctx.fillRect(-c.r,-c.r*.55,c.r*2,c.r*1.1);ctx.restore();}ctx.globalAlpha=1;
  for(const e of enemies){
    if(!currentlyVisible(e.x,e.y))continue;
    ctx.save();ctx.translate(e.x,e.y);ctx.fillStyle=e.hit>0?'#f2e7d0':ENEMY_TYPES[e.type].color;ctx.fillRect(-e.r,-e.r,e.r*2,e.r*2);ctx.fillStyle='#172019';ctx.fillRect(-e.r+4,-4,5,5);ctx.fillRect(e.r-9,-4,5,5);ctx.restore();
    if(e.type==='brute'||e.type==='gunner'){ctx.fillStyle='#111';ctx.fillRect(e.x-e.r,e.y-e.r-9,e.r*2,4);ctx.fillStyle='#ff887c';ctx.fillRect(e.x-e.r,e.y-e.r-9,e.r*2*(e.hp/e.maxHp),4);}
  }
  for(const tr of tracers){if(!currentlyVisible(tr.x1,tr.y1)&&!currentlyVisible(tr.x2,tr.y2))continue;ctx.save();ctx.globalAlpha=Math.max(0,tr.life/tr.maxLife);ctx.strokeStyle='#ffe79a';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(tr.x1,tr.y1);ctx.lineTo(tr.x2,tr.y2);ctx.stroke();ctx.restore();}
  ctx.fillStyle='#ff786f';for(const b of enemyBullets)if(currentlyVisible(b.x,b.y))ctx.fillRect(b.x-3,b.y-3,6,6);
  for(const a of allies)drawUnit(a,false);drawUnit(player,true);
  for(const p of particles){if(!currentlyVisible(p.x,p.y))continue;ctx.globalAlpha=Math.max(0,Math.min(1,p.life*2.2));ctx.fillStyle=p.color||'#f0c36d';ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);}ctx.globalAlpha=1;
  ctx.font='bold 12px monospace';ctx.textAlign='center';for(const f of floating){if(!currentlyVisible(f.x,f.y))continue;ctx.globalAlpha=Math.min(1,f.life*2);ctx.fillStyle=f.color||'#fff';ctx.fillText(f.text,f.x,f.y);}ctx.globalAlpha=1;
  drawFogOverlay();
  ctx.restore();
}

function drawMinimap(){
  const w=minimap.width,h=minimap.height;mctx.clearRect(0,0,w,h);mctx.fillStyle='#030705';mctx.fillRect(0,0,w,h);
  const mx=x=>x/W*w,my=y=>y/H*h;
  // explored terrain only
  for(let cy=0;cy<FOG_ROWS;cy++)for(let cx=0;cx<FOG_COLS;cx++){
    if(!explored[fogIndex(cx,cy)])continue;
    const x=cx*FOG_CELL,y=cy*FOG_CELL;
    mctx.fillStyle='#1d3325';mctx.fillRect(mx(x),my(y),Math.ceil(FOG_CELL/W*w)+1,Math.ceil(FOG_CELL/H*h)+1);
  }
  mctx.strokeStyle='#425a4c';mctx.lineWidth=2;mctx.strokeRect(1,1,w-2,h-2);
  for(const b of enemyBases){
    if(!exploredAt(b.x,b.y))continue;
    mctx.fillStyle=b.alive?(BASE_TYPES[b.type].final?'#ff4f57':'#d66a62'):'#665953';const size=BASE_TYPES[b.type].final?8:6;mctx.fillRect(mx(b.x)-size/2,my(b.y)-size/2,size,size);
  }
  mctx.fillStyle='#75d8e6';for(const st of exchangeStations)if(exploredAt(st.x,st.y))mctx.fillRect(mx(st.x)-2,my(st.y)-2,4,4);
  mctx.fillStyle=homeUnderAttack>0&&Math.floor(performance.now()/180)%2?'#ff625f':'#ffd36d';mctx.fillRect(mx(home.x)-4,my(home.y)-4,8,8);
  mctx.fillStyle='#9edcf1';for(const a of allies)mctx.fillRect(mx(a.x)-1,my(a.y)-1,3,3);
  mctx.fillStyle='#fff';mctx.beginPath();mctx.arc(mx(player.x),my(player.y),3.5,0,Math.PI*2);mctx.fill();
  mctx.fillStyle='#e27469';for(const e of enemies)if(currentlyVisible(e.x,e.y))mctx.fillRect(mx(e.x),my(e.y),2,2);
}

function updateHud(){
  $('#hpBar').style.width=`${clamp(player.hp/player.maxHp*100,0,100)}%`;$('#hpText').textContent=`${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}`;
  $('#baseBar').style.width=`${clamp(home.hp/home.maxHp*100,0,100)}%`;$('#baseText').textContent=`${Math.ceil(home.hp)}/${Math.ceil(home.maxHp)}`;
  $('#threatBar').style.width=`${threat}%`;$('#threatText').textContent=`${Math.round(threat)}%`;
  $('#karmaText').textContent=runKarma;$('#creditText').textContent=credits;$('#squadText').textContent=`${squadCount()}/${MAX_SQUAD}`;
  const remain=Math.max(0,GAME_LENGTH-gameTime),m=Math.floor(remain/60),s=Math.floor(remain%60);$('#timerText').textContent=finalDestroyed?`HOLD ${Math.ceil(finalHold)}`:`${m}:${String(s).padStart(2,'0')}`;
  const cmd=enemyBases.find(b=>b.type==='command');const cmdSeen=exploredAt(cmd.x,cmd.y);$('#missionText').textContent=finalDestroyed?'역습을 버텨라':(cmdSeen?`북부 지휘기지 HP ${Math.ceil(cmd.hp/cmd.maxHp*100)}% · 파괴 ${destroyedBases}/${enemyBases.length}`:`북쪽 지휘 신호를 추적하라 · 파괴 ${destroyedBases}/${enemyBases.length}`);
  $('#stimCd').textContent=!meta.stimUnlocked?`${keyLabel(meta.settings.stimKey)} · LOCK`:(stimRemaining>0?`ACTIVE ${stimRemaining.toFixed(1)}`:(stimCooldown<=0?`${keyLabel(meta.settings.stimKey)} · READY`:`${stimCooldown.toFixed(1)}s`));
  $('#stimBtn').classList.toggle('cooldown',(!meta.stimUnlocked)||(stimCooldown>0&&stimRemaining<=0));$('#stimBtn').classList.toggle('active',stimRemaining>0);
  const level=threat<30?'LOW':threat<60?'MID':threat<85?'HIGH':'MAX';$('#threatLabel').textContent=level;$('#threatLabel').dataset.level=level;
  const station=nearbyExchange();$('#exchangeBtn').classList.toggle('hidden',!(station&&runKarma>0));if(station&&runKarma>0)$('#exchangeBtn').querySelector('span').textContent=`카르마 ${runKarma} 교환`;
  const alarm=homeUnderAttack>0;$('#baseAlarm').classList.toggle('hidden',!alarm);
  const far=dist(player,home)>300;$('#baseArrow').classList.toggle('hidden',!(alarm&&far));
  if(alarm&&far){const a=Math.atan2(home.y-player.y,home.x-player.x)*180/Math.PI+90;$('#baseArrow').style.transform=`translate(-50%,-50%) rotate(${a}deg)`;}
}

function endRun(win,reason){
  if(ended)return;ended=true;paused=true;sfx(win?'win':'lose');
  const earnedXp=Math.floor(kills*.62 + destroyedBases*46 + gameTime*.12 + (win?170:0));
  meta.accountXp+=earnedXp;meta.runs++;if(win)meta.wins=(meta.wins||0)+1;meta.totalKarmaBanked=(meta.totalKarmaBanked||0)+bankedKarma;meta.bestTime=Math.max(meta.bestTime,Math.floor(gameTime));
  const lv=accountLevelFromXp(meta.accountXp).level;if(lv>=10&&(meta.wins||0)>=1)meta.chapter1Complete=true;saveMeta(meta);clearRun();
  $('#endTitle').textContent=win?'작전 성공':'작전 실패';$('#endReason').textContent=reason;
  $('#endRewards').innerHTML=`
    <div class="reward"><span>계정 XP</span><b>+${earnedXp}</b></div>
    <div class="reward"><span>처치</span><b>${kills}</b></div>
    <div class="reward"><span>파괴 거점</span><b>${destroyedBases}/${enemyBases.length}</b></div>
    <div class="reward"><span>미교환 카르마</span><b>${runKarma}</b></div>`;
  $('#endScreen').classList.remove('hidden');
}

function frame(t){
  const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);drawWorld();drawMinimap();updateHud();requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Battle menu
$('#menuBtn').addEventListener('click',()=>openBattleMenu('upgrade'));
$('#closeMenuBtn').addEventListener('click',closeBattleMenu);
document.querySelectorAll('.menu-tab').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.menu-tab').forEach(x=>x.classList.toggle('active',x===b));
  $('#upgradeTab').classList.toggle('hidden',b.dataset.tab!=='upgrade');$('#shopTab').classList.toggle('hidden',b.dataset.tab!=='shop');renderBattleMenu();
}));
$('#exchangeBtn').addEventListener('click',exchangeKarma);
$('#stimBtn').addEventListener('click',useStim);

// Pause / settings / persistent operation controls
$('#pauseBtn').addEventListener('click',openPauseMenu);
$('#resumeBtn').addEventListener('click',closePauseMenu);
$('#pauseSettingsBtn').addEventListener('click',()=>openSettings(true));
$('#saveHomeBtn').addEventListener('click',saveAndGoHome);
$('#abandonBtn').addEventListener('click',openAbandonConfirm);
$('#cancelAbandonBtn').addEventListener('click',closeAbandonConfirm);
$('#confirmAbandonBtn').addEventListener('click',abandonRun);
$('#closeSettingsBtn').addEventListener('click',closeSettings);
$('#closeStoryEventBtn').addEventListener('click',closeStoryRecord);
$('#stimKeyBtn').addEventListener('click',()=>{captureStimKey=true;$('#keyCaptureHint').classList.remove('hidden');$('#keyCaptureHint').textContent='원하는 키를 누르세요. ESC는 취소입니다.';$('#stimKeyBtn').textContent='...';});
$('#resetStimKeyBtn').addEventListener('click',()=>{meta.settings.stimKey='KeyR';saveMeta(meta);$('#stimKeyBtn').textContent='R';event('스팀팩 단축키를 R로 초기화했습니다.',1.5);});
$('#soundBtn').addEventListener('click',()=>{soundOn=!soundOn;meta.settings.sound=soundOn;saveMeta(meta);$('#soundBtn').textContent=soundOn?'🔊':'🔇';if(soundOn){ensureAudio();sfx('upgrade');}});
$('#soundBtn').textContent=soundOn?'🔊':'🔇';

window.addEventListener('keydown',e=>{
  ensureAudio();
  if(captureStimKey){
    e.preventDefault();
    if(e.code==='Escape'){captureStimKey=false;$('#keyCaptureHint').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);return;}
    if(!validStimKey(e.code)){ $('#keyCaptureHint').textContent='이동·교환·메뉴 키와 겹칩니다. 다른 키를 눌러주세요.'; return; }
    meta.settings.stimKey=e.code;saveMeta(meta);captureStimKey=false;$('#stimKeyBtn').textContent=keyLabel(e.code);$('#keyCaptureHint').classList.add('hidden');saveSnapshot('settings');return;
  }
  keys[e.code]=true;
  if(e.code===meta.settings.stimKey){e.preventDefault();useStim();}
  if(e.code==='KeyE'){e.preventDefault();exchangeKarma();}
  if(e.code==='KeyU'){e.preventDefault();if(paused && $('#battleMenu').classList.contains('hidden'))return;$('#battleMenu').classList.contains('hidden')?openBattleMenu('upgrade'):closeBattleMenu();}
  if(e.code==='Escape'){
    e.preventDefault();
    if(!$('#introOverlay').classList.contains('hidden')) return;
    if(!$('#storyOverlay').classList.contains('hidden')) closeStoryRecord();
    else if(!$('#abandonOverlay').classList.contains('hidden')) closeAbandonConfirm();
    else if(!$('#settingsOverlay').classList.contains('hidden')) closeSettings();
    else if(!$('#battleMenu').classList.contains('hidden')) closeBattleMenu();
    else if(!$('#pauseOverlay').classList.contains('hidden')) closePauseMenu();
    else openPauseMenu();
  }
});
window.addEventListener('keyup',e=>keys[e.code]=false);
window.addEventListener('pointerdown',ensureAudio,{passive:true});
canvas.addEventListener('dblclick',()=>{if(!paused)openBattleMenu('upgrade');});
canvas.addEventListener('pointerup',e=>{
  if(e.pointerType!=='touch'||paused)return;
  const now=performance.now();if(now-lastTouchTap<330)openBattleMenu('upgrade');lastTouchTap=now;
});

// Browser back/close must not delete the current operation.
window.addEventListener('pagehide',()=>{ if(!ended) saveSnapshot('pagehide'); });
window.addEventListener('beforeunload',()=>{ if(!ended) saveSnapshot('beforeunload'); });
// Mobile joystick
const joy={x:0,y:0},joyBase=$('#joyBase'),knob=$('#joyKnob');let joyId=null;
function joystickReset(){joy.x=joy.y=0;knob.style.transform='translate(0,0)';}
function setJoy(e){
  const r=joyBase.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=r.width*.34,len=Math.hypot(dx,dy)||1,scale=Math.min(1,max/len),px=dx*scale,py=dy*scale;
  joy.x=px/max;joy.y=py/max;knob.style.transform=`translate(${px}px,${py}px)`;
}
joystickReset();
joyBase.addEventListener('pointerdown',e=>{joyId=e.pointerId;joyBase.setPointerCapture(e.pointerId);setJoy(e);});
joyBase.addEventListener('pointermove',e=>{if(e.pointerId===joyId)setJoy(e);});
joyBase.addEventListener('pointerup',e=>{if(e.pointerId===joyId){joyId=null;joystickReset();}});joyBase.addEventListener('pointercancel',joystickReset);

if(DEBUG){
  $('#debugTimeBtn').onclick=()=>gameTime=Math.min(GAME_LENGTH-3,gameTime+60);
  $('#debugThreatBtn').onclick=()=>threat=clamp(threat+20,0,100);
  $('#debugCreditsBtn').onclick=()=>{credits+=1000;renderBattleMenu();};
  $('#debugSquadBtn').onclick=()=>addAlly('rifle');
  $('#debugStimBtn').onclick=()=>{meta.stimUnlocked=true;saveMeta(meta);event('DEBUG · STIM 해금',1.2);};
}

// V4 boot: resume an unfinished operation when requested (or when visiting game.html directly),
// otherwise introduce the story once. New sorties explicitly clear old snapshots via ?new=1.
const storedRun = !NEW_REQUESTED ? loadRun() : null;
let restoredRun = false;
if(storedRun && (RESUME_REQUESTED || !NEW_REQUESTED)){
  restoredRun = restoreSnapshot(storedRun);
  if(restoredRun) event(`작전 복구 완료 · 카르마 ${runKarma} · 분대 ${squadCount()}/${MAX_SQUAD}`,3);
}
updateExploration(true);

if(!restoredRun && !meta.introSeen){
  paused=true;introBlocking=true;$('#introOverlay').classList.remove('hidden');
  $('#startIntroBtn').addEventListener('click',()=>{
    ensureAudio();meta.introSeen=true;saveMeta(meta);introBlocking=false;$('#introOverlay').classList.add('hidden');paused=false;last=performance.now();
    event('북쪽에서 미확인 지휘 신호 감지 · 먼저 주변을 탐색하세요.',4);saveSnapshot('intro-complete');
  },{once:true});
}else{
  event(`WASD 이동 · 3점사 자동사격 · E 카르마 교환 · U 강화/상점 · ${keyLabel(meta.settings.stimKey)} 스팀팩 · ESC 메뉴`,5);
  saveSnapshot(restoredRun?'resume':'start');
}

if(DEBUG){
  $('#debugRevealBtn').onclick=()=>{explored.fill(1);event('DEBUG · 전체 지도 공개',1.2);};
}
