import { GIORNI, NOMI_GIORNI, summarize } from './parser.js';
import * as store from './storage.js';

const app = document.getElementById('app');

const MEALS = {
  colazione: { time: '07:30', until: 9.5 },
  'meta-mattina': { time: '10:30', until: 12 },
  pranzo: { time: '13:00', until: 15.5 },
  merenda: { time: '16:30', until: 18.5 },
  cena: { time: '20:00', until: 24 },
};
const SHORT = { lun: 'Lun', mar: 'Mar', mer: 'Mer', gio: 'Gio', ven: 'Ven', sab: 'Sab', dom: 'Dom' };
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const state = {
  plan: store.getPlan(),
  view: 'oggi',          // oggi | settimana | info | giorno
  browseDay: null,       // giorno aperto dalla vista Settimana (sola lettura)
  open: new Map(),       // pasto → aperto/chiuso deciso dall'utente
  date: store.todayISO(),
  scrolledToNow: false,
  pending: null,         // piano appena letto, in attesa di conferma
  error: null,
  loading: false,
};

// ---------- utilità ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const mealIcon = (id) => icon(MEALS[id] ? id : 'pasto');
const tint = (id) => `--tint: var(--t-${MEALS[id] ? id : 'default'})`;
const realDay = () => GIORNI[(new Date().getDay() + 6) % 7];
const followedDay = () => store.getOverride(state.date) || realDay();
const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const conArticolo = (d) => `${d === 'dom' ? 'la' : 'il'} ${NOMI_GIORNI[d].toLowerCase()}`;
const choiceKey = (meal, cat) => `${meal.id}|${cat.nome}`;
const selectable = (cat) => cat.opzioni.filter((o) => !o.evitare);

function dateLabel() {
  const d = new Date();
  return `${NOMI_GIORNI[realDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`;
}

function qtyHTML(qty) {
  if (!qty) return '';
  let m = /^g\s*(\d+)$/.exec(qty);
  if (m) return `<span class="qty"><b>${m[1]}</b><i>g</i></span>`;
  m = /^n°\s*(\d+)$/.exec(qty);
  if (m) return `<span class="qty"><b>${m[1]}</b><i>pz</i></span>`;
  return `<span class="qty text">${esc(qty)}</span>`;
}

