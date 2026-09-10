import { loadMeta, accountLevelFromXp, getRunPerks, chapterProgress } from './storage.js?v=3.0.0';

const $ = s => document.querySelector(s);
const meta = loadMeta();
const lv = accountLevelFromXp(meta.accountXp);
const perks = getRunPerks(meta);
const progress = chapterProgress(meta);

$('#compactProfile').innerHTML = `
  <span>LV.${lv.level}</span>
  <span>출격 ${meta.runs}</span>
  <span>승리 ${meta.wins}</span>
  <span>${meta.stimUnlocked ? 'STIM 해금' : 'STIM 미해금'}</span>`;

$('#chapterProgressBar').style.width = `${progress.percent}%`;
$('#chapterProgressText').textContent = `${progress.percent}%`;
$('#chapterStatus').textContent = progress.complete ? '시즌 1 완료' : `LV.${lv.level} · 승리 ${meta.wins}회`;

function renderGrowth(){
  $('#growthStats').innerHTML = `
    <article><span>계정 레벨</span><b>LV.${lv.level}</b><small>다음 레벨 ${lv.current}/${lv.need} XP</small></article>
    <article><span>기본 공격 보너스</span><b>+${Math.round(perks.damage*100)}%</b><small>모든 출격에 적용</small></article>
    <article><span>기본 방어 보너스</span><b>+${Math.round(perks.defense*100)}%</b><small>받는 피해 감소</small></article>
    <article><span>기본 속도 보너스</span><b>+${Math.round(perks.speed*100)}%</b><small>이동속도 상승</small></article>
    <article><span>추가 체력</span><b>+${Math.round(perks.maxHp)}</b><small>모든 출격에 적용</small></article>
    <article><span>스팀팩</span><b>${meta.stimUnlocked ? '영구 해금' : '미해금'}</b><small>출격 상점에서 1회 구매</small></article>`;
}

$('#growthBtn').addEventListener('click',()=>{ renderGrowth(); $('#growthDialog').showModal(); });
$('#closeGrowthBtn').addEventListener('click',()=>$('#growthDialog').close());
