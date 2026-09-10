import { loadMeta, saveMeta, getRunPerks } from './storage.js';

const canvas=document.querySelector('#gameCanvas'), ctx=canvas.getContext('2d');
ctx.imageSmoothingEnabled=false;
const $=s=>document.querySelector(s);
const meta=loadMeta(), metaPerks=getRunPerks(meta);
const params=new URLSearchParams(location.search), DEBUG=params.has('debug');
if(DEBUG) $('#debugPanel').classList.remove('hidden');

const W=3200,H=1800, GAME_LENGTH=12*60;
let gameTime=0,last=performance.now(), paused=false, ended=false, wave=1, spawnClock=0, bannerTimer=0;
let enemies=[], bullets=[], particles=[], orbs=[], caches=[], floating=[], drones=[];
let kills=0, runScrap=0, level=1, xp=0, xpNeed=28, rerolls=metaPerks.reroll||0;
let soundOn=meta.settings.sound!==false, audioCtx=null;
let keys={};
const cam={x:W/2,y:H/2};

const base={x:W/2,y:H/2,r:88,hp:1000,maxHp:1000};
const player={x:W/2+180,y:H/2,r:17,hp:100+metaPerks.maxHp,maxHp:100+metaPerks.maxHp,speed:205,damage:18*(1+metaPerks.damage),fireDelay:.42/(1+metaPerks.fireRate),fireClock:0,shots:1,pierce:0,crit:.05,bulletSpeed:600,pulseCd:0,dashCd:0,dashing:0, invuln:0};
const upgradeState={ drone:0, spread:0 };

const cacheSpots=[[-650,-350],[680,-320],[-720,390],[720,410],[0,-650],[0,650]].map((p,i)=>({id:i,x:W/2+p[0],y:H/2+p[1],claimed:false,progress:0}));
caches=cacheSpots;

function rand(a,b){return a+Math.random()*(b-a)}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function beep(type='shot'){
  if(!soundOn) return; try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.connect(g);g.connect(audioCtx.destination);
    const now=audioCtx.currentTime;
    const map={shot:[180,.035,.025],hit:[95,.04,.02],level:[620,.13,.05],pulse:[70,.25,.07],boss:[45,.45,.08],cache:[760,.18,.05]};
    const [f,d,v]=map[type]||map.shot; o.type=type==='shot'?'square':'sawtooth';o.frequency.setValueAtTime(f,now); if(type==='pulse')o.frequency.exponentialRampToValueAtTime(240,now+d);
    g.gain.setValueAtTime(v,now);g.gain.exponentialRampToValueAtTime(.0001,now+d);o.start();o.stop(now+d);
  }catch{}
}

function event(text,duration=2){$('#eventBanner').textContent=text;$('#eventBanner').classList.add('show');bannerTimer=duration;}

function spawnEnemy(kind=null){
  const angle=Math.random()*Math.PI*2, rad=rand(650,900), x=clamp(base.x+Math.cos(angle)*rad,50,W-50), y=clamp(base.y+Math.sin(angle)*rad,50,H-50);
  const t=kind||((gameTime>360&&Math.random()<.15)?'brute':gameTime>180&&Math.random()<.20?'runner':'crawler');
  const spec={crawler:{hp:34,speed:62,r:15,dmg:12,value:2,xp:5},runner:{hp:22,speed:105,r:12,dmg:9,value:2,xp:5},brute:{hp:115,speed:44,r:24,dmg:22,value:5,xp:12},boss:{hp:2400+gameTime*2,speed:34,r:52,dmg:35,value:75,xp:180}}[t];
  enemies.push({x,y,type:t,hp:spec.hp*(1+gameTime/900),maxHp:spec.hp*(1+gameTime/900),speed:spec.speed,r:spec.r,dmg:spec.dmg,value:spec.value,xp:spec.xp,hit:0,attack:0});
}
function spawnBoss(){spawnEnemy('boss');event('경고: 거대 변이체 접근 중',3.5);beep('boss');}

