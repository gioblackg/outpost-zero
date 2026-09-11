import { loadMeta, saveMeta, accountLevelFromXp, loadRun } from './storage.js?v=5.3.0';
const $ = s => document.querySelector(s);
const meta = loadMeta();
const lv = accountLevelFromXp(meta.accountXp);
const run = loadRun();
const c = meta.campaign;

const STAGES = [
  {id:1,name:'추락지점',size:'소형',diff:'보통',desc:'추락선에서만 카르마 교환 · 대형 괴수 3체 추적'},
  {id:2,name:'폐허 외곽',size:'중소형',diff:'보통+',desc:'더 넓은 전장 · 거대 괴수와 원거리 적 등장'},
  {id:3,name:'산업지대',size:'중형',diff:'어려움',desc:'첫 외부 카르마 교환소 · 증식거수 등장'},
  {id:4,name:'고지대',size:'대형',diff:'어려움+',desc:'언덕·장애물 증가 · 갑각거수의 강공격'},
  {id:5,name:'봉쇄선',size:'특대형',diff:'위험',desc:'외부 교환소 2개 · 다수의 대형 괴수'}
];

$('#profileLine').innerHTML = `<span>LV.${lv.level}</span><span>클리어 ${meta.completedStages.length}/20</span><span>공격 ${c.attack}</span><span>방어 ${c.defense}</span><span>속도 ${c.speed}</span>`;
$('#stageProgress').textContent = `${meta.completedStages.length} / 20`;
$('#stageGrid').innerHTML = STAGES.map(s=>{
  const done=meta.completedStages.includes(s.id), unlocked=s.id<=meta.maxStageUnlocked;
  return `<article class="stage-card ${unlocked?'':'locked'} ${done?'done':''}">
    <div class="stage-no">STAGE ${String(s.id).padStart(2,'0')}</div><h3>${s.name}</h3>
    <div class="stage-tags"><span>맵 ${s.size}</span><span>${s.diff}</span></div><p>${s.desc}</p>
    ${unlocked?`<a class="btn ${s.id===meta.maxStageUnlocked&&!done?'primary':''}" href="/game.html?stage=${s.id}&new=1">${done?'다시 출격':'출격'}</a>`:`<button class="btn" disabled>잠김</button>`}
  </article>`;
}).join('');
if(run){ $('#resumeCard').classList.remove('hidden'); const remain=Math.max(0,600-(Number(run.gameTime)||0)); $('#resumeSummary').textContent=`STAGE ${run.stageId||1} · 남은 ${Math.floor(remain/60)}:${String(Math.floor(remain%60)).padStart(2,'0')} · 카르마 ${run.runKarma||0}`; }

$('#growthBtn').onclick=()=>{
  $('#growthStats').innerHTML=`
    <article><span>계정 레벨</span><b>LV.${lv.level}</b><small>${lv.current}/${lv.need} XP</small></article>
    <article><span>시즌 공격력</span><b>${c.attack}</b><small>상점에서 +5씩 증가</small></article>
    <article><span>시즌 방어력</span><b>${c.defense}</b><small>적 피해를 정량 감소</small></article>
    <article><span>시즌 속도</span><b>${c.speed}</b><small>상점에서 +10씩 증가</small></article>
    <article><span>보유 골드</span><b>${c.credits}</b><small>스테이지 클리어 시 다음 단계로 계승</small></article>
    <article><span>스팀팩</span><b>${meta.stimUnlocked?'영구 해금':'미해금'}</b><small>HP 10을 소비해 10초 강화</small></article>`;
  $('#growthDialog').showModal();
};
$('#closeGrowthBtn').onclick=()=>$('#growthDialog').close();
$('#settingsBtn').onclick=()=>$('#settingsDialog').showModal();
$('#closeSettingsBtn').onclick=()=>$('#settingsDialog').close();
function keyLabel(code){ return (code||'KeyR').replace('Key','').replace('Digit',''); }
let capturing=false;
$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey); $('#soundSettingBtn').textContent=meta.settings.sound===false?'꺼짐':'켜짐';
$('#stimKeyBtn').onclick=()=>{capturing=true;$('#keyHint').classList.remove('hidden');$('#stimKeyBtn').textContent='...';};
window.addEventListener('keydown',e=>{ if(!capturing)return; e.preventDefault(); if(e.code==='Escape'){capturing=false;$('#keyHint').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(meta.settings.stimKey);return;} const blocked=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyE','KeyQ','KeyU','Escape']; if(blocked.includes(e.code)){ $('#keyHint').textContent='이동/회복/교환/메뉴 키와 겹칩니다. 다른 키를 눌러주세요.'; return; } meta.settings.stimKey=e.code;saveMeta(meta);capturing=false;$('#keyHint').classList.add('hidden');$('#stimKeyBtn').textContent=keyLabel(e.code); });
$('#soundSettingBtn').onclick=()=>{meta.settings.sound=meta.settings.sound===false;saveMeta(meta);$('#soundSettingBtn').textContent=meta.settings.sound===false?'꺼짐':'켜짐';};
