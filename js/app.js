/* ==========================================================================
   Province-Collect 站点 v0.4 — 参考 county demo 重写（vanilla JS，无依赖）
   路由 · 渲染 · 交互。数据：data_core.js(首屏) + data_full.js(人物/省详情按需)
   ========================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Y0 = DB.meta.y0, Y1 = DB.meta.y1, YEAR_COUNT = Y1 - Y0 + 1;
const TIMELINE_PX_PER_MONTH = 1200 / (YEAR_COUNT * 12);

/* ==================== 懒加载完整数据 ==================== */
// 三态：null=未加载, true=已加载, false=加载失败（保留重试能力）
let FULL_STATE = null, FULL_PENDING = null;
const _full = () => (typeof DB_FULL !== 'undefined' ? DB_FULL : {});
function loadFull() {
  if (FULL_STATE === true) return Promise.resolve(_full());
  if (FULL_PENDING) return FULL_PENDING;
  FULL_PENDING = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `js/data_full.js?v=${encodeURIComponent(DB.meta.fh || '0')}`;
    s.onload = () => { FULL_STATE = true; resolve(_full()); };
    s.onerror = () => { FULL_STATE = false; FULL_PENDING = null; resolve({}); };
    document.head.appendChild(s);
  });
  return FULL_PENDING;
}

/* ==================== 工具 ==================== */
function fmt(ym) { return ym ? String(ym).replace(/-/g, '.') : '至今'; }
function ymToFloat(ym) { if (!ym) return Y1 + 0.45; const [y, m] = String(ym).split('-').map(Number); return y + ((m || 1) - 1) / 12; }
function pct(ym) { const span = Y1 + 0.5 - Y0; return ((ymToFloat(ym) - Y0) / span) * 100; }
function ymIndex(ym) {
  const match = String(ym || '').match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2] || 1);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return year * 12 + month - 1;
}
function timelineStart(prov) {
  return /^\d{4}-\d{2}$/.test(prov?.t0 || '') ? prov.t0 : `${Y0}-01`;
}
function timelineStartYear(prov) { return Number(timelineStart(prov).slice(0, 4)); }
function timelineStartLabel(prov) {
  const start = timelineStart(prov);
  return start.endsWith('-01') ? start.slice(0, 4) : fmt(start);
}

