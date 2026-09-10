export const BUILDINGS = {
  hq: { name: '지휘소', cost: 0, unique: true, desc: '기지의 중심 시설입니다.' },
  power: { name: '발전소', cost: 150, unique: true, desc: '시간이 지나면 에너지를 생산합니다.' },
  armory: { name: '무기고', cost: 180, unique: true, desc: '분대 화력과 병종 운용을 지원합니다.' },
  lab: { name: '연구소', cost: 220, unique: true, desc: '스팀팩과 전투 기술 연구를 지원합니다.' },
  workshop: { name: '정비소', cost: 180, unique: true, desc: '출격 시 기본 공격력을 높입니다.' },
  greenhouse: { name: '온실', cost: 160, unique: true, desc: '출격 시 최대 체력을 높입니다.' },
  comms: { name: '통신탑', cost: 250, unique: true, desc: '카르마 환전 효율과 외부 기록을 해금합니다.' }
};

const DEFAULT = {
  version: 2,
  scrap: 260,
  energy: 0,
  accountXp: 0,
  runs: 0,
  bestTime: 0,
  lastEnergyTick: Date.now(),
  grid: [null,null,null,null,{type:'hq',level:1},null,null,null,null],
  unlockedStories: ['intro'],
  training: { damage: 0, hp: 0, salvage: 0 },
  settings: { sound: true, stimKey: 'KeyR' }
};

export function loadMeta(){
  let raw;
  try { raw = JSON.parse(localStorage.getItem('outpost-zero-meta') || 'null'); } catch {}
  const data = { ...DEFAULT, ...(raw || {}) };
  data.version = 2;
  data.grid = Array.isArray(data.grid) && data.grid.length===9 ? data.grid : [...DEFAULT.grid];
  data.unlockedStories = Array.isArray(data.unlockedStories) ? data.unlockedStories : ['intro'];
  data.training = { ...DEFAULT.training, ...(data.training || {}) };
  data.settings = { ...DEFAULT.settings, ...(data.settings || {}) };
  if (!/^((Key|Digit)[A-Z0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight)$/.test(data.settings.stimKey || '')) {
    data.settings.stimKey = 'KeyR';
  }
  return data;
}

export function saveMeta(meta){
  localStorage.setItem('outpost-zero-meta', JSON.stringify(meta));
}

export function accountLevelFromXp(xp){
  let level = 1, need = 180;
  let remain = Math.max(0, xp);
  while (remain >= need) { remain -= need; level++; need = Math.floor(need * 1.22); }
  return { level, current: remain, need };
}

export function buildingIndex(meta, type){ return meta.grid.findIndex(b=>b?.type===type); }
export function buildingLevel(meta, type){ const i=buildingIndex(meta,type); return i>=0 ? meta.grid[i].level||1 : 0; }

export function productionRate(meta){
  const lvl = buildingLevel(meta,'power');
  return lvl ? lvl : 0;
}

export function pendingEnergy(meta, now=Date.now()){
  const rate = productionRate(meta);
  if (!rate) return 0;
  const mins = Math.floor(Math.max(0, now - (meta.lastEnergyTick || now)) / 60000);
  const cap = 120 + (buildingLevel(meta,'power')-1)*60;
  return Math.min(cap, mins * rate);
}

export function collectEnergy(meta, now=Date.now()){
  const gain = pendingEnergy(meta, now);
  meta.energy += gain;
  meta.lastEnergyTick = now;
  saveMeta(meta);
  return gain;
}

export function neighbors(index){
  const x=index%3,y=Math.floor(index/3), out=[];
  if(x>0) out.push(index-1); if(x<2) out.push(index+1); if(y>0) out.push(index-3); if(y<2) out.push(index+3);
  return out;
}

export function getSynergies(meta){
  const hasAdj=(a,b)=>{
    const ia=buildingIndex(meta,a); if(ia<0) return false;
    return neighbors(ia).some(i=>meta.grid[i]?.type===b);
  };
  return [
    {id:'power-armory', active:hasAdj('power','armory'), name:'과급 탄약', desc:'분대 공격속도 +10%', perk:{fireRate:.10}},
    {id:'power-lab', active:hasAdj('power','lab'), name:'고효율 연구', desc:'스팀팩 재사용 -8%', perk:{stimCd:.08}},
    {id:'green-hq', active:hasAdj('greenhouse','hq'), name:'생체 보급', desc:'최대 체력 +15', perk:{maxHp:15}},
    {id:'work-armory', active:hasAdj('workshop','armory'), name:'현장 개조', desc:'분대 공격력 +8%', perk:{damage:.08}},
    {id:'comms-hq', active:hasAdj('comms','hq'), name:'회수 지령', desc:'카르마 환전 +5%', perk:{karmaRate:.05}}
  ];
}

export function getRunPerks(meta){
  const perks={ damage:0, fireRate:0, maxHp:0, karmaRate:0, stimCd:0 };
  perks.damage += (meta.training?.damage || 0) * .02;
  perks.maxHp += (meta.training?.hp || 0) * 3;
  perks.karmaRate += (meta.training?.salvage || 0) * .015;
  const work=buildingLevel(meta,'workshop'); if(work) perks.damage += .04*work;
  const green=buildingLevel(meta,'greenhouse'); if(green) perks.maxHp += 5*green;
  const comms=buildingLevel(meta,'comms'); if(comms) perks.karmaRate += .02*comms;
  const lab=buildingLevel(meta,'lab'); if(lab) perks.stimCd += .02*lab;
  for(const s of getSynergies(meta).filter(s=>s.active)) {
    for(const [k,v] of Object.entries(s.perk)) perks[k]=(perks[k]||0)+v;
  }
  return perks;
}

export const STORIES = {
  intro: { title:'기록 00 — 폐허', text:'전초기지 01. 전력 없음. 통신 없음. 생존자 확인 불가. 남아 있는 것은 지휘소와 출격용 장비뿐이다.' },
  power: { title:'기록 01 — 정전', text:'발전소 마지막 로그에는 “외부에서 전력을 끊은 것이 아니다”라는 문장이 반복되어 있다. 사고는 기지 안에서 시작된 듯하다.' },
  armory: { title:'기록 02 — 봉인된 무기고', text:'무기고는 외부 침입이 아니라 내부 봉쇄 명령으로 잠겨 있었다. 누군가는 마지막 순간까지 이 시설을 지키려 했다.' },
  lab: { title:'기록 03 — 연구동', text:'연구소 데이터의 대부분은 지워졌지만, 전투 자극제의 안정화 기록이 남아 있다. 짧은 시간 반응 속도를 극적으로 끌어올리는 기술이었다.' },
  workshop: { title:'기록 04 — 정비반의 메모', text:'벽에 남은 메모: “밖에 나갈수록 강해진다. 하지만 돌아오지 못하면 아무 의미도 없다.”' },
  greenhouse: { title:'기록 05 — 살아 있는 것', text:'온실에는 아직 싹이 남아 있었다. 누군가는 폐쇄 직전까지 식량과 산소 생산을 유지했다.' },
  comms: { title:'기록 06 — 첫 신호', text:'통신탑 복구 직후 짧은 신호가 잡혔다. “전초기지 01, 응답하라. 북쪽의 적 지휘망을 끊어야 한다.”' }
};
