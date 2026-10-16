// Parser per i piani alimentari in PDF generati da Progeo Medical.
// Riceve la libreria pdf.js (browser o Node) e i byte del PDF, restituisce il piano in JSON.

export const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
export const NOMI_GIORNI = {
  lun: 'Lunedì', mar: 'Martedì', mer: 'Mercoledì', gio: 'Giovedì',
  ven: 'Venerdì', sab: 'Sabato', dom: 'Domenica',
};

const ORDINE_PASTI = {
  colazione: 10, 'meta-mattina': 20, spuntino: 25, pranzo: 30,
  merenda: 40, cena: 50, 'dopo-cena': 60,
};

const Y_TOL = 2.5;          // tolleranza per considerare due testi sulla stessa riga
const QTY_REL_X = 180;      // oltre questa distanza dall'inizio colonna c'è la quantità
const CAT_REL_X = 20;       // testi centrati: categorie e giorni
const INDENT_REL_X = 4;     // ingredienti dei piatti composti

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function dayKey(text) {
  const n = norm(text);
  return GIORNI.find((g) => n.startsWith(g)) && /^(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)$/.test(n)
    ? n.slice(0, 3)
    : null;
}

const isNoise = (t) => /^(elaborato da|powered by|codice:)/i.test(t);
const isFree = (t) => /pasto libero|dieta libera/i.test(t);

async function readPages(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const width = page.view[2];
    const items = tc.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => {
        const [a, b, , , x, y] = it.transform;
        return { str: clean(it.str), x, y, size: Math.round(Math.hypot(a, b)), rotated: Math.abs(b) > 0.1 };
      });
    pages.push({ n, width, items });
  }
  await doc.destroy();
  return pages;
}

function groupLines(items) {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Y_TOL);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((p, q) => p.x - q.x);
    l.x = l.items[0].x;
    l.text = clean(l.items.map((i) => i.str).join(' '));
  }
  return lines.sort((p, q) => q.y - p.y);
}

// ---------- Pagine dei pasti ----------

function pageTitle(page) {
  const big = page.items.filter((i) => i.size >= 15 && !i.rotated).sort((p, q) => q.y - p.y);
  return big;
}

function columnLines(items, colStart) {
  const qty = [];
  const marks = [];
  const text = [];
  for (const it of items) {
    const rel = it.x - colStart;
    if (it.str === 'X') marks.push(it);
    else if (rel >= QTY_REL_X) qty.push(it);
    else text.push(it);
  }
  const lines = groupLines(text).map((l) => ({ ...l, rel: l.x - colStart, qty: null, avoid: false, joinNext: false }));

  const attach = (tok, apply) => {
    const same = lines.find((l) => Math.abs(l.y - tok.y) <= Y_TOL);
    if (same) return apply(same);
    // quantità a metà altezza: il nome va a capo su due righe
    const above = lines.filter((l) => l.y > tok.y).at(-1);
    const below = lines.find((l) => l.y < tok.y);
    if (above) {
      if (below) above.joinNext = true;
      apply(above);
    }
  };
  for (const q of qty) attach(q, (l) => { l.qty = l.qty ? `${l.qty} ${q.str}` : q.str; });
  for (const m of marks) attach(m, (l) => { l.avoid = true; });

  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.joinNext && lines[i + 1]) {
      const next = lines[i + 1];
      merged.push({ ...l, text: clean(`${l.text} ${next.text}`), qty: l.qty || next.qty, avoid: l.avoid || next.avoid });
      i++;
    } else merged.push(l);
  }
  // una riga senza quantità a inizio colonna seguita da un'altra allineata è un nome andato a capo
  // (quantità sulla seconda riga); se la riga dopo è rientrata è invece un piatto composto
  const out = [];
  for (let i = 0; i < merged.length; i++) {
    const l = merged[i];
    const next = merged[i + 1];
    if (!l.qty && l.rel < INDENT_REL_X && next && next.qty && Math.abs(next.rel - l.rel) < 1.5
        && l.y - next.y < 16 && !/^\.\.\./.test(l.text)) {
      out.push({ ...next, rel: l.rel, text: clean(`${l.text} ${next.text}`), avoid: l.avoid || next.avoid });
      i++;
    } else out.push(l);
  }
  return out;
}