function autoFire(dt){
  player.fireClock-=dt;if(player.fireClock>0)return;
  let target=null,best=760;
  for(const e of enemies){const d=dist(player,e);if(d<best){best=d;target=e}}
  if(!target)return;player.fireClock=player.fireDelay;
  const baseAng=Math.atan2(target.y-player.y,target.x-player.x);
  for(let i=0;i<player.shots;i++){
    const spread=(i-(player.shots-1)/2)*.13;
    const a=baseAng+spread;
    bullets.push({x:player.x,y:player.y,vx:Math.cos(a)*player.bulletSpeed,vy:Math.sin(a)*player.bulletSpeed,r:4,life:1.45,damage:player.damage,pierce:player.pierce,hit:new Set()});
  }
  beep('shot');
}

function updatePlayer(dt){
  let dx=0,dy=0;
  if(keys.KeyW||keys.ArrowUp)dy--; if(keys.KeyS||keys.ArrowDown)dy++; if(keys.KeyA||keys.ArrowLeft)dx--; if(keys.KeyD||keys.ArrowRight)dx++;
  dx+=joy.x;dy+=joy.y;
  const len=Math.hypot(dx,dy)||1, speed=player.speed*(player.dashing>0?2.7:1);
  if(Math.hypot(dx,dy)>.1){player.x+=dx/len*speed*dt;player.y+=dy/len*speed*dt}
  player.x=clamp(player.x,25,W-25);player.y=clamp(player.y,25,H-25);
  player.pulseCd=Math.max(0,player.pulseCd-dt);player.dashCd=Math.max(0,player.dashCd-dt);player.dashing=Math.max(0,player.dashing-dt);player.invuln=Math.max(0,player.invuln-dt);
  autoFire(dt);
}

function updateEnemies(dt){
  for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];e.hit=Math.max(0,e.hit-dt);e.attack=Math.max(0,e.attack-dt);
    const dp=dist(e,player), db=dist(e,base); const target=(dp<240||db>dp*1.25)?player:base;
    const d=dist(e,target)||1;e.x+=(target.x-e.x)/d*e.speed*dt;e.y+=(target.y-e.y)/d*e.speed*dt;
    if(d<e.r+target.r+3&&e.attack<=0){e.attack=e.type==='boss'?.75:1.0;
      if(target===player&&player.invuln<=0){player.hp-=e.dmg;player.invuln=.32;floating.push({x:player.x,y:player.y-24,text:`-${e.dmg}`,life:.7});beep('hit'); if(player.hp<=0) endRun(false,'전투원이 쓰러졌습니다.');}
      else if(target===base){base.hp-=e.dmg;floating.push({x:base.x,y:base.y-85,text:`-${e.dmg}`,life:.7}); if(base.hp<=0) endRun(false,'전초기지가 파괴되었습니다.');}
    }
  }
}

function updateBullets(dt){
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life<=0){bullets.splice(i,1);continue}
    for(const e of enemies){if(b.hit.has(e))continue;if(Math.hypot(b.x-e.x,b.y-e.y)<b.r+e.r){b.hit.add(e);let dmg=b.damage*(Math.random()<player.crit?2:1);e.hp-=dmg;e.hit=.1;floating.push({x:e.x,y:e.y-20,text:Math.round(dmg),life:.45});
      if(e.hp<=0) killEnemy(e); if(b.pierce>0)b.pierce--;else{b.life=0;break}
    }}
  }
}
function killEnemy(e){const idx=enemies.indexOf(e);if(idx>=0)enemies.splice(idx,1);kills++;runScrap+=e.value;orbs.push({x:e.x,y:e.y,xp:e.xp,r:e.type==='boss'?9:5});for(let n=0;n<5;n++)particles.push({x:e.x,y:e.y,vx:rand(-90,90),vy:rand(-90,90),life:rand(.2,.6)});}
function updateOrbs(dt){
  for(let i=orbs.length-1;i>=0;i--){const o=orbs[i],d=dist(o,player);if(d<155){o.x+=(player.x-o.x)*dt*7;o.y+=(player.y-o.y)*dt*7}if(d<24){gainXp(o.xp);orbs.splice(i,1)}}
}
function gainXp(v){xp+=v;while(xp>=xpNeed){xp-=xpNeed;level++;xpNeed=Math.floor(xpNeed*1.22+8);openLevelUp();break}}

