import { BUILDINGS, STORIES, loadMeta, saveMeta, accountLevelFromXp, pendingEnergy, collectEnergy, getSynergies, buildingIndex } from './storage.js';

const meta = loadMeta();
let selectedCell = null;
let moveMode = false;
let moveFrom = null;

const $ = s => document.querySelector(s);
const grid = $('#baseGrid');

function render(){
  const lvl=accountLevelFromXp(meta.accountXp);
  $('#accountStats').innerHTML = `
    <div class="stat-chip"><span>계정 레벨</span><b>LV.${lvl.level}</b></div>
    <div class="stat-chip"><span>고철</span><b>${meta.scrap}</b></div>
    <div class="stat-chip"><span>에너지</span><b>${meta.energy}</b></div>
    <div class="stat-chip"><span>출격</span><b>${meta.runs}회</b></div>`;

  grid.innerHTML='';
  meta.grid.forEach((b,i)=>{
    const cell=document.createElement('button');
    cell.className='base-cell'+(b?.type==='hq'?' hq':'');
    cell.dataset.index=i;
    if(b){
      const def=BUILDINGS[b.type];
      cell.innerHTML=`<div class="building type-${b.type}"><span class="building-level">LV.${b.level}</span><div class="building-shape"></div><span class="building-name">${def.name}</span></div>`;
    } else cell.innerHTML='<span class="muted">EMPTY</span>';
    cell.addEventListener('click',()=>onCell(i));
    grid.appendChild(cell);
  });

  renderBuildPanel();
  renderProduction();
  renderTraining();
  renderSynergy();
  renderStory();
}

function renderProduction(){
  const plant=meta.grid.find(b=>b?.type==='power');
  const pending=pendingEnergy(meta);
  const rate=plant ? plant.level : 0;
  const cap=plant ? 120+(plant.level-1)*60 : 0;
  $('#productionInfo').innerHTML = plant ? `
    <div class="prod-row"><span>생산 속도</span><b>${rate}/분</b></div>
    <div class="prod-row"><span>미수령</span><b>+${pending}</b></div>
    <div class="prod-row"><span>저장 한도</span><b>${cap}</b></div>` : `<p class="muted">발전소를 건설하면 접속하지 않은 동안에도 에너지가 생산됩니다.</p>`;
  const btn=$('#collectEnergyBtn'); btn.disabled=pending<=0; btn.textContent=pending>0?`에너지 +${pending} 수집`:'수집할 에너지 없음';
}


function renderTraining(){
  const defs=[
    ['damage','탄도 연구','출격 공격력 +2% / LV'],
    ['hp','생존 장비','출격 최대 체력 +3 / LV'],
    ['salvage','회수 기술','출격 고철 보상 +1.5% / LV']
  ];
  const holder=$('#trainingOptions'); holder.innerHTML='';
  for(const [id,name,desc] of defs){
    const lv=meta.training?.[id]||0;
    const cost=20+lv*15;
    const row=document.createElement('div'); row.className='build-option';
    row.innerHTML=`<div><strong>${name} LV.${lv}</strong><small>${desc}</small></div><button class="btn small" ${lv>=5||meta.energy<cost?'disabled':''}>${lv>=5?'MAX':`${cost} E`}</button>`;
    row.querySelector('button').addEventListener('click',()=>{
      if(lv>=5||meta.energy<cost)return;
      meta.energy-=cost; meta.training[id]=lv+1; saveMeta(meta); render();
    });
    holder.appendChild(row);
  }
}

function renderSynergy(){
  const list=getSynergies(meta);
  $('#synergyBox').innerHTML = list.map(s=>`<span class="synergy-pill ${s.active?'active':''}" title="${s.desc}">${s.active?'◆':'◇'} ${s.name} · ${s.desc}</span>`).join('');
}