function mealName(raw) {
  const t = clean(raw);
  return t === t.toUpperCase() ? capitalize(t) : t;
}

function parseMealPages(pages, plan) {
  const starts = { left: Infinity, right: Infinity };
  const contentItems = (page) => page.items.filter((i) => i.size >= 9 && i.size < 15 && !i.rotated && !isNoise(i.str));
  for (const page of pages) {
    for (const it of contentItems(page)) {
      if (it.str === 'X') continue;
      if (it.x < page.width / 2 - 2) starts.left = Math.min(starts.left, it.x);
      else starts.right = Math.min(starts.right, it.x);
    }
  }

  const getMeal = (day, name) => {
    const g = plan.giorni[day];
    const id = slug(name);
    let meal = g.pasti.find((p) => p.id === id);
    if (!meal) {
      meal = { id, nome: name, libero: false, categorie: [] };
      g.pasti.push(meal);
    }
    return meal;
  };

  const prev = { mealTitle: null, day: null };
  for (const page of pages) {
    const titles = pageTitle(page).map((t) => t.str).filter((t) => norm(t) !== norm(plan.meta.paziente || ''));
    const title = titles.at(-1) || null;
    let fixedDay = null;
    let mealTitle = title;
    const m = /^Piano alimentare\s*-\s*([^-]+?)\s*(?:-\s*(.+))?$/i.exec(title || '');
    if (m) {
      fixedDay = dayKey(m[1]);
      mealTitle = m[2] || null;
    }

    // le pagine per pasto (Colazione, Merenda…) proseguono il giorno della pagina precedente
    let day = fixedDay || (mealTitle && mealTitle === prev.mealTitle ? prev.day : null);
    let meal = day && mealTitle ? getMeal(day, mealName(mealTitle)) : null;
    let cat = meal ? meal.categorie.at(-1) || null : null;
    let composite = null;

    if (fixedDay && !mealTitle) {
      // pagina "Piano alimentare - Domenica": giorno libero
      if (page.items.some((i) => isFree(i.str))) plan.giorni[fixedDay].libero = true;
      continue;
    }

    const items = contentItems(page);
    const mid = page.width / 2 - 2;
    const cols = [
      columnLines(items.filter((i) => i.x < mid), starts.left),
      columnLines(items.filter((i) => i.x >= mid), starts.right),
    ];

    for (const line of cols.flat()) {
      const t = line.text;
      const cont = /^\.{2,}\s*continua\s+(.+)$/i.exec(t);
      if (cont) {
        if (!meal) continue;
        const name = clean(cont[1]);
        cat = meal.categorie.findLast((c) => c.nome === name) || addCat(meal, name);
        composite = null;
        continue;
      }
      if (line.rel >= CAT_REL_X && !line.qty) {
        const d = dayKey(t);
        if (d && !fixedDay) {
          day = d;
          meal = getMeal(day, mealName(mealTitle));
          cat = null;
          composite = null;
          continue;
        }
        if (isFree(t)) {
          if (meal) meal.libero = true;
          continue;
        }
        if (!meal) continue;
        cat = addCat(meal, t);
        composite = null;
        continue;
      }
      if (!meal) continue;
      if (!cat) cat = meal.categorie.at(-1) || addCat(meal, 'Alimenti');

      if (line.rel >= INDENT_REL_X && composite) {
        composite.ingredienti.push({ nome: t, qty: line.qty });
        if (line.avoid) composite.evitare = true;
        continue;
      }
      if (!line.qty) {
        composite = { nome: t, qty: null, evitare: line.avoid, ingredienti: [] };
        cat.opzioni.push(composite);
        continue;
      }
      composite = null;
      cat.opzioni.push({ nome: t, qty: line.qty, evitare: line.avoid });
    }
    prev.mealTitle = mealTitle;
    prev.day = day;
  }
}

