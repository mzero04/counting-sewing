import { MODULES } from '../modules.js';

// Modul yang tampil di Action Plan jika belum diatur (sesuai spreadsheet).
export const DEFAULT_AP_MODULES = ['PART', 'FRONT', 'BACKSLEEVE', 'JOIN', 'ASSEMBLY', 'QCEND'];
const ORDER = MODULES.map((m) => m.key);

// Total Input otomatis = output kumulatif modul sebelumnya (yang terkecil jika lebih dari satu).
// Modul awal (PART, FRONT, BACKSLEEVE) tidak punya hulu, jadi Total Input diisi manual.
const UPSTREAM = {
  JOIN: ['PART', 'HOOD', 'FRONT', 'BACKSLEEVE'],
  ASSEMBLY: ['JOIN'],
  QCEND: ['ASSEMBLY']
};

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Tambah n hari kerja (Senin-Sabtu, hari Minggu libur).
export function addWorkdays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  let left = Math.max(0, n);
  while (left > 0) { dt.setDate(dt.getDate() + 1); if (dt.getDay() !== 0) left--; }
  return iso(dt);
}

export function orderModules(keys) { return ORDER.filter((k) => keys.includes(k)); }

/**
 * plan:      baris action_plans (atau {} jika belum ada)
 * modules:   kunci modul yang dipakai
 * days:      tanggal ISO, urut naik
 * daily:     Map "tanggal|MODUL" -> {output, operators}   (dari counting)
 * overrides: Map "tanggal|MODUL" -> {out,input,stock,wh,target,operators}   (manual)
 * Mengembalikan {mods, rows: {tanggal: {MODUL: sel}}}; tiap nilai yang bisa diedit berbentuk
 * {value, auto, manual}.
 */
export function computePlan({ plan, modules, days, daily, overrides }) {
  plan = plan || {};
  const P = {
    pqty: num(plan.pqty),
    schedTarget: num(plan.sched_target),
    schedTargetH: num(plan.sched_target_h),
    target: num(plan.target) ?? 45,
    wh: num(plan.wh) ?? 8,
    sched: plan.module_sched || {}
  };
  const mods = orderModules(modules);
  const cum = {}, wd = {};
  mods.forEach((k) => { cum[k] = 0; wd[k] = 0; });
  const rows = {};

  for (const day of days) {
    rows[day] = {};
    for (const k of mods) {
      const dv = daily.get(day + '|' + k) || {};
      const ov = overrides.get(day + '|' + k) || {};
      const pick = (key, auto) => (ov[key] != null ? { value: ov[key], auto, manual: true } : { value: auto, auto, manual: false });

      const out = pick('out', num(dv.output) ?? 0);
      cum[k] += out.value;
      if (out.value > 0) wd[k]++;

      const ups = (UPSTREAM[k] || []).filter((u) => mods.includes(u));
      const input = pick('input', ups.length ? Math.min(...ups.map((u) => cum[u])) : null);
      const wh = pick('wh', P.wh);
      const target = pick('target', P.target);
      const operators = pick('operators', num(dv.operators) ?? 0);
      const stock = pick('stock', input.value != null ? Math.max(0, input.value - cum[k]) : 0);

      const perDay = target.value * wh.value;
      const balance = P.pqty == null ? null : P.pqty - cum[k];
      const schedDay = P.schedTarget ?? (perDay > 0 ? perDay : null);
      // Hari kedua dan seterusnya memakai kecepatan output hari itu; sebelumnya memakai target jadwal.
      const denom = wd[k] >= 2 && out.value > 0 ? out.value : schedDay;
      let balDays = null;
      if (balance != null) balDays = balance <= 0 ? 0 : (denom > 0 ? balance / denom : null);
      const finish = balDays == null ? null : addWorkdays(day, Math.ceil(balDays - 1e-9));

      rows[day][k] = {
        sched: P.sched[k] || null,
        pqty: P.pqty,
        schedTarget: P.schedTarget,
        schedTargetH: P.schedTargetH ?? (P.schedTarget != null && wh.value > 0 ? P.schedTarget / wh.value : null),
        target, out, input, wh, stock, operators,
        cumOut: cum[k],
        balance,
        pcsH: wh.value > 0 ? out.value / wh.value : null,
        stockDays: perDay > 0 ? stock.value / perDay : null,
        workDays: wd[k],
        balDays,
        finish
      };
    }
  }
  return { mods, rows };
}

// Ringkasan laporan untuk satu tanggal (dan hari sebelumnya untuk pembanding pcs/jam).
export function summarize(result, day, prevDay) {
  const cols = result.mods.map((k) => {
    const c = result.rows[day]?.[k];
    const p = prevDay ? result.rows[prevDay]?.[k] : null;
    return {
      key: k,
      pcsPrev: p ? p.pcsH : null,
      pcsNow: c ? c.pcsH : null,
      totalOutput: c ? c.cumOut : null,
      workDays: c ? c.workDays : null,
      operators: c ? c.operators.value : null,
      target: c ? c.target.value : null,
      stockDays: c ? c.stockDays : null,
      stock: c ? c.stock.value : null,
      balDays: c ? c.balDays : null,
      finish: c ? c.finish : null
    };
  });
  return cols;
}
