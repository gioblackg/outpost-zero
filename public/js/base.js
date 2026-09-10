import { loadMeta, accountLevelFromXp, getRunPerks, chapterProgress, loadRun, clearRun } from './storage.js?v=4.0.4';

const $ = s => document.querySelector(s);
const meta = loadMeta();
const lv = accountLevelFromXp(meta.accountXp);
const perks = getRunPerks(meta);
const progress = chapterProgress(meta);
const run = loadRun();

$('#compactProfile').innerHTML = `
  <span>LV.${lv.level}</span><span>출격 ${meta.runs}</span><span>승리 ${meta.wins}</span><span>${meta.stimUnlocked ? 'STIM 보유' : 'STIM 미해금'}</span>`;
$('#chapterProgressBar').style.width = `${progress.percent}%`;
$('#chapterProgressText').textContent = `${progress.percent}%`;
$('#chapterStatus').textContent = progress.complete ? '시즌 1 완료 · 시즌 2 준비됨' : `LV.${lv.level} · 승리 ${meta.wins}회`;

if (run) {
  const remain = Math.max(0, 600 - (Number(run.gameTime) || 0));
  const m = Math.floor(remain / 60), s = Math.floor(remain % 60);
  $('#resumeCard').classList.remove('hidden');
  $('#resumeSummary').textContent = `남은 ${m}:${String(s).padStart(2,'0')} · 카르마 ${run.runKarma || 0} · 분대 ${1 + (run.allies?.length || 0)}/10`;
}

function renderGrowth(){
  $('#growthStats').innerHTML = `
    <article><span>계정 레벨</span><b>LV.${lv.level}</b><small>다음 레벨 ${lv.current}/${lv.need} XP</small></article>
    <article><span>기본 공격</span><b>+${Math.round(perks.damage*100)}%</b><small>모든 출격에 적용</small></article>
    <article><span>기본 방어</span><b>+${Math.round(perks.defense*100)}%</b><small>받는 피해 감소</small></article>
    <article><span>기본 속도</span><b>+${Math.round(perks.speed*100)}%</b><small>이동속도 상승</small></article>
    <article><span>추가 체력</span><b>+${Math.round(perks.maxHp)}</b><small>모든 출격에 적용</small></article>
    <article><span>스팀팩</span><b>${meta.stimUnlocked ? '영구 해금' : '미해금'}</b><small>출격 상점에서 1회 구매</small></article>`;
}

const STORY = [
  ['west-outpost','기록 01 · 감시망','적 전투체들은 무작위로 움직이지 않는다. 모든 경계 신호가 북쪽으로 향한다.'],
  ['east-outpost','기록 02 · 생존 신호','폐허 바깥에서 짧은 구조 신호가 잡혔다. 우리 외에도 살아남은 사람이 있다.'],
  ['factory','기록 03 · 생산시설','카르마는 단순한 동력원이 아니다. 전투 명령 데이터와 함께 저장되고 있다.'],
  ['fortress','기록 04 · KARMA PROJECT','인간 장비와의 호환 시험 기록이 발견됐다. 이 기술은 적의 것이 아니었다.'],
  ['command','기록 05 · 원점','지휘망의 설계 서명은 인간 군 연구소의 것이다. 우리가 만든 것이 우리를 사냥하고 있다.']
];
function renderStory(){
  const unlocked = new Set(meta.storyUnlocked || []);
  $('#storyList').innerHTML = STORY.map(([id,title,text]) => unlocked.has(id)
    ? `<article class="story-entry"><h3>${title}</h3><p>${text}</p></article>`
    : `<article class="story-entry locked"><h3>미발견 기록</h3><p>적 거점을 파괴해 기록을 회수하세요.</p></article>`).join('');
}

$('#growthBtn').onclick = () => { renderGrowth(); $('#growthDialog').showModal(); };
$('#closeGrowthBtn').onclick = () => $('#growthDialog').close();
$('#storyBtn').onclick = () => { renderStory(); $('#storyDialog').showModal(); };
$('#closeStoryBtn').onclick = () => $('#storyDialog').close();

$('#newRunBtn').addEventListener('click', e => {
  if (!run) return;
  e.preventDefault();
  $('#newRunConfirm').showModal();
});
$('#cancelNewBtn').onclick = () => $('#newRunConfirm').close();
$('#confirmNewBtn').onclick = () => { clearRun(); location.href = '/game.html?new=1'; };
