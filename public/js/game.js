import { loadMeta, saveMeta, getRunPerks } from './storage.js?v=2.0.1';

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

const cam = { x: W / 2, y: H / 2 };
const home = { x: W / 2, y: H / 2, r: 90, hp: 1400, maxHp: 1400 };
const player = {
  kind: 'player', x: W / 2 + 170, y: H / 2 + 30, r: 16,
  hp: 120 + metaPerks.maxHp, maxHp: 120 + metaPerks.maxHp,
  baseSpeed: 205, baseDamage: 18 * (1 + metaPerks.damage),
  baseFireDelay: .40 / (1 + metaPerks.fireRate), fireClock: 0,
  invuln: 0
};

const upgradeLevels = { attack: 0, defense: 0, speed: 0, stim: 0 };
let stimRemaining = 0;
let stimCooldown = 0;

let allies = [];
let enemies = [];
let bullets = [];
let enemyBullets = [];
let particles = [];
let floating = [];

const exchangeStations = [
  { id:'west', x: W/2 - 720, y: H/2 + 40, r: 54, name:'서부 카르마 교환소' },
  { id:'east', x: W/2 + 720, y: H/2 - 40, r: 54, name:'동부 카르마 교환소' }
];

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
  return { id,name,type,x,y,r:d.r,hp:d.hp,maxHp:d.hp,tier:d.tier,alive:true,activated:false,spawnClock:d.respawn,hit:0 };
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
function aliveSquad(){ return [player, ...allies.filter(a=>a.hp>0)]; }
function squadCount(){ return 1 + allies.length; }
function attackMul(){ return (1 + upgradeLevels.attack * .18); }
function defenseMul(){ return Math.max(.45, 1 - upgradeLevels.defense * .055); }
function speedMul(){ return 1 + upgradeLevels.speed * .07; }
function stimMoveMul(){ return stimRemaining>0 ? 1.35 + upgradeLevels.stim*.035 : 1; }
function stimFireMul(){ return stimRemaining>0 ? 1.45 + upgradeLevels.stim*.035 : 1; }
function stimDuration(){ return 3.6 + upgradeLevels.stim*.35; }
function stimMaxCd(){ return Math.max(7, (16 - upgradeLevels.stim*.6) * (1 - Math.min(.3,metaPerks.stimCd||0))); }
function karmaRate(){ return 1 + (metaPerks.karmaRate || 0); }

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
  if(name==='shot' && now-lastShotSfx<65) return;
  if(name==='kill' && now-lastKillSfx<70) return;
  if(name==='shot') lastShotSfx=now;
  if(name==='kill') lastKillSfx=now;
  switch(name){
    case 'shot': tone(175,.045,.07,'square',120); noise(.025,.035); break;
    case 'hit': tone(90,.06,.075,'sawtooth',55); break;
    case 'kill': tone(115,.08,.07,'square',72); noise(.055,.05); break;
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
  const hpScale=1 + gameTime/1300 + threat*.0022;
  const dmgScale=1 + gameTime/1800 + threat*.0018;
  const e={
    x,y,type:kind,ownerBaseId,objective,r:spec.r,
    hp:spec.hp*hpScale,maxHp:spec.hp*hpScale,speed:spec.speed,dmg:spec.dmg*dmgScale,karma:spec.karma,
    attack:rand(0,.4),hit:0,homeBound:objective==='home',wander:Math.random()*Math.PI*2
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
    b.hp=0;b.alive=false;destroyedBases++;runKarma+=60*b.tier;runSalvage+=12*b.tier;
    threat=clamp(threat-(7+b.tier*3),0,100);
    burst(b.x,b.y,'#ff8b70',30,260);
    floatingText(b.x,b.y-110,`KARMA +${60*b.tier}`,'#ffd36d',1.2);
    spawnRetaliation(b);
    if(BASE_TYPES[b.type].final){
      finalDestroyed=true;finalHold=12;
      event('지휘기지 파괴! 12초 동안 역습을 버티세요!',4);
    }
  }
}

