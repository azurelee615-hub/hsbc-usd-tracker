/* 汇丰美元管家 — 交互逻辑 */
(function () {
  'use strict';

  var Core = window.Core;
  if (!Core) return;

  var STORE_KEY = 'hsbc-usd-tracker:v1';
  var TIP_KEY = 'hsbc-usd-tracker:tip-dismissed';
  var HISTORY_PAGE = 12;

  var els = {};
  var state = {
    records: [],
    selectedDate: Core.todayISO(),
    chartRange: '30',
    showSavings: true,
    showInvestment: true,
    historyLimit: HISTORY_PAGE
  };

  var chartPoints = [];
  var modalResolve = null;
  var toastTimer = null;
  var tooltipTimer = null;

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    [
      'todayLine', 'todayPill', 'installTip', 'dismissInstall', 'formCard', 'formHint',
      'savings', 'investment', 'date', 'note', 'liveTotal', 'saveBtn', 'deleteBtn', 'formMsg',
      'statTotal', 'statTotalDate', 'statDelta', 'statDeltaSub', 'statDays',
      'chart', 'chartWrap', 'chartEmpty', 'tooltip', 'rangeSeg',
      'historyList', 'historyEmpty', 'historyCount', 'moreBtn',
      'exportCsv', 'exportJson', 'importBtn', 'importFile', 'clearBtn',
      'toast', 'modal', 'modalTitle', 'modalMessage', 'modalOk', 'modalCancel'
    ].forEach(function (id) { els[id] = $(id); });
  }

  /* ---------------- 本地存储 ---------------- */

  function loadRecords() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      var list = data && Array.isArray(data.records)
        ? data.records
        : (Array.isArray(data) ? data : []);
      return Core.normalizeRecords(list).records;
    } catch (e) {
      console.warn('读取本地数据失败', e);
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, records: state.records }));
    } catch (e) {
      toast('无法写入本地存储，请先导出备份');
    }
  }

  /* ---------------- 渲染 ---------------- */

  function signedClass(value) {
    return value > 0 ? 'up' : value < 0 ? 'down' : '';
  }

  function renderHeader() {
    var today = Core.todayISO();
    els.todayLine.textContent = '今天 · ' + Core.formatDateCN(today);
    var rec = Core.recordFor(state.records, today);
    els.todayPill.textContent = rec ? '今日已记录' : '今日未记录';
    els.todayPill.className = 'pill ' + (rec ? 'ok' : 'warn');
    els.date.max = today;
  }

  function renderStats() {
    var latest = Core.latestRecord(state.records);
    if (!latest) {
      els.statTotal.textContent = '—';
      els.statTotal.title = '';
      els.statTotalDate.textContent = '还没有记录';
      els.statDelta.textContent = '—';
      els.statDelta.className = 'stat-value';
      els.statDelta.title = '';
      els.statDeltaSub.textContent = '—';
      els.statDays.textContent = '0';
      return;
    }

    var latestTotal = Core.formatUSD(Core.total(latest));
    els.statTotal.textContent = latestTotal;
    els.statTotal.title = latestTotal;
    els.statTotalDate.textContent = Core.formatDateShort(latest.date) + ' 记录';

    var prev = Core.previousRecord(state.records, latest.date);
    var delta = Core.computeDelta(latest, prev);
    if (delta) {
      els.statDelta.textContent = Core.formatSignedUSD(delta.abs);
      els.statDelta.title = Core.formatSignedUSD(delta.abs);
      els.statDelta.className = 'stat-value ' + signedClass(delta.abs);
      var sub = '较 ' + Core.formatDateShort(prev.date);
      if (delta.pct !== null) {
        sub += ' · ' + (delta.pct >= 0 ? '+' : '-') + Math.abs(delta.pct).toFixed(1) + '%';
      }
      els.statDeltaSub.textContent = sub;
    } else {
      els.statDelta.textContent = '—';
      els.statDelta.className = 'stat-value';
      els.statDeltaSub.textContent = '暂无对比';
    }

    els.statDays.textContent = String(state.records.length);
  }

  function clearFormMessage() {
    els.formMsg.textContent = '';
  }

  function setFormMessage(message) {
    els.formMsg.textContent = message || '';
  }

  function markInvalid(input) {
    var wrap = input.closest('.input-wrap');
    if (wrap) wrap.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
  }

  function clearInvalid() {
    ['savings', 'investment'].forEach(function (key) {
      var input = els[key];
      var wrap = input.closest('.input-wrap');
      if (wrap) wrap.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
    });
  }

  function formatInputValue(value) {
    return String(Core.round2(value));
  }

  function currentAmounts() {
    var rawS = els.savings.value.trim();
    var rawI = els.investment.value.trim();
    return {
      savings: rawS === '' ? 0 : Core.parseAmount(rawS),
      investment: rawI === '' ? 0 : Core.parseAmount(rawI)
    };
  }

  function updateLiveTotal() {
    var amounts = currentAmounts();
    var sum = (amounts.savings || 0) + (amounts.investment || 0);
    els.liveTotal.textContent = Core.formatUSD(sum);
  }

  function syncForm(date) {
    var rec = Core.recordFor(state.records, date);
    state.selectedDate = date;
    els.date.value = date;
    els.savings.value = rec ? formatInputValue(rec.savings) : '';
    els.investment.value = rec ? formatInputValue(rec.investment) : '';
    els.note.value = rec ? rec.note : '';
    els.saveBtn.textContent = rec ? '更新记录' : '保存记录';
    els.deleteBtn.classList.toggle('hidden', !rec);
    els.formHint.textContent = rec ? '已有记录，保存会更新' : '美元账户余额（USD）';
    clearFormMessage();
    clearInvalid();
    updateLiveTotal();
  }

  function renderChart() {
    var svg = els.chart;
    var recs = Core.filterByRange(state.records, state.chartRange, Core.todayISO());
    var hasData = recs.length > 0;

    els.chartEmpty.classList.toggle('hidden', hasData);
    els.chartEmpty.textContent = state.records.length
      ? '这个时间范围内还没有数据，切换到「全部」看看。'
      : '还没有数据，先记录一次吧。';
    svg.classList.toggle('hidden', !hasData);

    if (!hasData) {
      svg.innerHTML = '';
      chartPoints = [];
      hideTooltip();
      return;
    }

    var W = 360;
    var H = 200;
    var padL = 50;
    var padR = 18;
    var padT = 16;
    var padB = 26;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var n = recs.length;

    var xs = recs.map(function (_, i) {
      return n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1);
    });

    var series = [
      {
        values: recs.map(function (r) { return r.savings; }),
        css: 'var(--chart-savings)',
        width: 1.6,
        show: state.showSavings
      },
      {
        values: recs.map(function (r) { return r.investment; }),
        css: 'var(--chart-investment)',
        width: 1.6,
        show: state.showInvestment
      },
      {
        values: recs.map(function (r) { return Core.total(r); }),
        css: 'var(--chart-total)',
        width: 2.6,
        show: true
      }
    ].filter(function (s) { return s.show; });

    var values = [];
    series.forEach(function (s) { values = values.concat(s.values); });
    var vmin = Math.min.apply(null, values);
    var vmax = Math.max.apply(null, values);

    // 先按数据范围留一点点边距，再取“整齐”的坐标轴刻度
    var rawSpan = vmax - vmin;
    var padAmount = rawSpan === 0 ? Math.max(1, Math.abs(vmax) * 0.05) : rawSpan * 0.02;
    var axis = Core.niceAxis(vmin - padAmount, vmax + padAmount, 3);
    if (vmin >= 0 && axis.min < 0) axis = Core.niceAxis(0, vmax + padAmount, 3);
    var min = axis.min;
    var max = axis.max;

    function yOf(value) {
      return padT + plotH * (1 - (value - min) / (max - min));
    }

    var parts = [];
    parts.push('<defs><linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" style="stop-color:var(--chart-total);stop-opacity:0.18"></stop>' +
      '<stop offset="100%" style="stop-color:var(--chart-total);stop-opacity:0"></stop>' +
      '</linearGradient></defs>');

    axis.ticks.forEach(function (gridValue, index) {
      var gridY = yOf(gridValue);
      parts.push('<line x1="' + padL + '" y1="' + gridY.toFixed(1) + '" x2="' + (W - padR) +
        '" y2="' + gridY.toFixed(1) + '" style="stroke:var(--chart-grid);stroke-width:1;stroke-dasharray:' +
        (index === 0 ? '0' : '3 4') + '"></line>');
      parts.push('<text x="' + (padL - 8) + '" y="' + (gridY + 3.5).toFixed(1) +
        '" text-anchor="end" style="fill:var(--chart-label);font-size:10px;font-variant-numeric:tabular-nums">' +
        Core.formatCompact(gridValue) + '</text>');
    });

    if (n > 1) {
      var area = 'M' + xs[0].toFixed(2) + ',' + (padT + plotH).toFixed(2);
      recs.forEach(function (r, i) {
        area += ' L' + xs[i].toFixed(2) + ',' + yOf(Core.total(r)).toFixed(2);
      });
      area += ' L' + xs[n - 1].toFixed(2) + ',' + (padT + plotH).toFixed(2) + ' Z';
      parts.push('<path d="' + area + '" fill="url(#chartAreaGrad)"></path>');
    }

    series.forEach(function (s) {
      var d = '';
      s.values.forEach(function (value, i) {
        d += (i ? ' L' : 'M') + xs[i].toFixed(2) + ',' + yOf(value).toFixed(2);
      });
      parts.push('<path d="' + d + '" fill="none" style="stroke:' + s.css + ';stroke-width:' +
        s.width + ';stroke-linecap:round;stroke-linejoin:round"></path>');
    });

    chartPoints = recs.map(function (r, i) {
      return { x: xs[i], y: yOf(Core.total(r)), rec: r };
    });

    chartPoints.forEach(function (p) {
      parts.push('<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="3" ' +
        'style="fill:var(--card);stroke:var(--chart-total);stroke-width:2"></circle>');
    });

    var labelIndexes = [];
    if (n === 1) {
      labelIndexes = [0];
    } else {
      var count = Math.min(4, n);
      for (var j = 0; j < count; j++) {
        labelIndexes.push(Math.round(((n - 1) * j) / (count - 1)));
      }
      labelIndexes = labelIndexes.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
    }

    labelIndexes.forEach(function (index) {
      var anchor = index === 0 ? 'start' : index === n - 1 ? 'end' : 'middle';
      parts.push('<text x="' + xs[index].toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor +
        '" style="fill:var(--chart-label);font-size:9.5px;font-variant-numeric:tabular-nums">' +
        Core.formatDateShort(recs[index].date) + '</text>');
    });

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = parts.join('');
  }

  function hideTooltip() {
    els.tooltip.classList.add('hidden');
    els.tooltip.setAttribute('aria-hidden', 'true');
  }

  function showTooltipAt(clientX) {
    if (!chartPoints.length) return;
    var rect = els.chart.getBoundingClientRect();
    if (!rect.width) return;

    var vx = ((clientX - rect.left) / rect.width) * 360;
    var best = 0;
    var bestDistance = Infinity;
    chartPoints.forEach(function (p, i) {
      var distance = Math.abs(p.x - vx);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });

    var p = chartPoints[best];
    var left = Math.min(84, Math.max(16, (p.x / 360) * 100));
    var top = Math.max(12, (p.y / 200) * 100);

    els.tooltip.style.left = left + '%';
    els.tooltip.style.top = top + '%';
    els.tooltip.innerHTML = '<strong>' + Core.formatDateCN(p.rec.date) + '</strong>' +
      '<span class="tt-total">' + Core.formatUSD(Core.total(p.rec)) + '</span><br>' +
      '储蓄 ' + Core.formatNumber(p.rec.savings) + ' · 投资 ' + Core.formatNumber(p.rec.investment);
    els.tooltip.classList.remove('hidden');
    els.tooltip.setAttribute('aria-hidden', 'false');
  }

  function renderHistory() {
    var list = els.historyList;
    list.innerHTML = '';

    var count = state.records.length;
    els.historyEmpty.classList.toggle('hidden', count > 0);
    els.historyCount.textContent = count ? count + ' 天' : '';
    els.moreBtn.classList.toggle('hidden', count <= state.historyLimit);
    els.moreBtn.textContent = '显示更早的记录（还有 ' + Math.max(0, count - state.historyLimit) + ' 天）';

    var shown = state.records.slice().reverse().slice(0, state.historyLimit);

    shown.forEach(function (rec) {
      var prev = Core.previousRecord(state.records, rec.date);
      var delta = Core.computeDelta(rec, prev);

      var item = document.createElement('li');
      item.className = 'history-item';
      item.dataset.date = rec.date;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', '编辑 ' + Core.formatDateFull(rec.date) + ' 的记录');

      var left = document.createElement('div');
      left.className = 'hi-left';

      var dateLine = document.createElement('div');
      dateLine.className = 'hi-date';
      dateLine.textContent = Core.formatDateShort(rec.date) + ' ' + Core.weekdayCN(rec.date);
      if (delta) {
        var deltaEl = document.createElement('span');
        deltaEl.className = 'hi-delta ' + signedClass(delta.abs);
        deltaEl.textContent = Core.formatSignedCompact(delta.abs);
        dateLine.appendChild(deltaEl);
      }
      left.appendChild(dateLine);

      if (rec.note) {
        var noteEl = document.createElement('span');
        noteEl.className = 'hi-note';
        noteEl.textContent = rec.note;
        left.appendChild(noteEl);
      }

      var right = document.createElement('div');
      right.className = 'hi-right';

      var totalEl = document.createElement('span');
      totalEl.className = 'hi-total';
      totalEl.textContent = Core.formatUSD(Core.total(rec));

      var splitEl = document.createElement('span');
      splitEl.className = 'hi-split';
      splitEl.textContent = '储蓄 ' + Core.formatNumber(rec.savings) +
        ' · 投资 ' + Core.formatNumber(rec.investment);

      right.appendChild(totalEl);
      right.appendChild(splitEl);

      item.appendChild(left);
      item.appendChild(right);
      list.appendChild(item);
    });
  }

  function renderAll() {
    renderHeader();
    renderStats();
    renderChart();
    renderHistory();
    syncForm(state.selectedDate);
  }

  /* ---------------- 操作 ---------------- */

  function onSave() {
    var today = Core.todayISO();
    var date = els.date.value || today;
    clearInvalid();
    clearFormMessage();

    if (!Core.isValidDate(date)) {
      setFormMessage('请选择有效的日期');
      return;
    }
    if (date > today) {
      setFormMessage('不能记录未来的日期');
      els.date.value = today;
      return;
    }

    var rawS = els.savings.value.trim();
    var rawI = els.investment.value.trim();
    if (!rawS && !rawI) {
      setFormMessage('请至少填写一个账户的余额');
      markInvalid(els.savings);
      els.savings.focus();
      return;
    }

    var savings = rawS ? Core.parseAmount(rawS) : 0;
    if (savings === null) {
      setFormMessage('储蓄金额格式不正确（最多两位小数）');
      markInvalid(els.savings);
      els.savings.focus();
      return;
    }

    var investment = rawI ? Core.parseAmount(rawI) : 0;
    if (investment === null) {
      setFormMessage('投资金额格式不正确（最多两位小数）');
      markInvalid(els.investment);
      els.investment.focus();
      return;
    }

    var existed = !!Core.recordFor(state.records, date);
    state.records = Core.upsertRecord(state.records, {
      date: date,
      savings: savings,
      investment: investment,
      note: els.note.value.trim().slice(0, 80),
      updatedAt: Date.now()
    });
    persist();
    state.selectedDate = date;
    renderAll();
    toast(existed
      ? '已更新 ' + Core.formatDateShort(date) + ' 的记录'
      : '已保存 ' + Core.formatDateShort(date) + ' 的记录');
  }

  function onDelete() {
    var date = state.selectedDate;
    if (!Core.recordFor(state.records, date)) return;
    showConfirm({
      title: '删除记录',
      message: '确定删除 ' + Core.formatDateFull(date) + ' 的记录吗？此操作无法撤销。',
      okText: '删除'
    }).then(function (ok) {
      if (!ok) return;
      state.records = Core.removeRecord(state.records, date);
      persist();
      renderAll();
      toast('已删除 ' + Core.formatDateShort(date) + ' 的记录');
    });
  }

  function onAmountInput() {
    clearFormMessage();
    clearInvalid();
    updateLiveTotal();
  }

  function onDateChange() {
    var date = els.date.value;
    if (!Core.isValidDate(date)) return;
    var today = Core.todayISO();
    if (date > today) {
      date = today;
      els.date.value = today;
    }
    syncForm(date);
    renderHeader();
  }

  function selectDate(date) {
    if (!Core.isValidDate(date)) return;
    syncForm(date);
    renderHeader();
    els.formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onHistoryClick(event) {
    var item = event.target.closest('.history-item');
    if (!item) return;
    selectDate(item.dataset.date);
  }

  function onHistoryKey(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var item = event.target.closest('.history-item');
    if (!item) return;
    event.preventDefault();
    selectDate(item.dataset.date);
  }

  function onRangeClick(event) {
    var btn = event.target.closest('button[data-range]');
    if (!btn) return;
    state.chartRange = btn.dataset.range;
    Array.prototype.forEach.call(els.rangeSeg.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b === btn);
    });
    renderChart();
  }

  function onLegendClick(event) {
    var btn = event.target.closest('button[data-series]');
    if (!btn) return;
    var key = btn.dataset.series;
    if (key === 'savings') {
      state.showSavings = !state.showSavings;
      btn.classList.toggle('active', state.showSavings);
    } else if (key === 'investment') {
      state.showInvestment = !state.showInvestment;
      btn.classList.toggle('active', state.showInvestment);
    }
    renderChart();
  }

  /* ---------------- 导出 / 导入 ---------------- */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1500);
  }

  function onExportCsv() {
    if (!state.records.length) {
      toast('还没有可导出的记录');
      return;
    }
    download('汇丰美元余额_' + Core.todayISO() + '.csv', Core.toCSV(state.records), 'text/csv;charset=utf-8');
    toast('CSV 已导出');
  }

  function onExportJson() {
    if (!state.records.length) {
      toast('还没有可备份的记录');
      return;
    }
    download('汇丰美元余额备份_' + Core.todayISO() + '.json', Core.toBackup(state.records), 'application/json');
    toast('备份已导出');
  }

  function onImportClick() {
    els.importFile.value = '';
    els.importFile.click();
  }

  function onImportFile() {
    var file = els.importFile.files && els.importFile.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var result = Core.parseBackup(String(reader.result || ''));
      if (!result.ok) {
        toast(result.error || '备份文件无法读取');
        return;
      }
      showConfirm({
        title: '恢复备份',
        message: '将导入 ' + result.records.length + ' 天的记录。同一天已有记录时，会用备份中的数据覆盖。',
        okText: '导入'
      }).then(function (ok) {
        if (!ok) return;
        var merged = Core.mergeRecords(state.records, result.records);
        state.records = merged.records;
        persist();
        if (!Core.recordFor(state.records, state.selectedDate)) {
          state.selectedDate = Core.todayISO();
        }
        renderAll();
        toast('已导入：新增 ' + merged.added + ' 天，更新 ' + merged.updated + ' 天');
      });
    };
    reader.onerror = function () { toast('文件读取失败'); };
    reader.readAsText(file);
  }

  function onClear() {
    if (!state.records.length) {
      toast('本来就没有数据');
      return;
    }
    showConfirm({
      title: '清空全部数据',
      message: '将删除 ' + state.records.length + ' 天的记录，且无法恢复。建议先导出备份。',
      okText: '清空'
    }).then(function (ok) {
      if (!ok) return;
      state.records = [];
      persist();
      state.selectedDate = Core.todayISO();
      state.historyLimit = HISTORY_PAGE;
      renderAll();
      toast('已清空全部记录');
    });
  }

  /* ---------------- 弹窗 / 提示 ---------------- */

  function showConfirm(options) {
    return new Promise(function (resolve) {
      els.modalTitle.textContent = options.title || '确认';
      els.modalMessage.textContent = options.message || '';
      els.modalOk.textContent = options.okText || '确认';
      els.modal.classList.remove('hidden');
      modalResolve = resolve;
      window.setTimeout(function () { els.modalOk.focus(); }, 30);
    });
  }

  function closeModal(value) {
    if (!modalResolve) return;
    els.modal.classList.add('hidden');
    var resolve = modalResolve;
    modalResolve = null;
    resolve(value);
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2400);
  }

  /* ---------------- 安装提示 / PWA ---------------- */

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function setupInstallTip() {
    var dismissed = false;
    try { dismissed = localStorage.getItem(TIP_KEY) === '1'; } catch (e) { /* 忽略 */ }
    if (isIOS() && !isStandalone() && !dismissed) {
      els.installTip.classList.remove('hidden');
    }
    els.dismissInstall.addEventListener('click', function () {
      els.installTip.classList.add('hidden');
      try { localStorage.setItem(TIP_KEY, '1'); } catch (e) { /* 忽略 */ }
    });
  }

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var host = window.location.hostname;
    var secure = window.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
    if (!secure) return;

    var hadController = !!navigator.serviceWorker.controller;
    var refreshing = false;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.warn('Service Worker 注册失败', err);
      });
    });
  }

  function applyPrefill() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return;
    }

    var got = false;
    var date = params.get('date');
    if (date && Core.isValidDate(date) && date <= Core.todayISO()) {
      syncForm(date);
      got = true;
    }

    var savings = params.get('savings');
    var investment = params.get('investment');
    var note = params.get('note');
    if (savings !== null && savings !== '') {
      els.savings.value = savings;
      got = true;
    }
    if (investment !== null && investment !== '') {
      els.investment.value = investment;
      got = true;
    }
    if (note) {
      els.note.value = note.slice(0, 80);
      got = true;
    }

    if (got) {
      updateLiveTotal();
      toast('已带入链接里的数值，确认后点保存');
      els.formCard.scrollIntoView({ block: 'start' });
    }
  }

  /* ---------------- 事件绑定 / 初始化 ---------------- */

  function wireEvents() {
    els.savings.addEventListener('input', onAmountInput);
    els.investment.addEventListener('input', onAmountInput);
    els.savings.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.investment.focus();
      }
    });
    els.investment.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        onSave();
      }
    });
    els.note.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') onSave();
    });

    els.date.addEventListener('change', onDateChange);
    els.saveBtn.addEventListener('click', onSave);
    els.deleteBtn.addEventListener('click', onDelete);
    els.rangeSeg.addEventListener('click', onRangeClick);

    Array.prototype.forEach.call(document.querySelectorAll('.legend-btn'), function (btn) {
      btn.addEventListener('click', onLegendClick);
    });

    els.historyList.addEventListener('click', onHistoryClick);
    els.historyList.addEventListener('keydown', onHistoryKey);
    els.moreBtn.addEventListener('click', function () {
      state.historyLimit += HISTORY_PAGE;
      renderHistory();
    });

    els.exportCsv.addEventListener('click', onExportCsv);
    els.exportJson.addEventListener('click', onExportJson);
    els.importBtn.addEventListener('click', onImportClick);
    els.importFile.addEventListener('change', onImportFile);
    els.clearBtn.addEventListener('click', onClear);

    els.modalOk.addEventListener('click', function () { closeModal(true); });
    els.modalCancel.addEventListener('click', function () { closeModal(false); });
    els.modal.addEventListener('click', function (event) {
      if (event.target === els.modal) closeModal(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal(false);
    });

    els.chart.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      showTooltipAt(event.clientX);
    });
    els.chart.addEventListener('pointerdown', function (event) {
      showTooltipAt(event.clientX);
      if (event.pointerType === 'touch') {
        window.clearTimeout(tooltipTimer);
        tooltipTimer = window.setTimeout(hideTooltip, 2600);
      }
    });
    els.chart.addEventListener('pointerleave', hideTooltip);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      renderHeader();
      renderStats();
    });
  }

  function init() {
    cacheEls();
    state.records = loadRecords();

    var today = Core.todayISO();
    els.date.min = '2000-01-01';
    els.date.max = today;
    state.selectedDate = today;

    wireEvents();
    setupInstallTip();
    setupServiceWorker();
    renderAll();
    applyPrefill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