const UPGRADES={
  damage:{name:'강화 탄두',desc:'탄환 피해량 +25%',tag:'공격',apply:()=>player.damage*=1.25},
  rapid:{name:'급속 장전',desc:'공격 주기 18% 감소',tag:'공격',apply:()=>player.fireDelay*=.82},
  multi:{name:'다중 사격',desc:'동시에 발사하는 탄환 +1',tag:'무기',apply:()=>player.shots=Math.min(5,player.shots+1)},
  pierce:{name:'관통탄',desc:'탄환 관통 +1',tag:'무기',apply:()=>player.pierce=Math.min(4,player.pierce+1)},
  crit:{name:'정밀 조준',desc:'치명타 확률 +10%',tag:'공격',apply:()=>player.crit=Math.min(.55,player.crit+.10)},
  speed:{name:'경량 장비',desc:'이동속도 +12%',tag:'생존',apply:()=>player.speed*=1.12},
  hp:{name:'응급 장갑',desc:'최대 체력 +20, 즉시 20 회복',tag:'생존',apply:()=>{player.maxHp+=20;player.hp=Math.min(player.maxHp,player.hp+20)}},
  base:{name:'기지 보강',desc:'기지 최대 체력 +120, 즉시 120 수리',tag:'기지',apply:()=>{base.maxHp+=120;base.hp=Math.min(base.maxHp,base.hp+120)}},
  pulse:{name:'펄스 증폭',desc:'펄스 재사용 대기시간 감소',tag:'스킬',apply:()=>player.pulseBase=Math.max(5,(player.pulseBase||10)-1)},
  drone:{name:'공격 드론',desc:'주변 적을 자동 공격하는 드론 추가',tag:'연구소',req:()=>metaPerks.unlockDrone,apply:()=>{upgradeState.drone++;addDrone()}},
  spread:{name:'산탄 개조',desc:'탄환 +2, 피해량 -12%',tag:'무기고',req:()=>metaPerks.unlockSpread&&upgradeState.spread<1,apply:()=>{player.shots+=2;player.damage*=.88;upgradeState.spread++}}
};

function openLevelUp(){paused=true;beep('level');const allowed=Object.entries(UPGRADES).filter(([k,u])=>!u.req||u.req());const picks=[];while(picks.length<3&&allowed.length){const i=Math.floor(Math.random()*allowed.length);picks.push(allowed.splice(i,1)[0]);}
  const holder=$('#upgradeChoices');holder.innerHTML='';for(const [id,u] of picks){const b=document.createElement('button');b.className='upgrade-card';b.innerHTML=`<b>${u.name}</b><p>${u.desc}</p><span class="tag">${u.tag}</span>`;b.onclick=()=>{u.apply();$('#levelUp').classList.add('hidden');paused=false};holder.appendChild(b)}
  $('#rerollInfo').textContent=rerolls?`기지 연결 효과: 선택지 재배치 ${rerolls}회 남음`:''; $('#rerollBtn').classList.toggle('hidden',rerolls<=0); $('#levelUp').classList.remove('hidden');
}
$('#rerollBtn').onclick=()=>{if(rerolls>0){rerolls--;$('#levelUp').classList.add('hidden');paused=false;openLevelUp();}};

function addDrone(){const a=Math.random()*Math.PI*2;drones.push({angle:a,fire:0})}
function updateDrones(dt){for(const d of drones){d.angle+=dt*1.7;d.fire-=dt;const x=player.x+Math.cos(d.angle)*45,y=player.y+Math.sin(d.angle)*45;if(d.fire<=0){let t=null,best=420;for(const e of enemies){const dd=Math.hypot(x-e.x,y-e.y);if(dd<best){best=dd;t=e}}if(t){d.fire=.7;const a=Math.atan2(t.y-y,t.x-x);bullets.push({x,y,vx:Math.cos(a)*520,vy:Math.sin(a)*520,r:3,life:1,damage:player.damage*.55,pierce:0,hit:new Set()})}}}}