// HTML 转义 — XSS 防护：所有来自数据文件的内容在插入 innerHTML 前必须转义
function esc(s) {
  if (s == null) return '';
  s = String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 离任去向三态（如实，不杜撰 demo 七色）
const EXIT_LABEL = { incumbent: '在任', transfer: '调任', unknown: '去向待查' };
const EXIT_COLOR = { incumbent: 'var(--indigo)', transfer: 'var(--ochre)', unknown: '#9a948a' };

// 信源分级（与 data/codebook.md 一致；data/ 现无 D）
const TIER_INFO = {
  A: '官方原始：政府公报/省人大任免/政府官网/工作报告/纪委通报',
  B: '权威二手：央媒/党报/领导资料库/年鉴/学术数据集',
  C: '聚合互证：百科/既有名册——须 ≥2 独立源互证方可入库',
};
function tierClass(t) { return t === 'A' ? 'tier-A' : t === 'B' ? 'tier-B' : 'tier-C'; }
function statusClass(s) { return s === '立案查处' ? 'st-purge' : s === '在职' ? 'st-active' : s === '死亡' ? 'st-dead' : 'st-retired'; }

const tooltip = $('#tooltip');
function showTip(html, x, y) {
  tooltip.innerHTML = html; tooltip.hidden = false;
  const pad = 14, r = tooltip.getBoundingClientRect();
  tooltip.style.left = Math.min(x + pad, innerWidth - r.width - 10) + 'px';
  tooltip.style.top = Math.min(y + pad, innerHeight - r.height - 10) + 'px';
}
function hideTip() { tooltip.hidden = true; }

// 来源 chip：由 evidence id 经 DB_FULL.evidence 解析（full 未到位时占位"查证中…"）
// 使用 DOM API 构造链接元素避免 XSS；URL 非 http(s) 则不生成链接
function srcChipsFromIds(ids) {
  if (!ids || !ids.length) return '<span class="src-chip">—</span>';
  const evd = _full().evidence || {};
  return ids.slice(0, 4).map(id => {
    const e = evd[id];
    if (!e) return '<span class="src-chip ev-loading">查证中…</span>';
    const tip = `${esc(e.t)} 级 — ${TIER_INFO[e.t] || ''}\n${esc(e.ti || '')}${e.q ? '\n「' + esc(e.q.slice(0, 80)) + '」' : ''}`;
    const safeUrl = (e.u && /^https?:\/\//i.test(e.u)) ? e.u : null;
    const cls = `src-chip ${tierClass(e.t)}`;
    let label = '来源';
    if (e.u) { try { label = new URL(e.u).hostname.replace(/^www\./, ''); } catch (_) {} }
    else if (e.ti) { label = e.ti; }
    const inner = `<b class="tier-badge">${esc(e.t || '?')}</b>${esc(label)}`;
    if (safeUrl) {
      const a = document.createElement('a');
      a.className = cls; a.href = safeUrl; a.target = '_blank'; a.rel = 'noopener'; a.title = tip;
      a.innerHTML = inner;
      return a.outerHTML;
    }
    const span = document.createElement('span');
    span.className = cls; span.title = tip;
    span.innerHTML = inner;
    return span.outerHTML;
  }).join('');
}

function tierLegendHTML() {
  return `<p class="tier-legend">史料来源分级：
    <span class="src-chip tier-A"><b class="tier-badge">A</b>官方原始</span>
    <span class="src-chip tier-B"><b class="tier-badge">B</b>权威二手</span>
    <span class="src-chip tier-C"><b class="tier-badge">C</b>聚合·须互证</span>
    <span class="legend-note">悬停看来源页标题与引文片段，点击溯源</span></p>`;
}

/* ==================== 路由 ==================== */
function route() {
  const hash = (location.hash || '#/home').replace(/^#\//, '');
  const slashIdx = hash.indexOf('/');
  const name = slashIdx >= 0 ? hash.slice(0, slashIdx) : hash;
  const rawArg = slashIdx >= 0 ? hash.slice(slashIdx + 1) : '';

  try {
    if (name === 'home') renderHome();
    else if (name === 'provinces') renderProvinces();
    else if (name === 'province' && rawArg) renderProvince(decodeURIComponent(rawArg));
    else if (name === 'persons') renderPersonList();
    else if (name === 'person' && rawArg) renderPerson(decodeURIComponent(rawArg));
  } catch (e) {
    console.error('Route error:', e);
    const panel = $('#view-' + name);
    if (panel) panel.innerHTML = '<p class="sec-note">页面加载出错，请检查链接或返回<a data-go="#/home">首页</a>。</p>';
  }

  $$('.view').forEach(v => v.classList.remove('is-active'));
  ($('#view-' + name) || $('#view-home')).classList.add('is-active');
  $$('.topnav a').forEach(a => {
    const n = a.dataset.nav;
    a.classList.toggle('is-active', n === name || (n === 'provinces' && name === 'province') || (n === 'persons' && name === 'person'));
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', route);

function copyCite() { navigator.clipboard?.writeText(($('#cite-text')?.textContent || '').trim()); alert('引用信息已复制。'); }

/* ==================== 首页 ==================== */
function renderHome() {
  $('#stat-provs').textContent = DB.provinces.length;
  $('#stat-persons').textContent = DB.meta.np ?? Object.keys(DB.persons).length;
  $('#stat-spells').textContent = DB.meta.ns;
  $('#stat-ev').textContent = DB.meta.ne;
  $('#stat-span').textContent = DB.meta.y0 + '–' + DB.meta.y1;
  renderHeatmap();
  renderTierChart();
}

function renderHeatmap() {
  const hm = $('#heatmap'); if (!hm) return;
  hm.setAttribute('role', 'group');
  hm.setAttribute('aria-label', `覆盖热力图：各省 ${Y0}–${Y1} 每年双岗（书记/行政正职）填充态；海南、重庆建制前标为未建制；含各省导航链接`);
  hm.style.gridTemplateColumns = `4.5rem repeat(${YEAR_COUNT}, minmax(0, 1fr))`;
  let h = '<span class="hm-label" aria-hidden="true"></span>';
  for (let y = Y0; y <= Y1; y++) h += `<span class="hm-year">${y % 5 === 0 ? y : ''}</span>`;
  DB.provinces.forEach(prov => {
    h += `<span class="hm-label"><a href="#/province/${encodeURIComponent(prov.k)}">${esc(prov.k)}</a></span>`;
    for (let y = Y0; y <= Y1; y++) {
      if (y < timelineStartYear(prov)) {
        const tip = `${esc(prov.k)} ${y} 未建制（本站口径始于 ${esc(fmt(timelineStart(prov))) }）`;
        h += `<span class="hm-cell hm-na" data-tip="${esc(tip)}" title="${esc(tip)}" aria-label="${esc(tip)}"></span>`;
        continue;
      }
      const c = (prov.yr || {})[String(y)] || {};
      const hasS = !!c['书记'], hasG = !!c['行政正职'];
      let bg, tip;
      if (hasS && hasG) { bg = 'var(--ochre)'; tip = `双岗 · ${esc(c['书记'])} / ${esc(c['行政正职'])}`; }
      else if (hasS) { bg = 'var(--seal)'; tip = `仅书记 · ${esc(c['书记'])}`; }
      else if (hasG) { bg = 'var(--indigo)'; tip = `仅行政正职 · ${esc(c['行政正职'])}`; }
      else { bg = 'var(--paper-3)'; tip = '空缺'; }
      const lbl = `${esc(prov.k)} ${y} ${tip}`;
      h += `<span class="hm-cell" data-tip="${esc(lbl)}" style="background:${bg}" title="${esc(lbl)}" aria-label="${esc(lbl)}"></span>`;
    }
  });
  hm.innerHTML = h;
}

function renderTierChart() {
  const el = $('#tier-chart'); if (!el || !DB.meta.t) return;
  const t = DB.meta.t, total = (t.A || 0) + (t.B || 0) + (t.C || 0) + (t.D || 0) || 1;
  const rows = [
    { l: 'A 官方原始', n: t.A || 0, c: 'tA', d: '政府公报·省人大·新华社·中纪委原文' },
    { l: 'B 权威二手', n: t.B || 0, c: 'tB', d: '人民网·新华网·领导资料库·党报' },
    { l: 'C 聚合互证', n: t.C || 0, c: 'tC', d: '百科·既有名册·须≥2源互证' },
  ];
  el.innerHTML = rows.map(b => {
    const p = (b.n / total * 100).toFixed(1);
    return `<div class="tier-row"><span class="tier-label">${b.l}</span>
      <div class="tier-bar-wrap"><div class="tier-bar ${b.c}" style="width:${p}%"></div></div>
      <span class="tier-num">${b.n} <small>${p}%</small></span>
      <span class="tier-desc">${b.d}</span></div>`;
  }).join('');
}

/* ==================== 省览 ==================== */
function renderProvinces() {
  $('#prov-cards').innerHTML = DB.provinces.map(p => {
    let dots = '';
    for (let y = Y0; y <= Y1; y++) {
      if (y < timelineStartYear(p)) { dots += '<span class="ptd na"></span>'; continue; }
      const c = (p.yr || {})[String(y)] || {};
      dots += c['书记'] && c['行政正职'] ? '<span class="ptd both"></span>'
        : c['书记'] ? '<span class="ptd sec"></span>'
        : c['行政正职'] ? '<span class="ptd gov"></span>' : '<span class="ptd gap"></span>';
    }
    return `<a class="prov-card" href="#/province/${encodeURIComponent(p.k)}">
      <div class="pc-head"><h3>${esc(p.k)}</h3><span class="pc-id">${esc(p.id || '')}</span></div>
      <div class="pc-meta"><span class="chip">${esc(p.rt || '')}</span><span class="chip">${p.np}人</span><span class="chip">${p.ns}段</span><span class="chip">${p.ne}证据</span></div>
      <div class="pc-dots" aria-hidden="true">${dots}</div></a>`;
  }).join('');
}

/* ==================== 省详情 ==================== */
// 时间轴显示合并：同一人、同一职位、连续/重叠的多段（如 代理→转正、被切碎的同任期）并为一条。
// 任职记录表仍逐条列出，不受影响。
function coalesceLane(spells) {
  const arr = spells.slice().sort((a, b) => (a.sy || '').localeCompare(b.sy || ''));
  const out = [];
  for (const s of arr) {
    const p = out[out.length - 1];
    const overlaps = p && (p.exit === 'incumbent' || (p.ey && (s.sy || '') <= p.ey));
    if (p && p.pi === s.pi && p.po === s.po && overlaps) {
      // Acting-ended → formal-incumbent is a state transition, not one closed
      // interval. Preserve the later open-ended spell instead of swallowing it.
      if ((!s.ey || s.ey === '至今') && p.ey) {
        out.push({ ...s });
        continue;
      }
      // 只有当前段 ey 确实为空/至今，且已合并段也没有结束日期时，才设 incumbent
      // 防止后段在任状态覆盖之前已有明确结束日期的合并结果
      if ((!s.ey || s.ey === '至今') && !p.ey) { p.ey = ''; p.exit = 'incumbent'; }
      else if (p.ey && (s.ey || '') > (p.ey || '')) { p.ey = s.ey; p.exit = s.exit; }
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

// 双轨时间轴（书记 / 行政正职；按职位着色，离任去向见 tooltip 与下方任职表）
// 窄条名字放右侧外部完整显示，避免短任期官员名字截断/丢失
function _dualTimeline(secs, govs, startYm) {
  secs = coalesceLane(secs); govs = coalesceLane(govs);
  const startIndex = ymIndex(startYm), endIndex = (Y1 + 1) * 12;
  const axisMonths = endIndex - startIndex, W = axisMonths * TIMELINE_PX_PER_MONTH;
  const xp = ym => {
    const index = ymIndex(ym);
    return index == null ? null : (index - startIndex) * TIMELINE_PX_PER_MONTH;
  };
  let bars = '', labels = '';
  const add = (s, cls, role) => {
    const rawL = xp(s.sy);
    const rawR = s.exit === 'incumbent' || !s.ey || s.ey === '至今'
      ? W
      : xp(s.ey);
    if (!Number.isFinite(rawL) || !Number.isFinite(rawR) || rawR <= 0 || rawL >= W) return;
    const clippedLeft = rawL < 0;
    const L = Math.max(rawL, 0), R = Math.min(rawR, W), Wd = Math.max(R - L, 6);
    const range = `${fmt(s.sy)} ~ ${s.exit === 'incumbent' ? '至今' : s.ey ? fmt(s.ey) : '?'}`;
    const clipNote = clippedLeft ? ` · 起于展示范围 ${fmt(startYm)} 之前` : '';
    const tip = `${esc(s.pn)} · ${role} · ${range} · ${EXIT_LABEL[s.exit] || ''}${clipNote}`;
    const href = s.pi ? `#/person/${esc(s.pi)}` : '#/persons';
    const showName = Wd >= (s.pn || '').length * 13 + 8;
    const visibleName = `${clippedLeft ? '← ' : ''}${s.pn || ''}`;
    bars += `<a class="tl-bar ${cls}${showName ? '' : ' tl-bar-tick'}${clippedLeft ? ' is-clipped-left' : ''}" href="${href}" style="left:${L.toFixed(1)}px;width:${Wd.toFixed(1)}px" data-tip="${esc(tip)}" aria-label="${esc(tip)}" title="${esc(tip)}">${showName ? esc(visibleName) : ''}</a>`;
    if (!showName) labels += `<span class="tl-name-out ${cls}" style="left:${(L + Wd + 4).toFixed(1)}px">${esc(visibleName)}</span>`;
  };
  secs.forEach(s => add(s, 'sec', '书记'));
  govs.forEach(s => add(s, 'gov', '行政正职'));
  let gl = `<div class="tl-gl tl-boundary" style="left:0"></div><div class="tl-gy tl-start" style="left:0">${esc(startYm.endsWith('-01') ? startYm.slice(0, 4) : fmt(startYm))}</div>`;
  const startYear = Number(startYm.slice(0, 4));
  for (let y = Math.ceil(startYear / 5) * 5; y <= Y1; y += 5) {
    const x = xp(`${y}-01`);
    if (!Number.isFinite(x) || x <= 0 || x >= W) continue;
    gl += `<div class="tl-gl" style="left:${x.toFixed(1)}px"></div><div class="tl-gy" style="left:${x.toFixed(1)}px">${y}</div>`;
  }
  const axisLabel = `${startYm.endsWith('-01') ? startYm.slice(0, 4) : fmt(startYm)}–${Y1}`;
  return `<div class="tl-scroll" role="group" aria-label="双轨任职时间轴，展示范围 ${esc(axisLabel)}"><div class="tl-wrap dual" data-axis-start="${esc(startYm)}" style="width:${(W + 160).toFixed(1)}px">${gl}${bars}${labels}</div></div>`;
}

function epStatusHTML(status) {
  if (status === 'multi') return '<span class="mono verify-2">多源 ✓✓</span>';
  if (status === 'single') return '<span class="mono verify-1">单源 ✓</span>';
  return '<span class="mono verify-none">待补</span>';
}

// evidence 多源判定：仅 source_url 的实际域名多样性代表独立来源；tier 只表示质量。
function epStat(ids) {
  if (!ids || !ids.length) return 'none';
  if (ids.length < 2) return 'single';
  const evd = _full().evidence || {};
  const sources = ids.map(id => evd[id]).filter(Boolean);
  if (sources.length < 2) return 'single';
  const domains = new Set();
  for (const s of sources) {
    try {
      const u = new URL(s.u);
      domains.add(u.hostname);
    } catch (_) {
      domains.add(s.u || 'unknown');
    }
  }
  // Tier is evidence quality, not source independence. Only distinct domains
  // establish multiple sources.
  return domains.size >= 2 ? 'multi' : 'single';
}

// 每条 office_spell 拆「到任 / 离任」两行；起止各自来源 chip + 核验
function spellRows(spells, postShort) {
  return spells.map(s => {
    const incumbent = s.exit === 'incumbent';
    const conflict = s.vs === 'conflict';
    const flag = `${s.pn}|${postShort}|${fmt(s.sy)}–${incumbent ? '至今' : s.ey ? fmt(s.ey) : '?'}`;
    const arrival = `
    <tr class="sp-row sp-arrival">
      <td rowspan="2" class="td-post">${esc(postShort)}</td>
      <td rowspan="2" class="td-person" data-pid="${esc(s.pi)}">${esc(s.pn)}${s.a === '1' ? '<span class="acting-tag">代理</span>' : ''}</td>
      <td class="td-endpoint ep-in">● 到任</td>
      <td class="mono td-when">${esc(fmt(s.sy))}</td>
      <td class="td-detail"><span class="dim">到任来源方向待考</span></td>
      <td class="td-src">${srcChipsFromIds(s.sev)}</td>
      <td class="td-verify">${epStatusHTML(epStat(s.sev))}</td>
      <td rowspan="2" class="td-act"><button class="btn-flag" data-flag="${esc(flag)}">报错</button></td>
    </tr>`;
    const departure = incumbent ? `
    <tr class="sp-row sp-departure">
      <td class="td-endpoint ep-now">◐ 在任</td><td class="mono td-when">至今</td>
      <td class="td-detail"><span class="exit-tag" style="background:${EXIT_COLOR.incumbent}">在任</span></td>
      <td class="td-src"><span class="dim">现任，暂无离任记录</span></td><td class="td-verify">—</td>
    </tr>` : `
    <tr class="sp-row sp-departure${conflict ? ' is-conflict' : ''}">
      <td class="td-endpoint ep-out">○ 离任</td><td class="mono td-when">${s.ey ? esc(fmt(s.ey)) : '?'}</td>
      <td class="td-detail"><span class="exit-tag" style="background:${EXIT_COLOR[s.exit] || EXIT_COLOR.unknown}">${EXIT_LABEL[s.exit] || '去向待查'}</span></td>
      <td class="td-src">${srcChipsFromIds(s.eev)}</td>
      <td class="td-verify">${conflict ? '<span class="mono verify-conflict" title="多源对离任时间分歧">分歧 ⚠</span>' : epStatusHTML(epStat(s.eev))}</td>
    </tr>`;
    return arrival + departure;
  }).join('');
}

function renderProvince(pkey) {
  const p = DB.provinces.find(x => x.k === pkey);
  const box = $('#province-panel');
  if (!p) { box.innerHTML = '<p class="sec-note">未找到该省。<a data-go="#/provinces">返回省览</a></p>'; return; }
  const spells = DB.spells.filter(s => s.pr === pkey);
  const secs = spells.filter(s => s.po === '书记').sort((a, b) => (a.sy || '').localeCompare(b.sy || ''));
  const govs = spells.filter(s => s.po === '行政正职').sort((a, b) => (a.sy || '').localeCompare(b.sy || ''));
  const personHtml = (p.ps || []).map(pid => {
    const per = DB.persons[pid]; if (!per) return '';
    const posts = [...new Set((per.of || []).filter(o => o.pr === pkey).map(o => o.po === '书记' ? '书记' : '行政正职'))].join('·');
    const provinceAttrs = (per.pa || {})[pkey] || per;
    const l2tags = [per.fr, provinceAttrs.pm ? '本省提拔' : '', provinceAttrs.sd ? '本省学习' : '', ...(per.pf||[]).slice(0,2)].filter(Boolean);
    return `<a class="pcard" href="#/person/${esc(pid)}"><span class="pcard-name">${esc(per.n)}</span>
      <span class="pcard-meta">${esc(per.by || '?')} · ${esc(per.o || '?')} · <span class="${statusClass(per.st)}">${esc(per.st || '?')}</span></span>
      <span class="pcard-posts">${posts}${l2tags.length ? ' · ' + l2tags.map(esc).join(' · ') : ''}</span></a>`;
  }).join('');

  box.innerHTML = `
    <nav class="crumb" aria-label="层级导航"><a data-go="#/provinces">省览</a><span class="sep">›</span><b>${esc(p.k)}</b></nav>
    <div class="pg-head"><h2>${esc(p.k)}</h2><span class="chip">${esc(p.rt || '')}</span><span class="chip">${esc(p.id || '')}</span></div>
    <p class="sec-note">${p.np} 位人物 · ${p.ns} 段任职 · ${p.ne} 条证据 · ${p.nc} 条履历段 · 时间轴 ${esc(timelineStartLabel(p))}–${Y1}</p>
    <div class="tl-legend">
      <span><i class="sw sw-sec"></i>书记</span><span><i class="sw sw-gov"></i>行政正职</span>
      <span class="legend-note">条按职位着色；离任去向（在任/调任/去向待查）见悬停与下方任职表</span></div>
    ${_dualTimeline(secs, govs, timelineStart(p))}
    <table class="data-table sp-table"><thead><tr><th>职位</th><th>姓名</th><th>端点</th><th>时间</th><th>事由 / 去向</th><th>史料来源</th><th>核验</th><th></th></tr></thead>
      <tbody>${spellRows(secs, '书记')}${spellRows(govs, '省长')}</tbody></table>
    ${tierLegendHTML()}
    <p class="principle-line">※ 到任 / 离任各自独立取证、分行列出；缺口与分歧显式标注。点「报错」发起修订。</p>
    <h3 class="sec-title">人物 (${(p.ps || []).length})</h3>
    <div class="pcard-list">${personHtml || '<p class="sec-note">—</p>'}</div>`;

  // 来源 chip 依赖 DB_FULL.evidence：full 未加载或加载失败时尝试加载
  if (FULL_STATE !== true) loadFull().then(() => {
    if (FULL_STATE !== true) return;
    try {
      const currentHash = decodeURIComponent(location.hash);
      if (currentHash === '#/province/' + pkey) renderProvince(pkey);
    } catch (_) { /* 忽略 re-render 时的畸形 hash */ }
  });
}

/* ==================== 人物列表 ==================== */
function renderPersonList() {
  const sel = $('#f-prov');
  if (sel && sel.children.length <= 1) {
    sel.insertAdjacentHTML('beforeend', DB.provinces.map(p => `<option value="${esc(p.k)}">${esc(p.k)}</option>`).join(''));
  }
  const pf = sel ? sel.value : '', q = ($('#f-search2')?.value || '').trim(), bd = $('#f-decade')?.value || '';
  const pids = Object.keys(DB.persons).filter(pid => {
    const p = DB.persons[pid]; if (!p) return false;
    if (pf && !(p.of || []).some(o => o.pr === pf)) return false;
    if (q && !p.n.includes(q) && !(p.o || '').includes(q) && !(p.ed || '').includes(q)) return false;
    if (bd && !(p.by || '').startsWith(bd)) return false;
    return true;
  }).sort((a, b) => (DB.persons[a]?.n || '').localeCompare(DB.persons[b]?.n || '', 'zh'));

  $('#persons-count').textContent = pids.length + ' 人';
  $('#person-list').innerHTML = pids.length ? `<div class="pcard-list">${pids.map(pid => {
    const p = DB.persons[pid];
    const provs = [...new Set((p.of || []).map(o => o.pr))].join('·');
    const posts = [...new Set((p.of || []).map(o => o.po === '书记' ? '书' : '长'))].join('');
    const l2tags2 = [p.fr, ...(p.pf||[]).slice(0,1)].filter(Boolean);
    return `<a class="pcard" href="#/person/${esc(pid)}"><span class="pcard-name">${esc(p.n)}</span>
      <span class="pcard-meta">${esc(p.by || '?')} · ${esc(p.o || '?')} · <span class="${statusClass(p.st)}">${esc(p.st || '?')}</span></span>
      <span class="pcard-posts">${esc(provs)} ${esc(posts)} · ${p.nc || 0}段履历${l2tags2.length ? ' · ' + l2tags2.map(esc).join(' · ') : ''}</span></a>`;
  }).join('')}</div>` : '<p class="sec-note">无匹配。</p>';
}

document.addEventListener('input', e => {
  if (e.target.closest('#f-prov, #f-search2, #f-decade')) {
    clearTimeout(window._filterTimer);
    window._filterTimer = setTimeout(() => { if (location.hash.includes('persons')) renderPersonList(); }, 180);
  }
});

/* ==================== 人物详情 ==================== */
function metaCell(label, val) { return `<div class="pm-cell"><dt>${label}</dt><dd class="${val ? '' : 'missing'}">${val ? esc(val) : '—（缺失）'}</dd></div>`; }
function findRoster(p) { return (p.of || []).map(s => ({ ...s, post: s.po === '书记' ? '书记' : '省长' })); }

function renderPerson(pid) {
  const p = DB.persons[pid];
  if (!p) { $('#person-panel').innerHTML = '<p class="sec-note">未找到该人物。<a data-go="#/persons">返回人物</a></p>'; return; }
  renderPersonSync(pid, _full().persons?.[pid] || p);
  // FULL_STATE 为 false（失败）时也会重试
  if (FULL_STATE !== true) loadFull().then(() => { if (location.hash === `#/person/${pid}`) renderPersonSync(pid, _full().persons?.[pid] || p); });
}

function renderPersonSync(pid, p) {
  const careerHtml = (p.cr || []).map(c => {
    // L2 annotation badges
    let l2Badges = '';
    const tags = [];
    const finalRank = c.fr && !['无', '无级别'].includes(c.fr) ? c.fr : '';
    const positionRank = c.rk && !['无', '无级别'].includes(c.rk) ? c.rk : '';
    const visibleRank = finalRank || positionRank;
    if (visibleRank) {
      const rankTitle = finalRank && positionRank && finalRank !== positionRank
        ? `最终行政级别（段末累计）；该条职务级别：${positionRank}`
        : (finalRank ? '最终行政级别（段末累计）' : '该条行政级别');
      tags.push(`<span class="tag-l2 tag-rank" title="${esc(rankTitle)}">${esc(visibleRank)}</span>`);
    }
    if (c.pf) tags.push(`<span class="tag-l2 tag-flag" title="标志位">${esc(c.pf)}</span>`);
    if (c.ol) tags.push(`<span class="tag-l2 tag-orglbl" title="组织标签">${esc(c.ol)}</span>`);
    if (c.cl) tags.push(`<span class="tag-l2 tag-cl" title="中央/地方">${esc(c.cl)}</span>`);
    if (c.fl) tags.push(`<span class="tag-l2 tag-fall" title="落马">⚖落马</span>`);
    if (c.nh) tags.push(`<span class="tag-l2 tag-review" title="待人工复核">待审</span>`);
    if (tags.length) l2Badges = `<div class="ci-l2">${tags.join('')}</div>`;

    return `
    <div class="career-item${c.a === '1' ? ' cr-act' : ''}${c.nh ? ' cr-review' : ''}">
      <div class="ci-dates">${esc(fmt(c.s))}<br>~ ${c.e ? esc(fmt(c.e)) : '?'}</div>
      <div class="ci-rail"></div>
      <div class="ci-body">
        <div class="ci-pos">${esc(c.p || '—')}${c.a === '1' ? '<span class="tag-act">代理</span>' : ''}${c.c === '1' ? '<span class="tag-con">兼任</span>' : ''}</div>
        <div class="ci-org">${esc(c.o || '')}</div>
        ${l2Badges}
        ${c.ev && c.ev.length ? `<div class="ci-src">${srcChipsFromIds(c.ev)}</div>` : ''}
      </div></div>`;
  }).join('') || '<div class="thin-note">⚠ 薄记录：暂无完整履历段，仅下方本库任职记录。</div>';

  const roster = findRoster(p);
  const rosterHtml = roster.length ? `<h3 class="sec-title">本库任职记录</h3>
    <div class="tbl-wrap"><table class="data-table"><thead><tr><th>省份</th><th>职位</th><th>任期</th><th>去向</th><th>核验</th><th>省属性</th></tr></thead><tbody>
    ${roster.map(r => `<tr><td>${esc(r.pr)}</td><td>${esc(r.post)}${r.a === '1' ? '（代）' : ''}</td>
      <td class="mono">${esc(fmt(r.sy))} – ${r.exit === 'incumbent' ? '至今' : r.ey ? esc(fmt(r.ey)) : '?'}</td>
      <td><span class="exit-tag" style="background:${EXIT_COLOR[r.exit] || EXIT_COLOR.unknown}">${EXIT_LABEL[r.exit] || '去向待查'}</span></td>
      <td class="mono">${r.vs === 'multi' ? '多源✓✓' : r.vs === 'conflict' ? '分歧⚠' : '单源✓'}</td>
      <td class="td-province-attrs"><div class="roster-attrs">${r.pm ? '<mark class="roster-attr roster-attr-advance">◆本省提拔</mark>' : ''}${r.sd ? '<mark class="roster-attr roster-attr-study">◆本省学习</mark>' : ''}</div></td></tr>`).join('')}
    </tbody></table></div>` : '';

  const fallHtml = (p.fl || p.st === '立案查处') ? `<div class="purge-box"><h4>⚖ 落马 / 处分记录</h4><dl>
    <div><dt>落马日期</dt><dd>${esc(p.fd || '?')}</dd></div>
    <div><dt>处分</dt><dd>${esc(p.fp || '?')}</dd></div>
    <div><dt>原因 / 罪名</dt><dd>${esc(p.fc || '?')}</dd></div></dl></div>` : '';

  $('#person-panel').innerHTML = `
    <a class="back-link" data-go="#/persons">← 返回人物</a>
    <div class="person-head"><h2>${esc(p.n)}</h2><span class="chip">person_id ${esc(pid)}</span>
      <span class="chip ${statusClass(p.st)}">${esc(p.st || '?')}</span></div>
    <dl class="person-meta">
      ${metaCell('出生年月', p.by)}${metaCell('籍贯', p.o)}${metaCell('民族', p.e)}
      ${metaCell('性别', p.s)}${metaCell('最高学历', p.ed)}${metaCell('现状', p.st)}</dl>
    ${fallHtml}
    <div class="career"><h3 class="sec-title" style="margin-top:0">履历（career spells）</h3>${careerHtml}</div>
    ${rosterHtml}
    <p class="principle-line">※ 缺失字段显式标注「—（缺失）」。<button class="btn-flag" data-flag="${esc(p.n)}|人物档案|${esc(pid)}">报告本页错误</button></p>
    ${tierLegendHTML()}`;
}

/* ==================== 报错弹窗 ==================== */
function openReport(ctx) {
  const [name, where, span] = ctx.split('|');
  $('#report-body').value =
`**记录**: ${where} · ${name}
**任期 / 标识**: ${span}
**数据版本**: ${DB.meta.v}

**问题描述**: <哪个字段有误，正确值是什么>

**证据来源**: <URL、文献或卷期>`;
  $('#modal-report').hidden = false;
}
function closeReport() { $('#modal-report').hidden = true; }
function copyReport() { navigator.clipboard?.writeText($('#report-body').value); alert('模板已复制，请前往项目仓库以 Issue 提交。'); }
$('#modal-report').addEventListener('click', e => { if (e.target === e.currentTarget) closeReport(); });

/* ==================== 事件委托 ==================== */
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = go.dataset.go; return; }
  const person = e.target.closest('.td-person[data-pid]');
  if (person) { location.hash = `#/person/${person.dataset.pid}`; return; }
  const flag = e.target.closest('[data-flag]');
  if (flag) { openReport(flag.dataset.flag); return; }
});
document.addEventListener('mousemove', e => {
  const t = e.target.closest('.tl-bar[data-tip], .hm-cell[data-tip]');
  if (t) showTip(`<div class="tt-title">${esc(t.dataset.tip)}</div>`, e.clientX, e.clientY);
  else hideTip();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeReport();
  if (e.key === 'Enter') {
    const el = document.activeElement;
    if (el && el.matches && el.matches('.td-person[data-pid]')) location.hash = `#/person/${el.dataset.pid}`;
  }
});

/* ==================== 启动 ==================== */
const _ver = $('#ver'); if (_ver) _ver.textContent = DB.meta.v;
const _fver = $('#foot-ver'); if (_fver) _fver.textContent = DB.meta.v;
route();