function addCat(meal, nome) {
  const c = { nome, opzioni: [] };
  meal.categorie.push(c);
  return c;
}

// ---------- Pagine informative ----------

function valueRightOf(items, label) {
  const l = items.find((i) => i.str === label);
  if (!l) return null;
  const cands = items
    .filter((i) => Math.abs(i.y - l.y) <= Y_TOL && i.x > l.x + 1 && !/:$/.test(i.str))
    .sort((p, q) => p.x - q.x);
  return cands[0]?.str ?? null;
}

function parseSummary(page, plan) {
  const it = page.items;
  const name = it.filter((i) => i.size >= 19).sort((p, q) => q.size - p.size)[0];
  plan.meta = {
    paziente: name ? name.str : '',
    visita: valueRightOf(it, 'Visita del:'),
    sesso: valueRightOf(it, 'Sesso:'),
    eta: valueRightOf(it, 'Età:'),
    peso: valueRightOf(it, 'Peso:'),
    altezza: valueRightOf(it, 'Altezza:'),
    bmr: valueRightOf(it, 'BMR'),
    bmi: valueRightOf(it, 'BMI'),
  };

  const header = it.filter((i) => dayKey(i.str) && i.size < 12).sort((p, q) => p.x - q.x);
  const rows = { 'Protidi g': 'protidi', 'Glucidi g': 'glucidi', 'Lipidi g': 'lipidi', 'Totale kcal': 'kcal' };
  for (const [label, key] of Object.entries(rows)) {
    const l = it.find((i) => i.str === label);
    if (!l) continue;
    const vals = it.filter((i) => Math.abs(i.y - l.y) <= Y_TOL && i.x > l.x + 30).sort((p, q) => p.x - q.x);
    vals.forEach((v, idx) => {
      const d = header[idx] ? dayKey(header[idx].str) : GIORNI[idx];
      if (!d) return;
      plan.macro[d] ??= {};
      plan.macro[d][key] = v.str;
    });
  }
}

function parseWeekly(page, plan) {
  const sections = page.items.filter((i) => i.rotated && /pranzo|cena/i.test(i.str)).sort((p, q) => q.y - p.y);
  const names = sections.length ? sections.map((s) => slug(s.str)) : ['pranzo', 'cena'];
  const lines = groupLines(page.items.filter((i) => !i.rotated && i.size >= 9 && i.size < 13));
  let s = 0;
  const seen = new Set();
  for (const l of lines) {
    const first = l.items[0];
    const d = dayKey(first.str);
    if (!d || l.items.length < 2) continue;
    if (seen.has(d)) { s++; seen.clear(); }
    seen.add(d);
    const key = names[s] || `pasto-${s}`;
    plan.settimana[key] ??= {};
    plan.settimana[key][d] = clean(l.items.slice(1).map((i) => i.str).join(' '));
  }
}

function paragraphs(lines) {
  const out = [];
  let prev = null;
  for (const l of lines) {
    const startsNew = !prev || /^(-|\d+\))\s/.test(l.text) || prev.y - l.y > 20 || /[.:;]$/.test(prev.text) && l.x < prev.x - 5;
    if (startsNew) out.push(l.text);
    else out[out.length - 1] = clean(`${out.at(-1)} ${l.text}`);
    prev = l;
  }
  return out;
}

function parseTextPage(page, plan) {
  const items = page.items.filter((i) => !isNoise(i.str) && i.size >= 9);
  const lines = groupLines(items);
  let section = null;
  const body = [];
  const flush = () => {
    if (section) plan.norme.push({ titolo: section, paragrafi: paragraphs(body) });
    body.length = 0;
  };
  for (const l of lines) {
    if (l.items[0].size >= 17) {
      flush();
      section = l.text;
    } else if (section) body.push(l);
  }
  flush();
}

