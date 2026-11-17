import { MODULES } from '../modules.js';
import { esc, nf, nf1 } from '../utils.js';

const LABEL = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function fmtDay(iso, withYear = false) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`;
}
const n0 = (v) => (v == null ? '–' : nf.format(v));
const n1 = (v) => (v == null ? '–' : nf1.format(v));

// Baris ringkasan sama seperti bagian atas spreadsheet.
export function summaryRows(cols, day, prevDay) {
  const r = [];
  if (prevDay) r.push([`Pcs/Jam ${fmtDay(prevDay)}`, ...cols.map((c) => n1(c.pcsPrev))]);
  r.push([`Pcs/Jam ${fmtDay(day)}`, ...cols.map((c) => n1(c.pcsNow))]);
  r.push(['Total Output (Pcs)', ...cols.map((c) => n0(c.totalOutput))]);
  r.push(['Working Days', ...cols.map((c) => (c.workDays == null ? '–' : 'Day ' + c.workDays))]);
  r.push(['Total Operator', ...cols.map((c) => (c.operators == null ? '–' : c.operators + ' Orang'))]);
  r.push([`Production Target (${fmtDay(day)})`, ...cols.map((c) => (c.target == null ? '–' : n1(c.target) + ' Pcs/Jam'))]);
  r.push([`Stock Days (${fmtDay(day)})`, ...cols.map((c) => (c.stockDays == null ? '–' : n1(c.stockDays) + ' Days'))]);
  r.push(['Stock Qty (Pcs)', ...cols.map((c) => n0(c.stock))]);
  r.push(['Balance Days', ...cols.map((c) => (c.balDays == null ? '–' : n1(c.balDays) + ' Days'))]);
  r.push(['Expected Finish Date', ...cols.map((c) => fmtDay(c.finish, true))]);
  return r;
}

export const DAILY_HEAD = ['Tanggal', 'Modul', 'Sched. Output', 'P.Qty', 'Target', 'Output/Day', 'Total Output', 'Total Input', 'Balance', 'W/H', 'Pcs/Jam', 'Stock Qty', 'Working Days', 'Balance Days', 'Expected Finish'];
export function dailyRows(result, days) {
  const out = [];
  [...days].reverse().forEach((day) => {
    result.mods.forEach((k, i) => {
      const c = result.rows[day][k];
      out.push([i === 0 ? fmtDay(day, true) : '', LABEL[k] || k, fmtDay(c.sched), n0(c.pqty), n1(c.target.value), n0(c.out.value), n0(c.cumOut), n0(c.input.value), n0(c.balance), n1(c.wh.value), n1(c.pcsH), n0(c.stock.value), c.workDays, n1(c.balDays), fmtDay(c.finish, true)]);
    });
  });
  return out;
}

const TD = 'border:1px solid #cbd5e1;padding:4px 8px;';
const TH = TD + 'background:#1d4ed8;color:#ffffff;font-weight:bold;text-align:center;';

export function buildEmail(m) {
  const { line, buyer, style, item, day, prevDay, cols, note, result, days, includeDaily, mods } = m;
  const head = [['LINE', line], ['BUYER', buyer], ['STYLE', style], ['ITEM', item], ['DATE', fmtDay(day, true)]];
  const sum = summaryRows(cols, day, prevDay);
  const subject = `Action Plan Report - Line ${line} - Style ${style} - ${fmtDay(day, true)}`;

  let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0f172a">`;
  html += `<p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:#1d4ed8">ACTION PLAN REPORT</p>`;
  html += `<table style="border-collapse:collapse;margin-bottom:10px">` +
    head.map(([k, v]) => `<tr><td style="padding:1px 12px 1px 0;font-weight:bold">${esc(k)}</td><td style="padding:1px 0">: ${esc(v || '–')}</td></tr>`).join('') + `</table>`;
  html += `<table style="border-collapse:collapse"><tr><th style="${TH}text-align:left">Module</th>` +
    mods.map((k) => `<th style="${TH}">${esc(LABEL[k] || k)}</th>`).join('') + `</tr>` +
    sum.map((r) => `<tr><td style="${TD}font-weight:bold;background:#eff6ff;white-space:nowrap">${esc(r[0])}</td>` +
      r.slice(1).map((v) => `<td style="${TD}text-align:center">${esc(v)}</td>`).join('') + `</tr>`).join('') + `</table>`;
  if (note && note.trim()) {
    html += `<p style="margin:12px 0 4px;font-weight:bold">Action plan / catatan</p><p style="margin:0;white-space:pre-wrap">${esc(note.trim())}</p>`;
  }
  if (includeDaily) {
    html += `<p style="margin:14px 0 4px;font-weight:bold">Detail harian</p><table style="border-collapse:collapse"><tr>` +
      DAILY_HEAD.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('') + `</tr>` +
      dailyRows(result, days).map((r) => `<tr>` + r.map((v, i) => `<td style="${TD}${i < 2 ? '' : 'text-align:right'}">${esc(v)}</td>`).join('') + `</tr>`).join('') + `</table>`;
  }
  html += `</div>`;

  let text = 'ACTION PLAN REPORT\n' + head.map(([k, v]) => `${k}: ${v || '–'}`).join('\n') + '\n\n';
  text += ['Module', ...mods.map((k) => LABEL[k] || k)].join('\t') + '\n' + sum.map((r) => r.join('\t')).join('\n');
  if (note && note.trim()) text += '\n\nAction plan / catatan:\n' + note.trim();
  if (includeDaily) text += '\n\nDetail harian\n' + DAILY_HEAD.join('\t') + '\n' + dailyRows(result, days).map((r) => r.join('\t')).join('\n');
  return { html, text, subject };
}
