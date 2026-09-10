const DEFAULT = {
  version: 4,
  accountXp: 0,
  runs: 0,
  wins: 0,
  bestTime: 0,
  totalKarmaBanked: 0,
  stimUnlocked: false,
  chapter1Complete: false,
  introSeen: false,
  storyUnlocked: [],
  settings: { sound: true, stimKey: 'KeyR' }
};

const META_KEY = 'outpost-zero-meta';
const RUN_KEY = 'outpost-zero-run-v4';

export function loadMeta(){
  let raw;
  try { raw = JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch {}
  const data = { ...DEFAULT, ...(raw || {}) };
  data.version = 4;
  data.settings = { ...DEFAULT.settings, ...(data.settings || {}) };
  data.wins = Number.isFinite(data.wins) ? data.wins : 0;
  data.totalKarmaBanked = Number.isFinite(data.totalKarmaBanked) ? data.totalKarmaBanked : 0;
  data.stimUnlocked = data.stimUnlocked === true;
  data.introSeen = data.introSeen === true;
  data.storyUnlocked = Array.isArray(data.storyUnlocked) ? [...new Set(data.storyUnlocked)] : [];
  if (!/^((Key|Digit)[A-Z0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight)$/.test(data.settings.stimKey || '')) {
    data.settings.stimKey = 'KeyR';
  }
  const lv = accountLevelFromXp(data.accountXp).level;
  if (lv >= 10 && data.wins >= 1) data.chapter1Complete = true;
  return data;
}

export function saveMeta(meta){
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function accountLevelFromXp(xp){
  let level = 1, need = 180;
  let remain = Math.max(0, Number(xp) || 0);
  while (remain >= need) {
    remain -= need;
    level++;
    need = Math.floor(need * 1.22);
  }
  return { level, current: remain, need };
}

export function getRunPerks(meta){
  const level = accountLevelFromXp(meta.accountXp).level;
  const n = Math.max(0, level - 1);
  return {
    damage: Math.min(.22, n * .015),
    defense: Math.min(.18, n * .01),
    speed: Math.min(.12, n * .0075),
    maxHp: Math.min(30, n * 2)
  };
}

export function chapterProgress(meta){
  const lv = accountLevelFromXp(meta.accountXp).level;
  const levelProgress = Math.min(1, (lv - 1) / 9);
  const clearProgress = meta.wins > 0 ? 1 : 0;
  return {
    level: lv,
    complete: lv >= 10 && meta.wins >= 1,
    percent: Math.round((levelProgress * .8 + clearProgress * .2) * 100)
  };
}

export function saveRun(snapshot){
  try {
    const data = { ...snapshot, version: 4, savedAt: Date.now() };
    localStorage.setItem(RUN_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadRun(){
  let raw;
  try { raw = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch {}
  if (!raw || raw.version !== 4 || raw.ended) return null;
  return raw;
}

export function clearRun(){
  localStorage.removeItem(RUN_KEY);
}

export function hasRun(){
  return !!loadRun();
}