function ago(dateISO) {
  const days = Math.round((new Date(state.date) - new Date(dateISO)) / 86400000);
  if (days <= 0) return null;
  if (days === 1) return 'ieri';
  return `${days} giorni fa`;
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function currentMealIndex(meals) {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const idx = meals.findIndex((m) => h < (MEALS[m.id]?.until ?? 24));
  return idx === -1 ? meals.length - 1 : idx;
}

function mealStatus(meal, choices) {
  if (meal.libero) return { done: true, chosen: 0, total: 0 };
  let chosen = 0;
  for (const c of meal.categorie) {
    if (selectable(c).length <= 1 || choices[choiceKey(meal, c)]) chosen++;
  }
  return { done: chosen === meal.categorie.length, chosen, total: meal.categorie.length };
}

// ---------- render ----------

function render(anim) {
  document.documentElement.dataset.theme = store.getPref('tema', 'auto') === 'auto' ? '' : store.getPref('tema');
  if (!document.documentElement.dataset.theme) delete document.documentElement.dataset.theme;

  if (!state.plan || state.pending || state.loading) {
    app.classList.add('no-tabs');
    app.innerHTML = renderOnboarding();
    document.querySelector('.tabbar')?.remove();
    return;
  }
  app.classList.remove('no-tabs');
  const views = { oggi: renderToday, giorno: renderToday, settimana: renderWeek, info: renderInfo };
  app.innerHTML = views[state.view]();
  renderTabbar();
  if (anim) app.querySelector('.timeline, .free-day')?.classList.add(anim);

  if (state.view === 'oggi' && !state.scrolledToNow) {
    state.scrolledToNow = true;
    const now = app.querySelector('.meal.is-now');
    const idx = [...app.querySelectorAll('.meal')].indexOf(now);
    if (now && idx > 0) requestAnimationFrame(() => now.scrollIntoView({ block: 'start' }));
  }
}

function renderTabbar() {
  let bar = document.querySelector('.tabbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'tabbar';
    document.body.append(bar);
  }
  const active = state.view === 'giorno' ? 'settimana' : state.view;
  const tab = (id, label, ic) => `<button data-action="tab" data-view="${id}" class="${active === id ? 'is-active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(ic)}${label}</button>`;
  bar.innerHTML = `<nav aria-label="Sezioni">${tab('oggi', 'Oggi', 'oggi')}${tab('settimana', 'Settimana', 'settimana')}${tab('info', 'Info', 'info')}</nav>`;
}

function renderToday() {
  const readonly = state.view === 'giorno';
  const day = readonly ? state.browseDay : followedDay();
  const real = realDay();
  const g = state.plan.giorni[day];
  const choices = readonly ? {} : store.getChoices(state.date, day);
  const macro = state.plan.macro[day];

  let hero;
  if (readonly) {
    hero = `
      <header class="hero">
        <div class="hero-top">
          <button class="icon-btn" data-action="back" aria-label="Torna alla settimana">${icon('back')}</button>
          <p class="eyebrow">Piano della settimana</p>
        </div>
        <h1 style="margin-top:14px">${esc(NOMI_GIORNI[day])}</h1>
        ${macroHTML(macro)}
        ${day !== followedDay() ? `<button class="follow-btn" data-action="follow" data-day="${day}">${icon('check')}Oggi seguo ${esc(conArticolo(day))}</button>` : ''}
      </header>`;
  } else {
    const pills = GIORNI.map((d) => `
      <button class="pill ${d === day ? 'is-selected' : ''} ${d === real ? 'is-real' : ''}" data-action="day" data-day="${d}"
        aria-pressed="${d === day}" aria-label="${NOMI_GIORNI[d]}${d === real ? ' (oggi)' : ''}">${SHORT[d]}</button>`).join('');
    hero = `
      <header class="hero">
        <p class="eyebrow">${esc(dateLabel())}</p>
        <h1>${day === real ? 'Cosa mangio oggi' : `Oggi segui ${day === 'dom' ? 'la' : 'il'} <em>${esc(NOMI_GIORNI[day].toLowerCase())}</em>`}</h1>
        <div class="daypills" role="group" aria-label="Giorno del piano che segui oggi">${pills}</div>
        ${day !== real ? `<p class="override-note"><span>Oggi è ${esc(NOMI_GIORNI[real].toLowerCase())}</span><button data-action="reset">${icon('reset')}Torna a ${esc(NOMI_GIORNI[real].toLowerCase())}</button></p>` : ''}
        ${macroHTML(macro)}
      </header>`;
  }

  if (g.libero) {
    return `${hero}
      <section class="free-day">
        ${icon('leaf')}
        <h2>Giorno libero</h2>
        <p>${esc(capFirst(state.plan.notaLibero) || 'Scegli tu cosa mangiare a ogni pasto, prendendo esempio dagli altri giorni del piano.')}</p>
      </section>`;
  }

  const nowIdx = readonly ? -1 : currentMealIndex(g.pasti);
  const statuses = g.pasti.map((m) => mealStatus(m, choices));
  const jump = g.pasti.map((m, i) => `
    <button data-action="jump" data-meal="${m.id}" style="${tint(m.id)}" class="${!readonly && statuses[i].done && !m.libero ? 'is-done' : ''}">
      <span class="dot"></span>${esc(m.nome)}</button>`).join('');

  const meals = g.pasti.map((m, i) => renderMeal(m, i, { nowIdx, status: statuses[i], choices, readonly, day })).join('');
  return `${hero}<nav class="jump" aria-label="Vai al pasto">${jump}</nav><ol class="timeline">${meals}</ol>`;
}

function macroHTML(m) {
  if (!m) return '';
  const cell = (v, unit, label) => `<div><b>${esc(v)}<small>${unit}</small></b><span>${label}</span></div>`;
  return `<div class="macros">
    ${cell(m.kcal, 'kcal', 'Energia')}${cell(m.protidi, 'g', 'Proteine')}${cell(m.glucidi, 'g', 'Carboidrati')}${cell(m.lipidi, 'g', 'Grassi')}
  </div>`;
}

function renderMeal(meal, i, { nowIdx, status, choices, readonly, day }) {
  const isNow = i === nowIdx;
  const isPast = nowIdx > -1 && i < nowIdx;
  const userOpen = state.open.get(`${day}|${meal.id}`);
  const open = userOpen ?? !(isPast && status.done);
  const cls = ['meal', isNow && 'is-now', isPast && 'is-past', !readonly && status.done && !meal.libero && 'is-done', open && 'is-open'].filter(Boolean).join(' ');

  let body;
  if (meal.libero) {
    body = `<p class="free"><strong>Pasto libero.</strong> Ricostruiscilo sull'esempio degli altri giorni.</p>`;
  } else {
    const rows = meal.categorie.map((c, ci) => {
      const opts = selectable(c);
      const key = choiceKey(meal, c);
      if (opts.length === 1 && !opts[0].ingredienti) {
        return `<li><div class="cat is-fixed"><span><span class="cat-label">${esc(c.nome)}</span><span class="cat-value">${esc(opts[0].nome)}</span></span>${qtyHTML(opts[0].qty)}</div></li>`;
      }
      const chosen = choices[key] && c.opzioni.find((o) => o.nome === choices[key]);
      const value = chosen
        ? `<span class="cat-value">${esc(chosen.nome)}</span>`
        : `<span class="cat-value placeholder">${readonly ? `${c.opzioni.length} alternative` : `Scegli 1 di ${opts.length}`}</span>`;
      return `<li><button class="cat ${chosen ? 'is-chosen' : ''}" data-action="sheet" data-meal="${meal.id}" data-cat="${ci}">
        <span><span class="cat-label">${esc(c.nome)}</span>${value}</span>
        ${chosen ? qtyHTML(chosen.qty) : '<span></span>'}
        ${icon('chevron', 'chev')}
      </button></li>`;
    }).join('');
    body = `<ul class="cats">${rows}</ul>`;
  }

  const summary = !meal.libero && !readonly
    ? meal.categorie.map((c) => choices[choiceKey(meal, c)] || (selectable(c).length === 1 ? selectable(c)[0].nome : null)).filter(Boolean).join(' · ')
    : '';
  const count = meal.libero || readonly ? '' : `<span class="count ${status.done ? 'full' : ''}">${status.chosen}/${status.total}</span>`;

  return `<li class="${cls}" id="meal-${meal.id}" style="${tint(meal.id)}">
    <div class="node">${status.done && !meal.libero && !readonly ? icon('check') : mealIcon(meal.id)}</div>
    <div class="meal-card">
      <button class="meal-head" data-action="fold" data-meal="${meal.id}" aria-expanded="${open}">
        <h2>${esc(meal.nome)}</h2>
        ${MEALS[meal.id] ? `<span class="time">${MEALS[meal.id].time}</span>` : ''}
        ${count}
        ${icon('chevron', 'fold')}
      </button>
      ${summary ? `<p class="meal-summary">${esc(summary)}</p>` : ''}
      ${body}
    </div>
  </li>`;
}

function renderWeek() {
  const real = realDay();
  const followed = followedDay();
  const kcals = GIORNI.map((d) => parseInt(String(state.plan.macro[d]?.kcal || '0').replace(/\D/g, ''), 10) || 0);
  const max = Math.max(...kcals, 1);
  const sections = Object.entries(state.plan.settimana);
  const cards = GIORNI.map((d, i) => {
    const g = state.plan.giorni[d];
    const tags = `${d === real ? '<span class="tag real">Oggi</span>' : ''}${d === followed && d !== real ? '<span class="tag follow">Segui</span>' : ''}`;
    const rows = sections.map(([k, v]) => v[d] ? `<dt>${esc(k.charAt(0).toUpperCase() + k.slice(1))}</dt><dd>${esc(v[d])}</dd>` : '').join('');
    return `<li><button class="week-card" data-action="browse" data-day="${d}">
      <div class="top"><h2>${NOMI_GIORNI[d]}</h2>${tags}${kcals[i] ? `<span class="kc">${esc(state.plan.macro[d].kcal)} kcal</span>` : ''}</div>
      ${kcals[i] ? `<div class="kcalbar"><span style="width:${Math.round((kcals[i] / max) * 100)}%"></span></div>` : ''}
      ${g.libero ? '<dl><dt>Giorno</dt><dd>Libero</dd></dl>' : `<dl>${rows}</dl>`}
    </button></li>`;
  }).join('');
  return `<header class="page-head"><p class="eyebrow">Il tuo piano</p><h1>La settimana</h1>
    <p class="sub">Tocca un giorno per vederlo nel dettaglio.</p></header>
    <ul class="week">${cards}</ul>`;
}

function renderInfo() {
  const m = state.plan.meta || {};
  const stat = (label, v) => (v ? `<div class="stat"><span>${label}</span><b>${esc(v)}</b></div>` : '');
  const norme = (state.plan.norme || []).map((n) => `
    <details><summary>${esc(n.titolo)}${icon('chevron')}</summary>
      <div class="body">${n.paragrafi.map((p) => `<p>${esc(p)}</p>`).join('')}</div></details>`).join('');
  const units = (state.plan.unita || []).map((u) => `<li><b>${esc(u.alimento)}</b><span>${esc(u.misura)}</span></li>`).join('');
  const tema = store.getPref('tema', 'auto');
  const seg = (v, l) => `<button data-action="theme" data-theme="${v}" class="${tema === v ? 'is-active' : ''}" aria-pressed="${tema === v}">${l}</button>`;
  const imported = state.plan.importedAt ? new Date(state.plan.importedAt).toLocaleDateString('it-IT') : '';

  return `<header class="page-head"><p class="eyebrow">${esc(m.paziente || 'Il tuo piano')}</p><h1>Info e regole</h1>
      ${m.visita ? `<p class="sub">Piano della visita del ${esc(m.visita)}</p>` : ''}</header>
    <div class="stats">${stat('Peso', m.peso)}${stat('Altezza', m.altezza)}${stat('BMI', m.bmi)}${stat('Metabolismo basale', m.bmr)}</div>
    ${norme ? `<h2 class="section-title">Come seguire il piano</h2><div class="box">${norme}</div>` : ''}
    ${units ? `<h2 class="section-title">Unità di misura</h2><div class="box"><ul class="units">${units}</ul></div>` : ''}
    <h2 class="section-title">Impostazioni</h2>
    <div class="settings">
      <div class="seg" role="group" aria-label="Tema">${seg('auto', 'Automatico')}${seg('light', 'Chiaro')}${seg('dark', 'Scuro')}</div>
      <label class="btn primary">${icon('upload')}Carica un nuovo piano (PDF)<input type="file" accept="application/pdf,.pdf" data-action="upload" class="sr-only"></label>
      <button class="btn" data-action="export">Esporta backup</button>
      <label class="btn">Importa backup<input type="file" accept="application/json,.json" data-action="import" class="sr-only"></label>
      <button class="btn danger" data-action="clear">Cancella tutti i dati</button>
    </div>
    <p class="fine">I dati restano solo su questo dispositivo.${imported ? ` Piano caricato il ${imported}.` : ''}</p>`;
}

function renderOnboarding() {
  const art = `<svg class="art" viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="84" r="62" fill="var(--paper-2)"/>
    <circle cx="80" cy="84" r="44" fill="var(--card)" stroke="var(--line)" stroke-width="2"/>
    <circle cx="80" cy="84" r="30" fill="none" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 5"/>
    <path d="M58 92c4-18 18-28 40-30-2 22-12 34-30 36" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M60 98l24-24" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="103" cy="99" r="8" fill="var(--warm-soft)" stroke="var(--warm)" stroke-width="2.5"/>
    <path d="M18 40v26a6 6 0 0 0 6 6v50M24 40v20M30 40v20" stroke="var(--ink-3)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <path d="M142 40c-6 4-8 12-8 24h8v58" stroke="var(--ink-3)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;

  if (state.loading) {
    return `<section class="onboard">${art}<div class="spinner" role="progressbar" aria-label="Lettura in corso"></div>
      <p class="lead">Sto leggendo il piano…</p></section>`;
  }
  if (state.pending) {
    const s = summarize(state.pending);
    return `<section class="onboard">${art}
      <p class="eyebrow">${esc(state.pending.meta?.paziente || '')}</p>
      <h1 style="margin-top:6px">Piano <em>pronto</em></h1>
      <p class="lead">Ho trovato tutto quello che serve${state.pending.meta?.visita ? ` nel piano della visita del ${esc(state.pending.meta.visita)}` : ''}.</p>
      <div class="found"><div><b>${s.giorni}</b><span>giorni</span></div><div><b>${s.categorie}</b><span>categorie</span></div><div><b>${s.opzioni}</b><span>alimenti</span></div></div>
      <button class="btn primary" data-action="confirm">Inizia</button>
      <button class="link-btn" data-action="cancel" style="margin-top:8px">Annulla</button>
    </section>`;
  }
  return `<section class="onboard">${art}
    <h1>Il tuo piano,<br><em>a portata di mano</em></h1>
    <p class="lead">Carica il PDF della nutrizionista: lo leggo qui, sul dispositivo, e ti mostro ogni giorno cosa mangiare.</p>
    <label class="btn primary">${icon('upload')}Carica il PDF<input type="file" accept="application/pdf,.pdf" data-action="upload" class="sr-only"></label>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
    <p class="note">Nessun dato lascia il telefono.</p>
  </section>`;
}

// ---------- bottom sheet ----------

function openSheet(mealId, catIdx) {
  const readonly = state.view === 'giorno';
  const day = readonly ? state.browseDay : followedDay();
  const meal = state.plan.giorni[day].pasti.find((m) => m.id === mealId);
  const cat = meal.categorie[catIdx];
  const key = choiceKey(meal, cat);
  const chosen = readonly ? null : store.getChoices(state.date, day)[key];
  const last = readonly ? new Map() : store.lastChosenIndex(state.date);
  const opts = selectable(cat);

  const items = cat.opzioni.map((o, oi) => {
    const when = last.get(`${cat.nome}|${o.nome}`);
    const whenTxt = when && ago(when);
    const recent = when && (new Date(state.date) - new Date(when)) / 86400000 <= 2;
    const ingr = o.ingredienti?.length ? `<ul class="ingr">${o.ingredienti.map((x) => `<li><span>${esc(x.nome)}</span><span>${esc(x.qty || '')}</span></li>`).join('')}</ul>` : '';
    const name = `<span class="opt-name"><span>${esc(o.nome)}</span>
      ${o.evitare ? `<span class="badge-avoid">${icon('avoid')}Da evitare</span>` : ''}
      ${whenTxt && !o.evitare ? `<small class="${recent ? 'recent' : ''}">Scelto ${whenTxt}</small>` : ''}${ingr}</span>`;
    if (readonly || o.evitare) {
      return `<li><div class="opt ${readonly ? 'readonly' : ''} ${o.evitare ? 'is-avoid' : ''}" ${o.evitare && !readonly ? 'aria-disabled="true"' : ''}>
        ${readonly ? '' : `<span class="tick"></span>`}${name}${qtyHTML(o.qty)}</div></li>`;
    }
    return `<li data-name="${esc(o.nome.toLowerCase())}"><button class="opt ${chosen === o.nome ? 'is-chosen' : ''}" data-action="choose" data-opt="${oi}" aria-pressed="${chosen === o.nome}">
      <span class="tick">${icon('check')}</span>${name}${qtyHTML(o.qty)}</button></li>`;
  }).join('');

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', cat.nome);
  sheet.style.cssText = tint(meal.id);
  sheet.innerHTML = `
    <header class="sheet-head">
      <div class="grabber"></div>
      <p class="eyebrow"><span class="dot"></span>${esc(meal.nome)} · ${esc(NOMI_GIORNI[day])}</p>
      <h3>${esc(cat.nome)}</h3>
      <p class="hint">${readonly ? `${cat.opzioni.length} alternative` : 'Scegline uno'}${!readonly && opts.length > 1 ? ` tra ${opts.length}` : ''}</p>
      ${cat.opzioni.length > 10 ? '<input class="filter" type="search" placeholder="Cerca…" aria-label="Cerca alimento" data-action="filter">' : ''}
    </header>
    <ul class="opts">${items}</ul>
    ${chosen ? '<div class="sheet-foot"><button class="link-btn" data-action="unchoose">Rimuovi la scelta</button></div>' : ''}`;
  document.body.append(backdrop, sheet);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });

  const close = () => {
    backdrop.classList.remove('show');
    sheet.classList.remove('show');
    sheet.style.transform = '';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { backdrop.remove(); sheet.remove(); }, 320);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);

  const pick = (value) => {
    store.setChoice(state.date, day, key, value);
    render();
    setTimeout(close, value ? 260 : 0);
  };
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'choose') {
      const o = cat.opzioni[+b.dataset.opt];
      const already = chosen === o.nome;
      sheet.querySelectorAll('.opt.is-chosen').forEach((x) => x.classList.remove('is-chosen'));
      if (!already) b.classList.add('is-chosen');
      pick(already ? null : o.nome);
    } else if (b.dataset.action === 'unchoose') pick(null);
  });
  sheet.querySelector('.filter')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    sheet.querySelectorAll('.opts > li').forEach((li) => {
      const n = li.dataset.name ?? li.textContent.toLowerCase();
      li.hidden = q && !n.includes(q);
    });
  });

  // trascina verso il basso per chiudere
  const head = sheet.querySelector('.sheet-head');
  let startY = null;
  head.addEventListener('touchstart', (e) => { if (e.target.tagName !== 'INPUT') { startY = e.touches[0].clientY; sheet.style.transition = 'none'; } }, { passive: true });
  head.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  head.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    sheet.style.transition = '';
    if (dy > 90) close();
    else sheet.style.transform = '';
  });
}

// ---------- azioni ----------

async function loadPdf(file) {
  if (!file) return;
  state.loading = true;
  state.error = null;
  render();
  try {
    const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    const { parsePlan } = await import('./parser.js');
    const plan = await parsePlan(pdfjs, new Uint8Array(await file.arrayBuffer()));
    const s = summarize(plan);
    if (!s.giorni || !s.categorie) throw new Error('Non ho trovato giorni o pasti in questo PDF. È il piano della nutrizionista?');
    state.pending = plan;
  } catch (err) {
    console.error(err);
    state.error = err.message?.startsWith('Non ho') ? err.message : 'Non riesco a leggere questo file. Prova con il PDF originale del piano.';
  } finally {
    state.loading = false;
    render();
  }
}

function setDay(d) {
  const before = GIORNI.indexOf(followedDay());
  store.setOverride(state.date, d === realDay() ? null : d);
  const after = GIORNI.indexOf(followedDay());
  state.open.clear();
  render(after > before ? 'slide-left' : after < before ? 'slide-right' : null);
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action } = el.dataset;
  switch (action) {
    case 'day': setDay(el.dataset.day); break;
    case 'reset': setDay(realDay()); break;
    case 'jump': {
      const target = document.getElementById(`meal-${el.dataset.meal}`);
      const day = state.view === 'giorno' ? state.browseDay : followedDay();
      state.open.set(`${day}|${el.dataset.meal}`, true);
      target?.classList.add('is-open');
      target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      break;
    }
    case 'fold': {
      const day = state.view === 'giorno' ? state.browseDay : followedDay();
      const li = el.closest('.meal');
      const open = !li.classList.contains('is-open');
      state.open.set(`${day}|${el.dataset.meal}`, open);
      li.classList.toggle('is-open', open);
      el.setAttribute('aria-expanded', open);
      break;
    }
    case 'sheet': openSheet(el.dataset.meal, +el.dataset.cat); break;
    case 'browse': state.view = 'giorno'; state.browseDay = el.dataset.day; state.open.clear(); render(); scrollTo(0, 0); break;
    case 'back': state.view = 'settimana'; render(); scrollTo(0, 0); break;
    case 'follow':
      store.setOverride(state.date, el.dataset.day === realDay() ? null : el.dataset.day);
      state.view = 'oggi';
      state.open.clear();
      render();
      scrollTo(0, 0);
      toast(`Oggi segui ${conArticolo(el.dataset.day)}`);
      break;
    case 'theme': store.setPref('tema', el.dataset.theme); render(); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(store.exportBackup(), null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `piano-alimentare-backup-${state.date}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'clear':
      if (confirm('Cancellare piano e scelte salvate su questo dispositivo?')) {
        store.clearAll();
        state.plan = null;
        state.view = 'oggi';
        render();
      }
      break;
    case 'confirm':
      store.savePlan(state.pending);
      state.plan = state.pending;
      state.pending = null;
      state.view = 'oggi';
      state.scrolledToNow = false;
      render();
      scrollTo(0, 0);
      navigator.storage?.persist?.();
      break;
    case 'cancel': state.pending = null; render(); break;
  }
});