function pulse(){if(paused||ended||player.pulseCd>0)return;player.pulseCd=player.pulseBase||10;beep('pulse');for(const e of enemies){const d=dist(player,e);if(d<210){e.hp-=70+level*4;e.x+=(e.x-player.x)/Math.max(d,1)*55;e.y+=(e.y-player.y)/Math.max(d,1)*55;if(e.hp<=0)killEnemy(e)}}for(let i=0;i<40;i++){const a=Math.random()*Math.PI*2;particles.push({x:player.x,y:player.y,vx:Math.cos(a)*rand(90,250),vy:Math.sin(a)*rand(90,250),life:.55,pulse:true})}}
function dash(){if(paused||ended||player.dashCd>0)return;player.dashCd=3.2;player.dashing=.28;player.invuln=.34;}
$('#pulseBtn').onclick=pulse;$('#dashBtn').onclick=dash;

function updateCaches(dt){for(const c of caches){if(c.claimed)continue;const d=dist(c,player);if(d<48)c.progress+=dt;else c.progress=Math.max(0,c.progress-dt*.7);if(c.progress>=2.5){c.claimed=true;runScrap+=25;gainXp(18);event('보급 상자 회수 +25 고철',2);beep('cache')}}}

function updateSpawner(dt){spawnClock-=dt;const interval=Math.max(.22,1.15-gameTime*.00115);if(spawnClock<=0){spawnClock=interval;const count=1+(gameTime>420&&Math.random()<.22?1:0);for(let i=0;i<count;i++)spawnEnemy()}
  const newWave=Math.floor(gameTime/90)+1;if(newWave!==wave){wave=newWave;event(`웨이브 ${wave} — 적 밀도가 증가합니다`,2.5)}
  if(!updateSpawner.mid&&gameTime>=360){updateSpawner.mid=true;spawnBoss()}
  if(!updateSpawner.final&&gameTime>=GAME_LENGTH-8){updateSpawner.final=true;for(let i=0;i<2;i++)spawnBoss();event('최종 공세 시작',3)}
}

function endRun(win,reason){if(ended)return;ended=true;paused=true;const survival=Math.floor(gameTime);const scrapBonus=Math.floor(runScrap*metaPerks.scrap);const earnedScrap=runScrap+scrapBonus+(win?120:0);const earnedXp=Math.floor(survival*.35+kills*.6+(win?180:0));meta.scrap+=earnedScrap;meta.accountXp+=earnedXp;meta.runs++;meta.bestTime=Math.max(meta.bestTime,survival);saveMeta(meta);
  $('#endTitle').textContent=win?'작전 성공':'작전 실패';$('#endReason').textContent=reason;$('#endRewards').innerHTML=`<div class="reward"><span>고철</span><b>+${earnedScrap}</b></div><div class="reward"><span>계정 XP</span><b>+${earnedXp}</b></div><div class="reward"><span>처치</span><b>${kills}</b></div>`;$('#endScreen').classList.remove('hidden');
}

function update(dt){if(paused||ended)return;gameTime+=dt;if(gameTime>=GAME_LENGTH){endRun(true,'12분 동안 기지를 지켜냈습니다.');return}
  updatePlayer(dt);updateEnemies(dt);updateBullets(dt);updateOrbs(dt);updateDrones(dt);updateCaches(dt);updateSpawner(dt);
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;if(p.life<=0)particles.splice(i,1)}
  for(let i=floating.length-1;i>=0;i--){floating[i].y-=25*dt;floating[i].life-=dt;if(floating[i].life<=0)floating.splice(i,1)}
  if(bannerTimer>0){bannerTimer-=dt;if(bannerTimer<=0)$('#eventBanner').classList.remove('show')}
  cam.x+=(player.x-cam.x)*Math.min(1,dt*4.5);cam.y+=(player.y-cam.y)*Math.min(1,dt*4.5);
}

