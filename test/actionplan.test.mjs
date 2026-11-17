import assert from 'node:assert/strict';
import { computePlan, summarize, addWorkdays } from '../src/lib/actionplan.js';

// Angka dari spreadsheet: P.Qty 5904, target 45, W/H 8, target jadwal 328/hari.
const plan = { pqty: 5904, sched_target: 328, target: 45, wh: 8 };
const d = new Map();
const put = (day, m, output, operators = 0) => d.set(day + '|' + m, { output, operators });
put('2026-11-02', 'BACKSLEEVE', 153);
put('2026-11-03', 'PART', 130); put('2026-11-03', 'FRONT', 320); put('2026-11-03', 'BACKSLEEVE', 353);
put('2026-11-04', 'PART', 350); put('2026-11-04', 'FRONT', 320); put('2026-11-04', 'BACKSLEEVE', 353);
put('2026-11-04', 'JOIN', 318); put('2026-11-04', 'ASSEMBLY', 270); put('2026-11-04', 'QCEND', 127);
put('2026-11-05', 'PART', 340); put('2026-11-05', 'JOIN', 351); put('2026-11-05', 'ASSEMBLY', 348); put('2026-11-05', 'QCEND', 362);
const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const r = computePlan({ plan, modules: ['PART', 'FRONT', 'BACKSLEEVE', 'JOIN', 'ASSEMBLY', 'QCEND'], days, daily: d, overrides: new Map() });
const c = (day, m) => r.rows[day][m];
const round1 = (v) => Math.round(v * 10) / 10;

// Total Output kumulatif, balance, pcs/jam (cocok dengan baris sheet)
assert.equal(c('2026-11-03', 'BACKSLEEVE').cumOut, 506);
assert.equal(c('2026-11-04', 'BACKSLEEVE').cumOut, 859);
assert.equal(c('2026-11-04', 'PART').cumOut, 480);
assert.equal(c('2026-11-04', 'PART').balance, 5424);
assert.equal(round1(c('2026-11-03', 'PART').pcsH), 16.3);
// Working days
assert.equal(c('2026-11-03', 'BACKSLEEVE').workDays, 2);
assert.equal(c('2026-11-04', 'JOIN').workDays, 1);
// Total Input otomatis dari modul hulu
assert.equal(c('2026-11-04', 'JOIN').input.value, 480);       // min(PART 480, FRONT 640, BACK 859)
assert.equal(c('2026-11-04', 'ASSEMBLY').input.value, 318);   // output JOIN
assert.equal(c('2026-11-05', 'ASSEMBLY').input.value, 669);
assert.equal(c('2026-11-05', 'QCEND').input.value, 618);
// Balance Days: hari ke-1 pakai target jadwal, hari ke-2+ pakai output hari itu
assert.equal(round1(c('2026-11-03', 'PART').balDays), 17.6);
assert.equal(round1(c('2026-11-04', 'JOIN').balDays), 17.0);
assert.equal(round1(c('2026-11-04', 'PART').balDays), 15.5);
// Catatan: sheet menulis Total Output PART 5 Nov = 838, tetapi jumlah harian 130+350+340 = 820.
// Aplikasi memakai jumlah harian (820), jadi balance 5084 dan balance days 15,0.
assert.equal(c('2026-11-05', 'PART').cumOut, 820);
assert.equal(round1(c('2026-11-05', 'PART').balDays), 15);
// Expected finish: hari kerja Senin-Sabtu (contoh dari header sheet: 17 Nov + 6,8 hari -> 25 Nov)
assert.equal(addWorkdays('2026-11-17', 7), '2026-11-25');
assert.equal(addWorkdays('2026-11-17', 6), '2026-11-24');
assert.equal(addWorkdays('2026-11-17', 8), '2026-11-26');

// Timpaan manual menggantikan nilai otomatis dan ikut menurun ke hilir
const ov = new Map([['2026-11-04|PART', { out: 400 }]]);
const r2 = computePlan({ plan, modules: ['PART', 'FRONT', 'BACKSLEEVE', 'JOIN'], days, daily: d, overrides: ov });
assert.equal(r2.rows['2026-11-04'].PART.out.manual, true);
assert.equal(r2.rows['2026-11-04'].PART.out.auto, 350);
assert.equal(r2.rows['2026-11-04'].PART.cumOut, 530);
assert.equal(r2.rows['2026-11-04'].JOIN.input.value, 530);

// Ringkasan
const s = summarize(r, '2026-11-05', '2026-11-04');
assert.equal(s.find((x) => x.key === 'PART').totalOutput, 820);
assert.equal(round1(s.find((x) => x.key === 'PART').pcsPrev), 43.8);

// Tanpa P.Qty: balance kosong, tidak error
const r3 = computePlan({ plan: {}, modules: ['PART'], days, daily: d, overrides: new Map() });
assert.equal(r3.rows['2026-11-03'].PART.balance, null);
assert.equal(r3.rows['2026-11-03'].PART.finish, null);
console.log('semua uji hitungan lolos');
