// Persistenza locale: tutto resta sul dispositivo. Ogni accesso è protetto,
// così l'app funziona (senza memoria) anche quando lo storage non è disponibile.

const PREFIX = 'pa:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const todayISO = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

export const getPlan = () => read('piano', null);
export const savePlan = (plan) => write('piano', plan);

// Giorno del piano seguito in una certa data (vale solo per quella data)
export const getOverride = (date) => read('override', {})[date] ?? null;
export function setOverride(date, day) {
  const all = read('override', {});
  if (day) all[date] = day;
  else delete all[date];
  // tiene solo gli ultimi 60 giorni
  const keys = Object.keys(all).sort().slice(-60);
  write('override', Object.fromEntries(keys.map((k) => [k, all[k]])));
}

// Scelte: { "<data>": { "<giorno piano>": { "<pasto>|<categoria>": "<alimento>" } } }
const allChoices = () => read('scelte', {});

export function getChoices(date, day) {
  return allChoices()[date]?.[day] ?? {};
}

export function setChoice(date, day, key, value) {
  const all = allChoices();
  all[date] ??= {};
  all[date][day] ??= {};
  if (value) all[date][day][key] = value;
  else delete all[date][day][key];
  write('scelte', all);
}

// Ultima data (precedente a "before") in cui un alimento è stato scelto in una categoria con quel nome
export function lastChosenIndex(before) {
  const index = new Map();
  const all = allChoices();
  for (const date of Object.keys(all).sort()) {
    if (date >= before) continue;
    for (const sel of Object.values(all[date])) {
      for (const [key, food] of Object.entries(sel)) {
        const cat = key.split('|')[1];
        index.set(`${cat}|${food}`, date);
      }
    }
  }
  return index;
}

export function exportBackup() {
  return { app: 'piano-alimentare', esportato: new Date().toISOString(), piano: getPlan(), scelte: allChoices(), override: read('override', {}) };
}

export function importBackup(data) {
  if (!data || data.app !== 'piano-alimentare') throw new Error('File di backup non valido');
  if (data.piano) savePlan(data.piano);
  if (data.scelte) write('scelte', data.scelte);
  if (data.override) write('override', data.override);
}

export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* niente da fare */ }
}

export function getPref(key, fallback) { return read(`pref:${key}`, fallback); }
export function setPref(key, value) { write(`pref:${key}`, value); }