function draw(){
  const sx=canvas.width/960, sy=canvas.height/540; ctx.setTransform(sx,0,0,sy,0,0);ctx.clearRect(0,0,960,540);
  const ox=480-cam.x, oy=270-cam.y;ctx.save();ctx.translate(ox,oy);
  // ground
  ctx.fillStyle='#29462f';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#31523a';ctx.lineWidth=1;for(let x=0;x<W;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}for(let y=0;y<H;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
  // ruins decor deterministic-ish
  ctx.fillStyle='#355b3d';for(let x=80;x<W;x+=240)for(let y=80;y<H;y+=220){if(Math.abs(x-base.x)<260&&Math.abs(y-base.y)<260)continue;ctx.fillRect(x,y,18,10);ctx.fillRect(x+11,y-8,8,8)}
  // caches
  for(const c of caches){if(c.claimed)continue;ctx.fillStyle='#e5b95f';ctx.fillRect(c.x-15,c.y-12,30,24);ctx.fillStyle='#6b552d';ctx.fillRect(c.x-12,c.y-3,24,5);if(c.progress>0){ctx.fillStyle='#0b120e';ctx.fillRect(c.x-20,c.y-25,40,5);ctx.fillStyle='#d9f06a';ctx.fillRect(c.x-20,c.y-25,40*Math.min(1,c.progress/2.5),5)}}
  // base
  ctx.fillStyle='#25392f';ctx.fillRect(base.x-90,base.y-75,180,150);ctx.strokeStyle='#9a8d67';ctx.lineWidth=8;ctx.strokeRect(base.x-90,base.y-75,180,150);ctx.fillStyle='#d3c37c';ctx.fillRect(base.x-42,base.y-36,84,72);ctx.fillStyle='#1b2a22';ctx.fillRect(base.x-18,base.y+4,36,32);ctx.fillStyle='#d9f06a';ctx.fillRect(base.x-4,base.y-56,8,20);
  // orbs
  for(const o of orbs){ctx.fillStyle='#86c7ff';ctx.fillRect(o.x-o.r,o.y-o.r,o.r*2,o.r*2)}
  // drones
  for(const d of drones){const x=player.x+Math.cos(d.angle)*45,y=player.y+Math.sin(d.angle)*45;ctx.fillStyle='#d9f06a';ctx.fillRect(x-6,y-5,12,10);ctx.fillStyle='#16251d';ctx.fillRect(x-2,y-2,4,4)}
  // enemies
  for(const e of enemies){ctx.save();ctx.translate(e.x,e.y);ctx.fillStyle=e.hit>0?'#f2e7d0':e.type==='runner'?'#e1a66e':e.type==='brute'?'#a36e7d':e.type==='boss'?'#d65f62':'#83a66e';ctx.fillRect(-e.r,-e.r,e.r*2,e.r*2);ctx.fillStyle='#152019';ctx.fillRect(-e.r+4,-4,5,5);ctx.fillRect(e.r-9,-4,5,5);if(e.type==='boss'){ctx.strokeStyle='#ffb0a7';ctx.lineWidth=4;ctx.strokeRect(-e.r,-e.r,e.r*2,e.r*2)}ctx.restore();if(e.type==='boss'||e.type==='brute'){ctx.fillStyle='#111';ctx.fillRect(e.x-e.r,e.y-e.r-10,e.r*2,5);ctx.fillStyle='#ff887c';ctx.fillRect(e.x-e.r,e.y-e.r-10,e.r*2*(e.hp/e.maxHp),5)}}
  // bullets
  ctx.fillStyle='#fff1a8';for(const b of bullets)ctx.fillRect(b.x-3,b.y-3,6,6);
  // player
  ctx.save();ctx.translate(player.x,player.y);ctx.fillStyle=player.invuln>0?'#fff':'#9edcf1';ctx.fillRect(-15,-14,30,28);ctx.fillStyle='#26372f';ctx.fillRect(-10,-7,7,7);ctx.fillRect(3,-7,7,7);ctx.fillStyle='#d9f06a';ctx.fillRect(-5,8,10,10);ctx.restore();
  // particles
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle=p.pulse?'#9edcf1':'#f0c36d';ctx.fillRect(p.x-2,p.y-2,4,4)}ctx.globalAlpha=1;
  // floating numbers
  ctx.font='bold 12px monospace';ctx.textAlign='center';for(const f of floating){ctx.globalAlpha=Math.min(1,f.life*2);ctx.fillStyle='#fff';ctx.fillText(f.text,f.x,f.y)}ctx.globalAlpha=1;
  ctx.restore();
  drawMinimap();
}
function drawMinimap(){const x=825,y=400,w=120,h=120;ctx.fillStyle='#0a120edd';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#526b59';ctx.strokeRect(x,y,w,h);const mx=v=>x+v/W*w,my=v=>y+v/H*h;ctx.fillStyle='#ffd36d';ctx.fillRect(mx(base.x)-2,my(base.y)-2,4,4);ctx.fillStyle='#9edcf1';ctx.fillRect(mx(player.x)-2,my(player.y)-2,4,4);ctx.fillStyle='#e5b95f';for(const c of caches)if(!c.claimed)ctx.fillRect(mx(c.x)-1,my(c.y)-1,3,3);}

function hud(){
  $('#hpBar').style.width=`${clamp(player.hp/player.maxHp*100,0,100)}%`;$('#hpText').textContent=`${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}`;
  $('#baseBar').style.width=`${clamp(base.hp/base.maxHp*100,0,100)}%`;$('#baseText').textContent=`${Math.ceil(base.hp)}/${Math.ceil(base.maxHp)}`;
  $('#xpBar').style.width=`${xp/xpNeed*100}%`;$('#xpText').textContent=`Lv.${level}`;$('#scrapText').textContent=runScrap;$('#killText').textContent=kills;$('#waveText').textContent=`웨이브 ${wave}`;
  const remain=Math.max(0,GAME_LENGTH-gameTime),m=Math.floor(remain/60),s=Math.floor(remain%60);$('#timerText').textContent=`${m}:${String(s).padStart(2,'0')}`;
  $('#pulseCd').textContent=player.pulseCd<=0?'READY':player.pulseCd.toFixed(1);$('#dashCd').textContent=player.dashCd<=0?'READY':player.dashCd.toFixed(1);$('#pulseBtn').classList.toggle('cooldown',player.pulseCd>0);$('#dashBtn').classList.toggle('cooldown',player.dashCd>0);
}
function frame(t){const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);draw();hud();requestAnimationFrame(frame)}requestAnimationFrame(frame);

