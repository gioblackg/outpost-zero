import { loadMeta, saveMeta, accountLevelFromXp, getRunPerks, loadRun, clearRun } from './storage.js?v=5.0.0';
const $ = s => document.querySelector(s);
const meta = loadMeta();
const lv = accountLevelFromXp(meta.accountXp);
const perks = getRunPerks(meta);
const run = loadRun();

const STAGES = [
  {id:1,name:'초기 격리구역',size:'소형',diff:'보통',desc:'기지에서만 카르마 교환 · 기본 전투'},
  {id:2,name:'폐허 외곽',size:'중소형',diff:'보통+',desc:'넓어진 전장 · 적 거점 4개'},
  {id:3,name:'산업지대',size:'중형',diff:'어려움',desc:'첫 외부 카르마 교환소 등장'},
  {id:4,name:'고지대',size:'대형',diff:'어려움+',desc:'언덕·장애물 증가 · 적 거점 6개'},
  {id:5,name:'봉쇄선',size:'특대형',diff:'위험',desc:'외부 교환소 2개 · 적 거점 7개'}
];

$('#profileLine').innerHTML = `<span>LV.${lv.level}</span><span>클리어 ${meta.completedStages.length}/20</span><span>${meta.stimUnlocked?'STIM 보유':'STIM 미해금'}</span>`;
$('#stageProgress').textContent = `${meta.completedStages.length} / 20`;

$('#stageGrid').innerHTML = STAGES.map(s=>{
  const done=meta.completedStages.includes(s.id), unlocked=s.id<=meta.maxStageUnlocked;
  return `<article class="stage-card ${unlocked?'':'locked'} ${done?'done':''}">
    <div class="stage-no">STAGE ${String(s.id).padStart(2,'0')}</div>
    <h3>${s.name}</h3>
    <div class="stage-tags"><span>맵 ${s.size}</span><span>${s.diff}</span></div>
    <p>${s.desc}</p>
    ${unlocked?`<a class="btn ${s.id===meta.maxStageUnlocked&&!done?'primary':''}" href="/game.html?stage=${s.id}&new=1">${done?'다시 출격':'출격'}</a>`:`<button class="btn" disabled>잠김</button>`}
  </article>`;
}).join('');

if(run){
  $('#resumeCard').classList.remove('hidden');
  const remain=Math.max(0,600-(Number(run.gameTime)||0));
  $('#resumeSummary').textContent=`STAGE ${run.stageId||1} · 남은 ${Math.floor(remain/60)}:${String(Math.floor(remain%60)).padStart(2,'0')} · 카르마 ${run.runKarma||0}`;
}

$('#growthBtn').onclick=()=>{
  $('#growthStats').innerHTML=`
    <article><span>계정 레벨</span><b>LV.${lv.level}</b><small>${lv.current}/${lv.need} XP</small></article>
    <article><span>영구 공격</span><b>+${Math.round(perks.damage*100)}%</b><small>모든 스테이지 적용</small></article>
    <article><span>영구 방어</span><b>+${Math.round(perks.defense*100)}%</b><small>모든 스테이지 적용</small></article>
    <article><span>영구 속도</span><b>+${Math.round(perks.speed*100)}%</b><small>모든 스테이지 적용</small></article>
    <article><span>추가 체력</span><b>+${Math.round(perks.maxHp)}</b><small>모든 스테이지 적용</small></article>
    <article><span>스팀팩</span><b>${meta.stimUnlocked?'영구 해금':'미해금'}</b><small>출격 중 한 번 구매</small></article>`;
  $('#growthDialog').showModal();
};
$('#closeGrowthBtn').onclick=()=>$('#growthDialog').close();
$('#settingsBtn').onclick=()=>$('#settingsDialog').showModal();
$('#closeSettingsBtn').onclick=()=>$('#settingsDialog').close();


function keyLabel(code){ return (code||'KeyR').replace('Key','').replace('Digit',''); }
let capturing=false;
$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);
$('#soundSettingBtn').textContent=meta.settings.sound===false?'꺼짐':'켜짐';
$('#stimKeyBtn').onclick=()=>{capturing=true;$('#keyHint').classList.remove('hidden');$('#stimKeyBtn').textContent='...';};
window.addEventListener('keydown',e=>{
  if(!capturing)return;
  e.preventDefault();
  if(e.code==='Escape'){capturing=false;$('#keyHint').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);return;}
  const blocked=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyE','KeyQ','KeyU','Escape'];
  if(blocked.includes(e.code)){ $('#keyHint').textContent='이동/회복/교환/메뉴 키와 겹칩니다. 다른 키를 눌러주세요.'; return; }
  meta.settings.stimKey=e.code;saveMeta(meta);capturing=false;$('#keyHint').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(e.code);
});
$('#soundSettingBtn').onclick=()=>{meta.settings.sound=meta.settings.sound===false;saveMeta(meta);$('#soundSettingBtn').textContent=meta.settings.sound===false?'꺼짐':'켜짐';};