function parseUnits(page, plan) {
  const items = page.items.filter((i) => !isNoise(i.str) && i.size >= 9 && i.size < 15);
  const head = items.find((i) => i.str === 'Alimento');
  const headR = items.find((i) => i.str === 'Unità di misura' && i.size < 15) || items.find((i) => i.y === head?.y && i.x > head.x);
  if (!head || !headR) return;
  const below = items.filter((i) => i.y < head.y - 1);
  const table = below.filter((i) => i.x >= head.x - 2);
  const notes = below.filter((i) => i.x < head.x - 2);
  const ys = [...new Set(table.map((i) => Math.round(i.y)))].sort((p, q) => q - p);
  const groups = [];
  for (const y of ys) {
    const g = groups.at(-1);
    if (g && g.last - y < 16) { g.ys.push(y); g.last = y; } else groups.push({ ys: [y], last: y });
  }
  for (const g of groups) {
    const inG = table.filter((i) => g.ys.includes(Math.round(i.y))).sort((p, q) => q.y - p.y || p.x - q.x);
    const alimento = clean(inG.filter((i) => i.x < headR.x - 2).map((i) => i.str).join(' '));
    const misura = clean(inG.filter((i) => i.x >= headR.x - 2).map((i) => i.str).join(' '));
    if (alimento) plan.unita.push({ alimento, misura });
  }
  const noteText = paragraphs(groupLines(notes)).join(' ');
  if (noteText) {
    const m = /^([A-ZÀ-Ý ]+):\s*(.+)$/.exec(noteText);
    plan.notaLibero = m ? m[2] : noteText;
  }
}

// ---------- Entry point ----------

export async function parsePlan(pdfjs, data) {
  const pages = await readPages(pdfjs, data);
  const plan = {
    versione: 1,
    importedAt: new Date().toISOString(),
    meta: {},
    macro: {},
    settimana: {},
    giorni: Object.fromEntries(GIORNI.map((g) => [g, { libero: false, pasti: [] }])),
    norme: [],
    unita: [],
    notaLibero: null,
  };

  const mealPages = [];
  for (const page of pages) {
    const all = page.items.map((i) => i.str).join(' | ');
    const titles = pageTitle(page).map((t) => t.str);
    if (/Apporti energetici/i.test(all)) parseSummary(page, plan);
    else if (/PIANO ALIMENTARE SETTIMANALE/i.test(all)) parseWeekly(page, plan);
    else if (titles.some((t) => /^Unità di misura$/i.test(t))) parseUnits(page, plan);
    else if (page.items.some((i) => i.size >= 17) && !/PIANO ALIMENTARE PERSONALIZZATO|PIANI ALIMENTARI GIORNALIERI/i.test(all)) parseTextPage(page, plan);
    else if (titles.some((t) => /^Piano alimentare\s*-/i.test(t)) || page.items.some((i) => dayKey(i.str) && i.size < 15)) mealPages.push(page);
  }
  parseMealPages(mealPages, plan);

  // nei giorni liberi mostra comunque tutti i pasti previsti negli altri giorni
  const tutti = new Map();
  for (const g of GIORNI) for (const p of plan.giorni[g].pasti) if (!tutti.has(p.id)) tutti.set(p.id, p.nome);
  for (const g of GIORNI) {
    const day = plan.giorni[g];
    if (day.libero) {
      for (const [id, nome] of tutti) {
        if (!day.pasti.some((p) => p.id === id)) day.pasti.push({ id, nome, libero: true, categorie: [] });
      }
    }
    day.pasti.sort((p, q) => (ORDINE_PASTI[p.id] ?? 45) - (ORDINE_PASTI[q.id] ?? 45));
    for (const p of day.pasti) p.categorie = p.categorie.filter((c) => c.opzioni.length);
    if (day.libero) for (const p of day.pasti) p.libero = true;
    if (day.pasti.length && day.pasti.every((p) => p.libero)) day.libero = true;
  }
  return plan;
}

export function summarize(plan) {
  let categorie = 0;
  let opzioni = 0;
  for (const g of GIORNI) for (const p of plan.giorni[g].pasti) for (const c of p.categorie) {
    categorie++;
    opzioni += c.opzioni.length;
  }
  const giorni = GIORNI.filter((g) => plan.giorni[g].pasti.length || plan.giorni[g].libero).length;
  return { giorni, categorie, opzioni };
}
