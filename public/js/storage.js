const DEFAULT = {
  version: 5,
  accountXp: 0,
  runs: 0,
  wins: 0,
  totalKarmaBanked: 0,
  stimUnlocked: false,
  completedStages: [],
  maxStageUnlocked: 1,
  settings: { sound: true, stimKey: 'KeyR' }
};

const META_KEY = 'outpost-zero-meta';
const RUN_KEY = 'outpost-zero-run-v5';

export function loadMeta(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch {}
  const data = { ...DEFAULT, ...(raw || {}) };
  data.version = 5;
  data.settings = { ...DEFAULT.settings, ...(data.settings || {}) };
  data.completedStages = Array.isArray(data.completedStages) ? [...new Set(data.completedStages.map(Number).filter(n=>n>=1&&n<=20))] : [];
  data.maxStageUnlocked = Math.max(1, Math.min(20, Number(data.maxStageUnlocked) || 1));
  if (data.completedStages.length) data.maxStageUnlocked = Math.max(data.maxStageUnlocked, Math.min(20, Math.max(...data.completedStages) + 1));
  data.stimUnlocked = data.stimUnlocked === true;
  if (!/^((Key|Digit)[A-Z0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight)$/.test(data.settings.stimKey || '')) data.settings.stimKey = 'KeyR';
  return data;
}

export function saveMeta(meta){ localStorage.setItem(META_KEY, JSON.stringify(meta)); }

export function accountLevelFromXp(xp){
  let level = 1, need = 160, remain = Math.max(0, Number(xp) || 0);
  while (remain >= need) { remain -= need; level++; need = Math.floor(need * 1.18); }
  return { level, current: remain, need };
}

export function getRunPerks(meta){
  const n = Math.max(0, accountLevelFromXp(meta.accountXp).level - 1);
  return {
    damage: Math.min(.16, n * .01),
    defense: Math.min(.14, n * .008),
    speed: Math.min(.10, n * .006),
    maxHp: Math.min(24, n * 1.5)
  };
}

export function saveRun(snapshot){
  try { localStorage.setItem(RUN_KEY, JSON.stringify({ ...snapshot, version: 5, savedAt: Date.now() })); return true; } catch { return false; }
}
export function loadRun(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch {}
  if (!raw || raw.version !== 5 || raw.ended) return null;
  return raw;
}
export function clearRun(){ localStorage.removeItem(RUN_KEY); }