app.addEventListener('change', async (e) => {
  const input = e.target;
  if (input.dataset.action === 'upload') loadPdf(input.files[0]);
  if (input.dataset.action === 'import' && input.files[0]) {
    try {
      store.importBackup(JSON.parse(await input.files[0].text()));
      state.plan = store.getPlan();
      render();
      toast('Backup importato');
    } catch {
      toast('File di backup non valido');
    }
  }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('.tabbar [data-action="tab"]');
  if (!b) return;
  state.view = b.dataset.view;
  render();
  scrollTo(0, 0);
});

// scorrimento orizzontale sulla timeline per cambiare giorno
let swipe = null;
app.addEventListener('touchstart', (e) => {
  if (state.view !== 'oggi' || !e.target.closest('.timeline, .jump') || e.target.closest('.jump')) return;
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
app.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - swipe.x;
  const dy = e.changedTouches[0].clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < 80 || Math.abs(dy) > 50) return;
  const i = GIORNI.indexOf(followedDay());
  const next = GIORNI[(i + (dx < 0 ? 1 : 6)) % 7];
  setDay(next);
  toast(`Piano di ${NOMI_GIORNI[next].toLowerCase()}`);
});

// al ritorno sull'app (es. il giorno dopo) aggiorna la data
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.todayISO() !== state.date) {
    state.date = store.todayISO();
    state.open.clear();
    state.scrolledToNow = false;
    render();
  }
});

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
