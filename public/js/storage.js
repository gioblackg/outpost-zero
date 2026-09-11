const DEFAULT_CAMPAIGN = { active:false, credits:0, attack:15, defense:0, speed:190, nextStage:1 };
const DEFAULT = {
  version: 51,
  accountXp: 0,
  runs: 0,
  wins: 0,
  totalKarmaBanked: 0,
  stimUnlocked: false,
  completedStages: [],
  maxStageUnlocked: 1,
  campaign: { ...DEFAULT_CAMPAIGN },
  settings: { sound: true, stimKey: 'KeyR' }
};

const META_KEY = 'outpost-zero-meta';
const RUN_KEY = 'outpost-zero-run-v51';

export function loadMeta(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch {}
  const data = { ...DEFAULT, ...(raw || {}) };
  data.version = 51;
  data.settings = { ...DEFAULT.settings, ...(data.settings || {}) };
  data.completedStages = Array.isArray(data.completedStages) ? [...new Set(data.completedStages.map(Number).filter(n=>n>=1&&n<=20))] : [];
  data.maxStageUnlocked = Math.max(1, Math.min(20, Number(data.maxStageUnlocked) || 1));
  if (data.completedStages.length) data.maxStageUnlocked = Math.max(data.maxStageUnlocked, Math.min(20, Math.max(...data.completedStages) + 1));
  data.stimUnlocked = data.stimUnlocked === true;
  const c = { ...DEFAULT_CAMPAIGN, ...(data.campaign || {}) };
  c.active = c.active === true;
  c.credits = Math.max(0, Math.floor(Number(c.credits)||0));
  c.attack = Math.max(15, Number(c.attack)||15);
  c.defense = Math.max(0, Number(c.defense)||0);
  c.speed = Math.max(190, Number(c.speed)||190);
  c.nextStage = Math.max(1, Math.min(20, Number(c.nextStage)||1));
  data.campaign = c;
  if (!/^((Key|Digit)[A-Z0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight)$/.test(data.settings.stimKey || '')) data.settings.stimKey = 'KeyR';
  return data;
}

export function saveMeta(meta){ localStorage.setItem(META_KEY, JSON.stringify(meta)); }
export function resetCampaign(meta){ meta.campaign = { ...DEFAULT_CAMPAIGN }; return meta.campaign; }

export function accountLevelFromXp(xp){
  let level = 1, need = 160, remain = Math.max(0, Number(xp) || 0);
  while (remain >= need) { remain -= need; level++; need = Math.floor(need * 1.18); }
  return { level, current: remain, need };
}

export function getRunPerks(){ return { damage:0, defense:0, speed:0, maxHp:0 }; }

export function saveRun(snapshot){
  try { localStorage.setItem(RUN_KEY, JSON.stringify({ ...snapshot, version: 51, savedAt: Date.now() })); return true; } catch { return false; }
}
export function loadRun(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch {}
  if (!raw || raw.version !== 51 || raw.ended) return null;
  return raw;
}
export function clearRun(){ localStorage.removeItem(RUN_KEY); }