function nearestCombatTarget(x,y,maxRange=650){
  let target=null,best=maxRange;
  for(const e of enemies){
    const d=Math.hypot(x-e.x,y-e.y); if(d<best){best=d;target=e;}
  }
  if(target) return {kind:'enemy',target,d:best};
  for(const b of enemyBases){
    if(!b.alive) continue;
    const d=Math.hypot(x-b.x,y-b.y)-b.r; if(d<best){best=d;target=b;}
  }
  return target ? {kind:'base',target,d:best} : null;
}

function fireFriendly(x,y,target,damage,speed=620,size=4){
  const a=Math.atan2(target.y-y,target.x-x);
  bullets.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,r:size,life:1.25,damage,hit:false});
}

function autoFirePlayer(dt){
  player.fireClock-=dt;
  if(player.fireClock>0) return;
  const found=nearestCombatTarget(player.x,player.y,650);
  if(!found) return;
  player.fireClock=player.baseFireDelay/stimFireMul();
  fireFriendly(player.x,player.y,found.target,player.baseDamage*attackMul(),660,4);
  sfx('shot');
}

function updatePlayer(dt){
  let dx=0,dy=0;
  if(keys.KeyW||keys.ArrowUp)dy--; if(keys.KeyS||keys.ArrowDown)dy++;
  if(keys.KeyA||keys.ArrowLeft)dx--; if(keys.KeyD||keys.ArrowRight)dx++;
  dx+=joy.x;dy+=joy.y;
  const mag=Math.hypot(dx,dy);
  if(mag>.08){
    const sp=player.baseSpeed*speedMul()*stimMoveMul();
    player.x+=dx/mag*sp*dt;player.y+=dy/mag*sp*dt;
    if(stimRemaining>0 && Math.random()<dt*16) particles.push({x:player.x,y:player.y+12,vx:rand(-25,25),vy:rand(20,60),life:.3,color:'#d9f06a',size:3});
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
  allies.push({
    kind:'ally',type,x:player.x+rand(-35,35),y:player.y+rand(-35,35),r:isFlame?15:13,
    hp,maxHp:hp,baseSpeed:isFlame?202:215,fireClock:rand(0,.5),invuln:0,slot:allies.length
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
    a.invuln=Math.max(0,a.invuln-dt);a.fireClock-=dt;
    const form=FORMATION[a.slot]||[0,100+a.slot*10];
    let tx=player.x+form[0],ty=player.y+form[1];
    const near=nearestEnemyTo(a.x,a.y,a.type==='flame'?270:520);
    if(a.type==='flame' && near && dist(player,near.target)<310){
      const d=Math.max(1,near.d);tx=near.target.x+(a.x-near.target.x)/d*82;ty=near.target.y+(a.y-near.target.y)/d*82;
    }
    const dx=tx-a.x,dy=ty-a.y,d=Math.hypot(dx,dy);
    if(d>8){const sp=a.baseSpeed*speedMul()*stimMoveMul()*(d>250?1.7:1);a.x+=dx/d*sp*dt;a.y+=dy/d*sp*dt;}
    if(dist(a,home)<HOME_SAFE_RADIUS+35) a.hp=Math.min(a.maxHp,a.hp+3*dt);

    if(a.type==='rifle'){
      if(a.fireClock<=0){
        const found=nearestCombatTarget(a.x,a.y,540);
        if(found){a.fireClock=.68/(1+metaPerks.fireRate)/stimFireMul();fireFriendly(a.x,a.y,found.target,13*(1+metaPerks.damage)*attackMul(),610,3);if(Math.random()<.25)sfx('shot');}
      }
    } else {
      if(a.fireClock<=0){
        let targetInfo=nearestEnemyTo(a.x,a.y,128);
        let target=targetInfo?.target || enemyBases.find(b=>b.alive&&Math.hypot(a.x-b.x,a.y-b.y)<b.r+100);
        if(target){
          a.fireClock=.78/stimFireMul();
          const dmg=23*(1+metaPerks.damage)*attackMul();
          const ang=Math.atan2(target.y-a.y,target.x-a.x);
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
    const e=enemies[i];e.hit=Math.max(0,e.hit-dt);e.attack-=dt;
    const target=chooseEnemyTarget(e);if(!target)continue;
    let dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1;
    const spec=ENEMY_TYPES[e.type];

    if(target===home || target===player || target.kind==='ally'){
      if(spec.range){
        if(d>spec.range*.82){e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}
        if(d<=spec.range && e.attack<=0){
          e.attack=1.25;const a=Math.atan2(dy,dx);
          enemyBullets.push({x:e.x,y:e.y,vx:Math.cos(a)*340,vy:Math.sin(a)*340,r:4,life:1.5,damage:e.dmg});
          tone(125,.05,.035,'square',95);
        }
      } else {
        if(d>e.r+(target.r||15)+3){e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}
        if(d<=e.r+(target.r||15)+5 && e.attack<=0){
          e.attack=e.type==='brute'?1.15:.82;
          if(target===home)onHomeHit(e.dmg);else hitSquadUnit(target,e.dmg);
        }
      }
    } else {
      // target is its own base: return to guard perimeter
      const desired=target.r+rand(100,160);
      if(d>desired){e.x+=dx/d*e.speed*.6*dt;e.y+=dy/d*e.speed*.6*dt;}
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
    let hit=false;
    for(const u of aliveSquad()){
      if(Math.hypot(b.x-u.x,b.y-u.y)<b.r+u.r){hitSquadUnit(u,b.damage);hit=true;break;}
    }
    if(!hit && Math.hypot(b.x-home.x,b.y-home.y)<b.r+home.r){onHomeHit(b.damage);hit=true;}
    if(hit)enemyBullets.splice(i,1);
  }
}

function killEnemy(e){
  const idx=enemies.indexOf(e);if(idx<0)return;
  enemies.splice(idx,1);kills++;runKarma+=e.karma;
  floatingText(e.x,e.y-22,`+${e.karma} K`,'#ffd36d',.7);burst(e.x,e.y,e.type==='brute'?'#c88998':'#d6b66c',6,100);sfx('kill');
}

function updateEnemyBases(dt){
  for(const b of enemyBases){
    if(!b.alive)continue;
    const d=dist(player,b);
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
  credits+=gain;runKarma=0;sfx('exchange');event(`${station.name} · 크레딧 +${gain}`,2.2);
  burst(player.x,player.y,'#80d9e8',14,90);
}

function useStim(){
  if(paused||ended||stimCooldown>0)return;
  stimRemaining=stimDuration();stimCooldown=stimMaxCd();sfx('stim');event(`스팀팩 가동 · ${stimRemaining.toFixed(1)}초`,1.35);
}

const UPGRADE_DEFS={
  attack:{name:'공격력',icon:'▲',desc:'분대 전체 피해량 +18% / LV',baseCost:120,growth:1.42},
  defense:{name:'방어력',icon:'◆',desc:'분대 전체 받는 피해 약 -5.5% / LV',baseCost:110,growth:1.45},
  speed:{name:'속도',icon:'»',desc:'분대 이동속도 +7% / LV',baseCost:95,growth:1.43},
  stim:{name:'스팀팩',icon:'⚡',desc:'지속·가속 상승, 재사용 시간 감소',baseCost:150,growth:1.48}
};
function upgradeCost(id){const d=UPGRADE_DEFS[id],lv=upgradeLevels[id];return Math.floor(d.baseCost*Math.pow(d.growth,lv)/10)*10;}
function buyUpgrade(id){
  const cost=upgradeCost(id);if(credits<cost)return;
  credits-=cost;upgradeLevels[id]++;sfx('upgrade');renderBattleMenu();
}

function recruitCost(type){
  const n=allies.filter(a=>a.type===type).length;
  return type==='rifle' ? 320+n*85 : 480+n*120;
}
function recruit(type){
  if(squadCount()>=MAX_SQUAD)return;
  const cost=recruitCost(type);if(credits<cost)return;
  credits-=cost;if(addAlly(type)){sfx('recruit');event(type==='rifle'?'소총병이 분대에 합류했습니다.':'화염 돌격병이 분대에 합류했습니다.',1.8);}renderBattleMenu();
}

function upgradeStatLine(id){
  const lv=upgradeLevels[id];
  if(id==='attack')return `현재 +${Math.round((attackMul()-1)*100)}%`;
  if(id==='defense')return `현재 피해 ${Math.round((1-defenseMul())*100)}% 감소`;
  if(id==='speed')return `현재 +${Math.round((speedMul()-1)*100)}%`;
  return `지속 ${stimDuration().toFixed(1)}초 · 쿨 ${stimMaxCd().toFixed(1)}초`;
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
  $('#shopList').innerHTML=`
    <article class="shop-card"><div class="unit-avatar rifle-avatar">R</div><div><strong>소총병</strong><span>원거리 자동사격 · 안정적인 화력</span><small>현재 ${rifleCount}명 · 분대 ${squadCount()}/${MAX_SQUAD}</small></div><button class="btn small" id="buyRifle" ${full||credits<recruitCost('rifle')?'disabled':''}>${full?'FULL':recruitCost('rifle')+' C'}</button></article>
    <article class="shop-card"><div class="unit-avatar flame-avatar">F</div><div><strong>화염 돌격병</strong><span>근거리 부채꼴 화염 · 밀집 적 처리</span><small>현재 ${flameCount}명 · 체력이 더 높음</small></div><button class="btn small" id="buyFlame" ${full||credits<recruitCost('flame')?'disabled':''}>${full?'FULL':recruitCost('flame')+' C'}</button></article>`;
  $('#buyRifle')?.addEventListener('click',()=>recruit('rifle'));
  $('#buyFlame')?.addEventListener('click',()=>recruit('flame'));
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
function openSettings(){if(ended)return;paused=true;$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);$('#settingsOverlay').classList.remove('hidden');}
function closeSettings(){captureStimKey=false;$('#keyCaptureHint').classList.add('hidden');$('#settingsOverlay').classList.add('hidden');paused=false;last=performance.now();}

function update(dt){
  if(paused||ended)return;
  gameTime+=dt;
  if(!finalDestroyed && gameTime>=GAME_LENGTH){endRun(false,'10분 내 적 지휘기지를 파괴하지 못했습니다.');return;}
  if(finalDestroyed){finalHold-=dt;if(finalHold<=0){endRun(true,'적 지휘기지를 파괴하고 마지막 역습까지 버텼습니다.');return;}}
  updatePlayer(dt);updateAllies(dt);updateEnemies(dt);updateFriendlyBullets(dt);updateEnemyBullets(dt);updateEnemyBases(dt);updateThreat(dt);
  homeUnderAttack=Math.max(0,homeUnderAttack-dt);homeAlarmClock=Math.max(0,homeAlarmClock-dt);
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;if(p.life<=0)particles.splice(i,1);}
  for(let i=floating.length-1;i>=0;i--){const f=floating[i];f.y-=24*dt;f.life-=dt;if(f.life<=0)floating.splice(i,1);}
  if(bannerTimer>0){bannerTimer-=dt;if(bannerTimer<=0)$('#eventBanner').classList.remove('show');}
  cam.x+=(player.x-cam.x)*Math.min(1,dt*5);cam.y+=(player.y-cam.y)*Math.min(1,dt*5);
}

function drawGround(){
  ctx.fillStyle='#29462f';ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#31523a';ctx.lineWidth=1;
  for(let x=0;x<W;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.fillStyle='#355b3d';
  for(let x=80;x<W;x+=260)for(let y=90;y<H;y+=230){
    if(Math.abs(x-home.x)<320&&Math.abs(y-home.y)<300)continue;
    ctx.fillRect(x,y,18,10);ctx.fillRect(x+11,y-8,8,8);
  }
  // roads
  ctx.strokeStyle='#486048';ctx.lineWidth=38;ctx.globalAlpha=.32;
  for(const b of enemyBases){ctx.beginPath();ctx.moveTo(home.x,home.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  ctx.globalAlpha=1;
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
    ctx.fillStyle='#1d231f';for(let i=-2;i<=2;i++)ctx.fillRect(i*22-7,-22+((i+2)%3)*9,14,20+((i+3)%2)*10);ctx.restore();return;
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
  ctx.save();ctx.translate(u.x,u.y);
  const stim=stimRemaining>0;
  if(isPlayer){
    ctx.fillStyle=u.invuln>0?'#fff':stim?'#d9f06a':'#9edcf1';ctx.fillRect(-15,-14,30,28);ctx.fillStyle='#26372f';ctx.fillRect(-10,-7,7,7);ctx.fillRect(3,-7,7,7);ctx.fillStyle='#d9f06a';ctx.fillRect(-5,8,10,10);
  } else if(u.type==='rifle'){
    ctx.fillStyle=u.invuln>0?'#fff':stim?'#d9f06a':'#9fc5df';ctx.fillRect(-12,-12,24,24);ctx.fillStyle='#26372f';ctx.fillRect(5,-3,14,5);ctx.fillStyle='#dce7ca';ctx.fillRect(-5,-6,6,6);
  } else {
    ctx.fillStyle=u.invuln>0?'#fff':stim?'#ffe48d':'#dc8d55';ctx.fillRect(-14,-13,28,26);ctx.fillStyle='#5d352a';ctx.fillRect(7,-4,15,8);ctx.fillStyle='#ffd08a';ctx.fillRect(-6,-6,7,7);
  }
  ctx.restore();
  if(!isPlayer){ctx.fillStyle='#0f1511';ctx.fillRect(u.x-u.r,u.y-u.r-8,u.r*2,4);ctx.fillStyle='#7bdba1';ctx.fillRect(u.x-u.r,u.y-u.r-8,u.r*2*(u.hp/u.maxHp),4);}
}

function drawWorld(){
  const sx=canvas.width/960,sy=canvas.height/540;ctx.setTransform(sx,0,0,sy,0,0);ctx.clearRect(0,0,960,540);
  const ox=480-cam.x,oy=270-cam.y;ctx.save();ctx.translate(ox,oy);
  drawGround();drawExchangeStations();drawHome();
  for(const b of enemyBases)drawEnemyBase(b);
  for(const e of enemies){
    ctx.save();ctx.translate(e.x,e.y);ctx.fillStyle=e.hit>0?'#f2e7d0':ENEMY_TYPES[e.type].color;ctx.fillRect(-e.r,-e.r,e.r*2,e.r*2);ctx.fillStyle='#172019';ctx.fillRect(-e.r+4,-4,5,5);ctx.fillRect(e.r-9,-4,5,5);ctx.restore();
    if(e.type==='brute'||e.type==='gunner'){ctx.fillStyle='#111';ctx.fillRect(e.x-e.r,e.y-e.r-9,e.r*2,4);ctx.fillStyle='#ff887c';ctx.fillRect(e.x-e.r,e.y-e.r-9,e.r*2*(e.hp/e.maxHp),4);}
  }
  ctx.fillStyle='#fff1a8';for(const b of bullets)ctx.fillRect(b.x-3,b.y-3,6,6);
  ctx.fillStyle='#ff786f';for(const b of enemyBullets)ctx.fillRect(b.x-3,b.y-3,6,6);
  for(const a of allies)drawUnit(a,false);drawUnit(player,true);
  for(const p of particles){ctx.globalAlpha=Math.max(0,Math.min(1,p.life*2.2));ctx.fillStyle=p.color||'#f0c36d';ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);}ctx.globalAlpha=1;
  ctx.font='bold 12px monospace';ctx.textAlign='center';for(const f of floating){ctx.globalAlpha=Math.min(1,f.life*2);ctx.fillStyle=f.color||'#fff';ctx.fillText(f.text,f.x,f.y);}ctx.globalAlpha=1;
  ctx.restore();
}

function drawMinimap(){
  const w=minimap.width,h=minimap.height;mctx.clearRect(0,0,w,h);mctx.fillStyle='#08120ddd';mctx.fillRect(0,0,w,h);
  const mx=x=>x/W*w,my=y=>y/H*h;
  mctx.strokeStyle='#425a4c';mctx.lineWidth=2;mctx.strokeRect(1,1,w-2,h-2);
  for(const b of enemyBases){mctx.fillStyle=b.alive?(BASE_TYPES[b.type].final?'#ff4f57':'#d66a62'):'#524943';const s=BASE_TYPES[b.type].final?8:6;mctx.fillRect(mx(b.x)-s/2,my(b.y)-s/2,s,s);}
  mctx.fillStyle='#75d8e6';for(const s of exchangeStations){mctx.fillRect(mx(s.x)-2,my(s.y)-2,4,4);}
  mctx.fillStyle=homeUnderAttack>0&&Math.floor(performance.now()/180)%2?'#ff625f':'#ffd36d';mctx.fillRect(mx(home.x)-4,my(home.y)-4,8,8);
  mctx.fillStyle='#9edcf1';for(const a of allies)mctx.fillRect(mx(a.x)-1,my(a.y)-1,3,3);
  mctx.fillStyle='#fff';mctx.beginPath();mctx.arc(mx(player.x),my(player.y),3.5,0,Math.PI*2);mctx.fill();
  mctx.fillStyle='#e27469';for(const e of enemies){if(dist(player,e)<700||e.objective==='home')mctx.fillRect(mx(e.x),my(e.y),2,2);}
}

function updateHud(){
  $('#hpBar').style.width=`${clamp(player.hp/player.maxHp*100,0,100)}%`;$('#hpText').textContent=`${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}`;
  $('#baseBar').style.width=`${clamp(home.hp/home.maxHp*100,0,100)}%`;$('#baseText').textContent=`${Math.ceil(home.hp)}/${Math.ceil(home.maxHp)}`;
  $('#threatBar').style.width=`${threat}%`;$('#threatText').textContent=`${Math.round(threat)}%`;
  $('#karmaText').textContent=runKarma;$('#creditText').textContent=credits;$('#squadText').textContent=`${squadCount()}/${MAX_SQUAD}`;$('#baseCountText').textContent=`${destroyedBases}/${enemyBases.length}`;
  const remain=Math.max(0,GAME_LENGTH-gameTime),m=Math.floor(remain/60),s=Math.floor(remain%60);$('#timerText').textContent=finalDestroyed?`HOLD ${Math.ceil(finalHold)}`:`${m}:${String(s).padStart(2,'0')}`;
  const cmd=enemyBases.find(b=>b.type==='command');$('#missionText').textContent=finalDestroyed?'역습을 버텨라':`지휘기지 HP ${Math.ceil(cmd.hp/cmd.maxHp*100)}% · 거점 ${destroyedBases}/${enemyBases.length}`;
  $('#stimCd').textContent=stimRemaining>0?`ACTIVE ${stimRemaining.toFixed(1)}`:(stimCooldown<=0?`${keyLabel(meta.settings.stimKey)} · READY`:`${stimCooldown.toFixed(1)}s`);
  $('#stimBtn').classList.toggle('cooldown',stimCooldown>0&&stimRemaining<=0);$('#stimBtn').classList.toggle('active',stimRemaining>0);
  const level=threat<30?'LOW':threat<60?'MID':threat<85?'HIGH':'MAX';$('#threatLabel').textContent=level;$('#threatLabel').dataset.level=level;
  const station=nearbyExchange();$('#exchangeBtn').classList.toggle('hidden',!(station&&runKarma>0));if(station&&runKarma>0)$('#exchangeBtn').querySelector('span').textContent=`카르마 ${runKarma} 교환`;
  const alarm=homeUnderAttack>0;$('#baseAlarm').classList.toggle('hidden',!alarm);
  const far=dist(player,home)>300;$('#baseArrow').classList.toggle('hidden',!(alarm&&far));
  if(alarm&&far){const a=Math.atan2(home.y-player.y,home.x-player.x)*180/Math.PI+90;$('#baseArrow').style.transform=`translate(-50%,-50%) rotate(${a}deg)`;}
}

function endRun(win,reason){
  if(ended)return;ended=true;paused=true;sfx(win?'win':'lose');
  const bankedBonus=Math.floor(credits*.03);
  const earnedScrap=runSalvage + bankedBonus + (win?100:0);
  const earnedXp=Math.floor(kills*.55 + destroyedBases*42 + gameTime*.11 + (win?150:0));
  meta.scrap+=earnedScrap;meta.accountXp+=earnedXp;meta.runs++;meta.bestTime=Math.max(meta.bestTime,Math.floor(gameTime));saveMeta(meta);
  $('#endTitle').textContent=win?'작전 성공':'작전 실패';$('#endReason').textContent=reason;
  $('#endRewards').innerHTML=`
    <div class="reward"><span>회수 고철</span><b>+${earnedScrap}</b></div>
    <div class="reward"><span>계정 XP</span><b>+${earnedXp}</b></div>
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

// Settings
$('#settingsBtn').addEventListener('click',openSettings);
$('#closeSettingsBtn').addEventListener('click',closeSettings);
$('#stimKeyBtn').addEventListener('click',()=>{captureStimKey=true;$('#keyCaptureHint').classList.remove('hidden');$('#stimKeyBtn').textContent='...';});
$('#resetStimKeyBtn').addEventListener('click',()=>{meta.settings.stimKey='KeyR';saveMeta(meta);$('#stimKeyBtn').textContent='R';event('스팀팩 단축키를 R로 초기화했습니다.',1.5);});
$('#soundBtn').addEventListener('click',()=>{soundOn=!soundOn;meta.settings.sound=soundOn;saveMeta(meta);$('#soundBtn').textContent=soundOn?'🔊':'🔇';if(soundOn){ensureAudio();sfx('upgrade');}});
$('#soundBtn').textContent=soundOn?'🔊':'🔇';

window.addEventListener('keydown',e=>{
  ensureAudio();
  if(captureStimKey){
    e.preventDefault();
    if(e.code==='Escape'){captureStimKey=false;$('#keyCaptureHint').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);return;}
    if(!validStimKey(e.code)){ $('#keyCaptureHint').textContent='이동·교환·메뉴 키와 겹칩니다. 다른 키를 눌러주세요.'; return; }
    meta.settings.stimKey=e.code;saveMeta(meta);captureStimKey=false;$('#stimKeyBtn').textContent=keyLabel(e.code);$('#keyCaptureHint').classList.add('hidden');return;
  }
  keys[e.code]=true;
  if(e.code===meta.settings.stimKey){e.preventDefault();useStim();}
  if(e.code==='KeyE'){e.preventDefault();exchangeKarma();}
  if(e.code==='KeyU'){e.preventDefault();$('#battleMenu').classList.contains('hidden')?openBattleMenu('upgrade'):closeBattleMenu();}
  if(e.code==='Escape'){
    if(!$('#settingsOverlay').classList.contains('hidden'))closeSettings();
    else if(!$('#battleMenu').classList.contains('hidden'))closeBattleMenu();
  }
});
window.addEventListener('keyup',e=>keys[e.code]=false);
window.addEventListener('pointerdown',ensureAudio,{passive:true});
canvas.addEventListener('dblclick',()=>openBattleMenu('upgrade'));
canvas.addEventListener('pointerup',e=>{
  if(e.pointerType!=='touch')return;
  const now=performance.now();if(now-lastTouchTap<330)openBattleMenu('upgrade');lastTouchTap=now;
});

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
}

// Kick-start nearby enemies only when the player chooses a direction. No random map-wide waves.
event(`WASD 이동 · 자동사격 · ${keyLabel(meta.settings.stimKey)} 스팀팩 · E 카르마 교환 · U 강화/상점`,5);
