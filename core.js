/* 汇丰美元管家 — 纯逻辑模块（浏览器与 Node 通用） */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.Core = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function round2(n) {
    var r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
  }

  function makeISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO(now) {
    var d = now === undefined ? new Date() : new Date(now);
    return makeISO(d);
  }

  function isValidDate(iso) {
    if (typeof iso !== 'string' || !DATE_RE.test(iso)) return false;
    var y = Number(iso.slice(0, 4));
    var m = Number(iso.slice(5, 7));
    var d = Number(iso.slice(8, 10));
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function parseDate(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatDateCN(iso) {
    if (!isValidDate(iso)) return String(iso);
    var d = parseDate(iso);
    return d.getMonth() + 1 + '月' + d.getDate() + '日 周' + WEEK_CN[d.getDay()];
  }

  function formatDateFull(iso) {
    if (!isValidDate(iso)) return String(iso);
    var d = parseDate(iso);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function formatDateShort(iso) {
    if (!isValidDate(iso)) return String(iso);
    return iso.slice(5, 7) + '-' + iso.slice(8, 10);
  }

  function weekdayCN(iso) {
    if (!isValidDate(iso)) return '';
    return '周' + WEEK_CN[parseDate(iso).getDay()];
  }

  /* 解析金额：支持 "1,234.56"、"$1,234"、全角数字、前后空格；非法返回 null */
  function parseAmount(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') {
      return isFinite(input) && input >= 0 ? round2(input) : null;
    }
    if (typeof input !== 'string') return null;

    var s = input;
    try { s = s.normalize('NFKC'); } catch (e) { /* 老浏览器忽略 */ }
    s = s.replace(/，/g, ',').replace(/＄/g, '$').replace(/[￥¥]/g, '');
    // 先去掉所有空白，再处理开头的美元符号，避免 "$ 1,234" 这类输入失败
    s = s.replace(/\s/g, '');
    s = s.replace(/^\$/, '').replace(/,/g, '');
    if (!s) return null;
    if (!/^\d*\.?\d*$/.test(s)) return null;
    if (s === '.') return null;

    var dot = s.indexOf('.');
    if (dot >= 0 && s.length - dot - 1 > 2) return null;

    var n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return round2(n);
  }

  var usdFormatter = null;
  try {
    usdFormatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } catch (e) {
    usdFormatter = null;
  }

  function groupNumber(value, digits) {
    var fixed = Number(value).toFixed(digits);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function formatNumber(value, digits) {
    var d = digits === undefined ? 2 : digits;
    return groupNumber(round2(Number(value) || 0), d);
  }

  function formatUSD(value) {
    var v = round2(Number(value) || 0);
    var sign = v < 0 ? '-' : '';
    var abs = Math.abs(v);
    var body = usdFormatter ? usdFormatter.format(abs) : groupNumber(abs, 2);
    return sign + '$' + body;
  }

  function formatSignedUSD(value) {
    var v = round2(Number(value) || 0);
    return (v >= 0 ? '+' : '-') + formatUSD(Math.abs(v));
  }

  function formatCompact(value) {
    var v = Number(value) || 0;
    var a = Math.abs(v);
    var sign = v < 0 ? '-' : '';
    function trim(x) {
      var r = Math.round(x * 10) / 10;
      return r % 1 === 0 ? String(r) : r.toFixed(1);
    }
    if (a >= 1e6) return sign + '$' + trim(a / 1e6) + 'M';
    if (a >= 1e3) return sign + '$' + trim(a / 1e3) + 'k';
    return sign + '$' + Math.round(a);
  }

  function formatSignedCompact(value) {
    var v = round2(Number(value) || 0);
    return (v >= 0 ? '+' : '-') + formatCompact(Math.abs(v));
  }

  function total(record) {
    if (!record) return 0;
    return round2((Number(record.savings) || 0) + (Number(record.investment) || 0));
  }

  /* 把任意步长“约”成好看的数字：1、2、2.5、5 × 10^n */
  function niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    var exp = Math.floor(Math.log(raw) / Math.LN10);
    var base = Math.pow(10, exp);
    var f = raw / base;
    var m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return m * base;
  }

  /* 为图表计算“整齐”的坐标轴：返回 min/max/step/ticks */
  function niceAxis(min, max, targetTicks) {
    var wanted = targetTicks || 3;
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, step: 0.5, ticks: [0, 0.5, 1] };
    if (max === min) max = min + Math.max(1, Math.abs(min) * 0.1);
    var step = niceStep((max - min) / wanted);
    var axisMin = Math.floor(min / step) * step;
    var axisMax = Math.ceil(max / step) * step;
    var guard = 0;
    while ((axisMax - axisMin) / step > 6 && guard++ < 12) {
      step = niceStep(step * 1.5);
      axisMin = Math.floor(min / step) * step;
      axisMax = Math.ceil(max / step) * step;
    }
    var count = Math.round((axisMax - axisMin) / step);
    var ticks = [];
    for (var i = 0; i <= count; i++) ticks.push(round2(axisMin + i * step));
    return { min: round2(axisMin), max: round2(axisMax), step: step, ticks: ticks };
  }

  function sortRecords(records) {
    return records.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  /* 规范化单条记录；无效返回 null。空字符串视为 0，但两个都空则无效。 */
  function normalizeRecord(input) {
    if (!input || typeof input !== 'object') return null;
    var date = typeof input.date === 'string' ? input.date.trim() : '';
    if (!isValidDate(date)) return null;

    var sRaw = input.savings;
    var iRaw = input.investment;
    var sEmpty = sRaw === undefined || sRaw === null || sRaw === '';
    var iEmpty = iRaw === undefined || iRaw === null || iRaw === '';
    if (sEmpty && iEmpty) return null;

    var s = sEmpty ? 0 : parseAmount(sRaw);
    var inv = iEmpty ? 0 : parseAmount(iRaw);
    if (s === null || inv === null) return null;

    var note = typeof input.note === 'string' ? input.note.trim().slice(0, 80) : '';
    var updatedAt = Number(input.updatedAt);
    return {
      date: date,
      savings: s,
      investment: inv,
      note: note,
      updatedAt: isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0
    };
  }

  function normalizeRecords(list) {
    var map = {};
    var skipped = 0;
    (Array.isArray(list) ? list : []).forEach(function (item) {
      var rec = normalizeRecord(item);
      if (!rec) {
        skipped++;
        return;
      }
      var prev = Object.prototype.hasOwnProperty.call(map, rec.date) ? map[rec.date] : null;
      if (!prev || (rec.updatedAt || 0) >= (prev.updatedAt || 0)) map[rec.date] = rec;
    });
    var records = Object.keys(map).map(function (key) { return map[key]; });
    return { records: sortRecords(records), skipped: skipped };
  }

  function upsertRecord(records, record) {
    var out = records.filter(function (r) { return r.date !== record.date; });
    out.push(record);
    return sortRecords(out);
  }

  function removeRecord(records, date) {
    return records.filter(function (r) { return r.date !== date; });
  }

  function recordFor(records, date) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].date === date) return records[i];
    }
    return null;
  }

  function latestRecord(records) {
    return records.length ? records[records.length - 1] : null;
  }

  function previousRecord(records, date) {
    var prev = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].date < date) prev = records[i];
      else break;
    }
    return prev;
  }

  function computeDelta(current, previous) {
    if (!current || !previous) return null;
    var c = total(current);
    var p = total(previous);
    var abs = round2(c - p);
    var pct = p > 0 ? (abs / p) * 100 : null;
    return { abs: abs, pct: pct };
  }

  /* 按“最近 N 天（含今天）”筛选；range 为 all 时返回全部 */
  function filterByRange(records, range, today) {
    var list = sortRecords(records);
    if (range === 'all') return list;
    var n = Number(range);
    if (!isFinite(n) || n <= 0) return list;
    var endISO = isValidDate(today) ? today : todayISO();
    var end = parseDate(endISO);
    var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (n - 1));
    var startISO = makeISO(start);
    return list.filter(function (r) { return r.date >= startISO && r.date <= endISO; });
  }

  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  var CSV_HEADER = ['日期', '储蓄美元账户', '投资美元账户', '合计', '备注'];

  function toCSV(records) {
    var rows = [CSV_HEADER.join(',')];
    sortRecords(records).forEach(function (r) {
      rows.push([
        r.date,
        Number(r.savings).toFixed(2),
        Number(r.investment).toFixed(2),
        total(r).toFixed(2),
        csvCell(r.note || '')
      ].join(','));
    });
    return '\ufeff' + rows.join('\r\n') + '\r\n';
  }

  function toBackup(records, exportedAt) {
    return JSON.stringify({
      app: 'hsbc-usd-tracker',
      version: 1,
      exportedAt: exportedAt || new Date().toISOString(),
      records: sortRecords(records).map(function (r) {
        return {
          date: r.date,
          savings: r.savings,
          investment: r.investment,
          note: r.note || ''
        };
      })
    }, null, 2);
  }

  function parseBackup(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: '文件不是有效的 JSON' };
    }
    var list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.records)) list = data.records;
    if (!list) return { ok: false, error: '备份格式不正确：找不到 records 列表' };

    var normalized = normalizeRecords(list);
    if (!normalized.records.length) return { ok: false, error: '备份里没有可用的记录' };
    return { ok: true, records: normalized.records, skipped: normalized.skipped };
  }

  /* 备份恢复：同日期以导入的数据为准 */
  function mergeRecords(base, incoming) {
    var map = {};
    sortRecords(base).forEach(function (r) { map[r.date] = r; });
    var added = 0;
    var updated = 0;
    incoming.forEach(function (r) {
      if (map[r.date]) updated++;
      else added++;
      map[r.date] = r;
    });
    var out = Object.keys(map).map(function (k) { return map[k]; });
    return { records: sortRecords(out), added: added, updated: updated };
  }

  return {
    isValidDate: isValidDate,
    todayISO: todayISO,
    makeISO: makeISO,
    parseDate: parseDate,
    formatDateCN: formatDateCN,
    formatDateFull: formatDateFull,
    formatDateShort: formatDateShort,
    weekdayCN: weekdayCN,
    parseAmount: parseAmount,
    round2: round2,
    formatNumber: formatNumber,
    formatUSD: formatUSD,
    formatSignedUSD: formatSignedUSD,
    formatCompact: formatCompact,
    formatSignedCompact: formatSignedCompact,
    total: total,
    niceStep: niceStep,
    niceAxis: niceAxis,
    sortRecords: sortRecords,
    normalizeRecord: normalizeRecord,
    normalizeRecords: normalizeRecords,
    upsertRecord: upsertRecord,
    removeRecord: removeRecord,
    recordFor: recordFor,
    latestRecord: latestRecord,
    previousRecord: previousRecord,
    computeDelta: computeDelta,
    filterByRange: filterByRange,
    toCSV: toCSV,
    toBackup: toBackup,
    parseBackup: parseBackup,
    mergeRecords: mergeRecords
  };
});