window.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space'){e.preventDefault();dash()}if(e.code==='KeyE')pulse()});window.addEventListener('keyup',e=>keys[e.code]=false);
$('#soundBtn').onclick=()=>{soundOn=!soundOn;meta.settings.sound=soundOn;saveMeta(meta);$('#soundBtn').textContent=soundOn?'♪':'×'};

const joy={x:0,y:0};const joyBase=$('#joyBase'),knob=$('#joyKnob');let joyId=null;
function setJoy(e){const r=joyBase.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=r.width*.34,len=Math.hypot(dx,dy)||1,scale=Math.min(1,max/len),px=dx*scale,py=dy*scale;joy.x=px/max;joy.y=py/max;knob.style.transform=`translate(${px}px,${py}px)`}
joystickReset();
function joystickReset(){joy.x=joy.y=0;knob.style.transform='translate(0,0)'}
joystickReset();
joyBase.addEventListener('pointerdown',e=>{joyId=e.pointerId;joyBase.setPointerCapture(e.pointerId);setJoy(e)});joyBase.addEventListener('pointermove',e=>{if(e.pointerId===joyId)setJoy(e)});joyBase.addEventListener('pointerup',e=>{if(e.pointerId===joyId){joyId=null;joystickReset()}});joyBase.addEventListener('pointercancel',joystickReset);

if(DEBUG){$('#debugTimeBtn').onclick=()=>gameTime+=60;$('#debugBossBtn').onclick=spawnBoss;$('#debugXpBtn').onclick=()=>gainXp(xpNeed);}

event('WASD/방향키로 이동 · 자동 사격 · E 펄스 · SPACE 대시',4);
