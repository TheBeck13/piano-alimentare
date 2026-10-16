// Verifica il parser sul PDF di esempio: node tools/check-parser.mjs [percorso.pdf] [--dump]
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePlan, summarize } from '../js/parser.js';

const file = process.argv.find((a) => a.endsWith('.pdf')) || 'PianoAlimentare-5.pdf';
const plan = await parsePlan(pdfjs, new Uint8Array(fs.readFileSync(file)));
if (process.argv.includes('--dump')) {
  fs.writeSync(1, JSON.stringify(plan, null, 2) + '\n');
  process.exit(0);
}

let failed = 0;
const check = (desc, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${desc}`);
  if (!ok) failed++;
};
const meal = (d, id) => plan.giorni[d].pasti.find((p) => p.id === id);
const cat = (d, id, nome) => meal(d, id)?.categorie.find((c) => c.nome === nome);
const opt = (d, id, c, nome) => cat(d, id, c)?.opzioni.find((o) => o.nome === nome);

check('7 giorni con contenuto', summarize(plan).giorni === 7);
check('Domenica è giorno libero', plan.giorni.dom.libero === true);
check('Lunedì ha 5 pasti in ordine', meal('lun', 'colazione') && plan.giorni.lun.pasti.map((p) => p.id).join() === 'colazione,meta-mattina,pranzo,merenda,cena');
check('Lun colazione: Pane (3)', cat('lun', 'colazione', 'Pane')?.opzioni.length === 3);
check('Lun colazione: Carne conservata (5)', cat('lun', 'colazione', 'Carne conservata')?.opzioni.length === 5);
check('Gio colazione: Succhi (13, anche dopo "continua")', cat('gio', 'colazione', 'Succhi puri di frutta ed ortaggi')?.opzioni.length === 13);
check('Gio colazione: Formaggi e latticini (18)', cat('gio', 'colazione', 'Formaggi e latticini')?.opzioni.length === 18);
check('Mar colazione: Derivati dei cereali (15)', cat('mar', 'colazione', 'Derivati dei cereali')?.opzioni.length === 15);
const primi = cat('mar', 'pranzo', 'Primi vegetariani');
check('Mar pranzo: 19 primi vegetariani da 3 ingredienti', primi?.opzioni.length === 19 && primi.opzioni.every((o) => o.ingredienti?.length === 3));
check('Mar pranzo: Contorni (26)', cat('mar', 'pranzo', 'Contorni')?.opzioni.length === 26);
check('Crackers salati da evitare', opt('mar', 'meta-mattina', 'Crackers e gallette', 'Crackers salati')?.evitare === true);
check('Crackers non salati non da evitare', opt('mar', 'meta-mattina', 'Crackers e gallette', 'Crackers non salati')?.evitare === false);
check('Riga a capo unita (Fiocchi … al cioccolato g 30)', opt('lun', 'meta-mattina', 'Derivati dei cereali farciti', 'Fiocchi di frumento integrale al cioccolato')?.qty === 'g 30');
check('Riga a capo con quantità sotto (Burro di arachidi)', opt('ven', 'colazione', 'Creme spalmabili', 'Burro di arachidi a ridotto contenuto di grassi')?.qty === 'g 20');
check('Yogurt (200 g) 1 bottiglietta', opt('mer', 'meta-mattina', 'Yogurt da latte parz. scremato', 'Yogurt alla frutta da latte parz. scr. (200 g)')?.qty === '1 bottiglietta');
check('Olio 2 cucchiaini e ½', opt('lun', 'pranzo', 'Olio', 'Olio extra vergine di oliva')?.qty === '2 cucchiaini e ½');
check('Uovo n° 2 giovedì', opt('gio', 'pranzo', 'Uova', 'Uovo di gallina')?.qty === 'n° 2');
check('Lun cena: Pane (3, a cavallo di colonna)', cat('lun', 'cena', 'Pane')?.opzioni.length === 3);
const insalata = opt('ven', 'cena', 'Pesce fresco', 'Insalata di mare');
check('Insalata di mare composta da 4', insalata?.ingredienti?.length === 4);
check('Pesce fresco (21 opzioni)', cat('ven', 'cena', 'Pesce fresco')?.opzioni.length === 21);
check('Sab metà mattina: panini composti da 2', cat('sab', 'meta-mattina', 'Panino integrale')?.opzioni.every((o) => o.ingredienti?.length === 2) && cat('sab', 'meta-mattina', 'Panino integrale').opzioni.length === 20);
check('Sab cena: Pizza al piatto (14)', cat('sab', 'cena', 'Pizza al piatto')?.opzioni.length === 14);
check('Dom colazione libera', meal('dom', 'colazione')?.libero === true);
check('Kcal lunedì 1.950', plan.macro.lun?.kcal === '1.950');
check('Proteine domenica 74', plan.macro.dom?.protidi === '74');
check('Schema settimanale 7+7', Object.keys(plan.settimana.pranzo || {}).length === 7 && Object.keys(plan.settimana.cena || {}).length === 7);
check('Schema: giovedì cena', plan.settimana.cena?.gio === 'Carne conservata - Contorni - Mais o patate');
check('Meta: peso, visita, BMI, BMR', /^kg \d/.test(plan.meta.peso) && /^\d{2}\/\d{2}\/\d{4}$/.test(plan.meta.visita) && !!plan.meta.bmi && /^kcal /.test(plan.meta.bmr));
check('Unità di misura (12 righe)', plan.unita.length === 12);
check('Norme generali presenti', plan.norme.some((n) => n.titolo === 'Norme generali'));
check('Nota giorno libero', !!plan.notaLibero);
const nomi = Object.values(plan.giorni).flatMap((g) => g.pasti.flatMap((p) => p.categorie.flatMap((c) => c.opzioni.map((o) => o.nome))));
check('Nessun testo di servizio tra gli alimenti', !nomi.some((n) => /Elaborato|Powered|continua/i.test(n) || n === plan.meta.paziente));

console.log(summarize(plan));
process.exit(failed ? 1 : 0);