function renderBuildPanel(){
  const holder=$('#buildOptions'); holder.innerHTML='';
  const b=selectedCell!==null?meta.grid[selectedCell]:null;

  if(moveMode){
    $('#buildTitle').textContent='시설 이동';
    holder.innerHTML=`<p class="muted">${moveFrom===null?'옮길 시설을 먼저 선택하세요.':'이동할 빈 칸을 선택하세요.'}</p>`;
    return;
  }

  if(selectedCell===null){
    $('#buildTitle').textContent='시설 건설';
    holder.innerHTML='<p class="muted">기지의 빈 칸이나 시설을 선택하세요.</p>';
    return;
  }

  if(b){
    const def=BUILDINGS[b.type]; $('#buildTitle').textContent=def.name;
    if(b.type==='hq') { holder.innerHTML='<p class="muted">지휘소는 이동하거나 업그레이드할 수 없습니다. 주변 시설 배치에 따라 연결 효과가 생깁니다.</p>'; return; }
    const next=Math.min(3,b.level+1), cost=Math.floor(def.cost*(.85+b.level*.65));
    holder.innerHTML=`<div class="build-option"><div><strong>${def.name} LV.${b.level}</strong><small>${def.desc}</small></div><button class="btn small" id="upgradeBtn" ${b.level>=3||meta.scrap<cost?'disabled':''}>${b.level>=3?'MAX':`${cost} 고철`}</button></div>`;
    $('#upgradeBtn')?.addEventListener('click',()=>upgrade(selectedCell,cost));
    return;
  }

  $('#buildTitle').textContent='시설 건설';
  Object.entries(BUILDINGS).filter(([k])=>k!=='hq').forEach(([type,def])=>{
    const exists=buildingIndex(meta,type)>=0;
    const row=document.createElement('div'); row.className='build-option';
    row.innerHTML=`<div><strong>${def.name}</strong><small>${def.desc}</small></div><button class="btn small" ${exists||meta.scrap<def.cost?'disabled':''}>${exists?'건설됨':`${def.cost}`}</button>`;
    row.querySelector('button').addEventListener('click',()=>build(selectedCell,type));
    holder.appendChild(row);
  });
}

function build(index,type){
  const def=BUILDINGS[type];
  if(meta.grid[index]||buildingIndex(meta,type)>=0||meta.scrap<def.cost) return;
  meta.scrap-=def.cost; meta.grid[index]={type,level:1};
  if(!meta.unlockedStories.includes(type)) meta.unlockedStories.push(type);
  if(type==='power') meta.lastEnergyTick=Date.now();
  saveMeta(meta); selectedCell=index; render();
}
function upgrade(index,cost){
  const b=meta.grid[index]; if(!b||b.type==='hq'||b.level>=3||meta.scrap<cost) return;
  if(b.type==='power') collectEnergy(meta);
  meta.scrap-=cost; b.level++; if(b.type==='power') meta.lastEnergyTick=Date.now(); saveMeta(meta); render();
}

function onCell(i){
  if(moveMode){
    const b=meta.grid[i];
    if(moveFrom===null){ if(b&&b.type!=='hq'){ moveFrom=i; renderBuildPanel(); }}
    else if(!b){ meta.grid[i]=meta.grid[moveFrom]; meta.grid[moveFrom]=null; selectedCell=i; moveFrom=null; saveMeta(meta); render(); }
    else if(i===moveFrom){moveFrom=null;renderBuildPanel();}
    return;
  }
  selectedCell=i; renderBuildPanel();
}

function renderStory(){
  $('#storyProgress').textContent=`복구 기록 ${meta.unlockedStories.length}/${Object.keys(STORIES).length} · 시설을 건설하면 새로운 기록이 열립니다.`;
  $('#storyList').innerHTML=Object.entries(STORIES).map(([id,s])=>{
    const open=meta.unlockedStories.includes(id); return `<article class="story-entry ${open?'':'locked'}"><h3>${open?s.title:'잠긴 기록'}</h3><p>${open?s.text:'시설 복구를 통해 기록을 해제하세요.'}</p></article>`;
  }).join('');
}

$('#collectEnergyBtn').addEventListener('click',()=>{collectEnergy(meta);render();});
$('#moveModeBtn').addEventListener('click',()=>{moveMode=!moveMode;moveFrom=null;selectedCell=null;$('#moveModeBtn').textContent=moveMode?'배치 완료':'배치 변경';renderBuildPanel();});
$('#storyBtn').addEventListener('click',()=>$('#storyDialog').showModal());
$('#closeStoryBtn').addEventListener('click',()=>$('#storyDialog').close());

render();
setInterval(renderProduction,15000);
