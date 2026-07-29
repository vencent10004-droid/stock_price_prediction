/* KOSPI 100 실시간 트리맵 히트맵 — GitHub Pages 정적 버전
 * 실시간: allorigins CORS 프록시 → 네이버 증권 API
 * 폴백: GitHub Actions가 장중 주기 갱신하는 data.json
 */
"use strict";

const TOP_N = 100;
const PROXY = u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`;

const mapEl = document.getElementById("map");
const tooltipEl = document.getElementById("tooltip");
const updatedEl = document.getElementById("updatedAt");
const countdownEl = document.getElementById("countdown");
const kospiEl = document.getElementById("kospiChip");
const intervalSel = document.getElementById("intervalSel");
const pauseBtn = document.getElementById("pauseBtn");
const liveBadge = document.getElementById("liveBadge");
const sheet = document.getElementById("sheet");

let lastData = null;
let sectorMap = null;
let paused = false;
let remain = Number(intervalSel.value);

/* ---------- 색상 ---------- */
const COLOR_STOPS = [
  [-3, [63, 100, 224]],
  [-1, [56, 74, 138]],
  [0, [55, 62, 82]],
  [1, [134, 59, 66]],
  [3, [226, 70, 70]],
];

function colorFor(rate) {
  const v = Math.max(-3, Math.min(3, rate));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [v0, c0] = COLOR_STOPS[i];
    const [v1, c1] = COLOR_STOPS[i + 1];
    if (v >= v0 && v <= v1) {
      const t = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
      const rgb = c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }
  return "rgb(55,62,82)";
}

/* ---------- 스퀘리파이 트리맵 ---------- */
function squarify(values, x, y, w, h) {
  const rects = [];
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || w <= 0 || h <= 0) return values.map(() => ({ x, y, w: 0, h: 0 }));
  const scale = (w * h) / total;
  const vals = values.map(v => Math.max(v * scale, 1e-6));

  function worst(row, len) {
    const s = row.reduce((a, b) => a + b, 0);
    const mx = Math.max(...row), mn = Math.min(...row);
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  }

  let i = 0;
  while (i < vals.length) {
    const len = Math.min(w, h);
    const row = [vals[i]];
    let j = i + 1;
    while (j < vals.length && worst(row.concat(vals[j]), len) <= worst(row, len)) {
      row.push(vals[j]); j++;
    }
    const s = row.reduce((a, b) => a + b, 0);
    const thickness = s / len;
    let off = 0;
    for (const v of row) {
      const rl = v / thickness;
      if (w >= h) rects.push({ x, y: y + off, w: thickness, h: rl });
      else rects.push({ x: x + off, y, w: rl, h: thickness });
      off += rl;
    }
    if (w >= h) { x += thickness; w -= thickness; }
    else { y += thickness; h -= thickness; }
    i = j;
  }
  return rects;
}

/* ---------- 데이터 로딩 ---------- */
function num(text, def = 0) {
  if (text === null || text === undefined) return def;
  const v = parseFloat(String(text).replace(/,/g, ""));
  return isNaN(v) ? def : v;
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getSectorMap() {
  if (sectorMap) return sectorMap;
  try {
    sectorMap = await fetchJson(`sectors.json?_=${Date.now()}`);
  } catch (e) {
    sectorMap = {};
  }
  return sectorMap;
}

async function loadRealtime() {
  const secs = await getSectorMap();
  const ts = Date.now();
  const pages = await Promise.all([1, 2].map(p =>
    fetchJson(PROXY(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${p}&pageSize=100&_=${ts}`))
  ));
  const rows = pages.flatMap(d => d.stocks || []);
  const stocks = [];
  for (const s of rows) {
    const code = s.itemCode || "";
    if (s.stockEndType !== "stock") continue;          // ETF/ETN 제외
    if (!code || code[code.length - 1] !== "0") continue; // 우선주 제외
    stocks.push({
      code,
      name: s.stockName || "",
      price: num(s.closePrice),
      change: num(s.compareToPreviousClosePrice),
      rate: num(s.fluctuationsRatio),
      cap: num(s.marketValue),
      sector: secs[code] || "기타",
    });
    if (stocks.length >= TOP_N) break;
  }
  if (stocks.length < 50) throw new Error("종목 수 부족");

  let kospi = null;
  try {
    const k = await fetchJson(PROXY(`https://m.stock.naver.com/api/index/KOSPI/basic?_=${ts}`));
    kospi = { value: num(k.closePrice), rate: num(k.fluctuationsRatio) };
  } catch (e) { /* 지수는 없어도 무방 */ }

  const now = new Date();
  return {
    updated: now.toTimeString().slice(0, 8),
    kospi,
    stocks,
    live: true,
  };
}

async function loadSnapshot() {
  const d = await fetchJson(`data.json?_=${Date.now()}`);
  return {
    updated: (d.updated || "").slice(11) || "-",
    kospi: d.kospi,
    stocks: d.stocks || [],
    live: false,
  };
}

/* ---------- 렌더링 ---------- */
function fmtCap(capEok) {
  if (capEok >= 10000) return (capEok / 10000).toFixed(1).replace(/\.0$/, "") + "조원";
  return Math.round(capEok).toLocaleString() + "억원";
}
function fmtRate(rate) {
  return (rate > 0 ? "+" : "") + rate.toFixed(2) + "%";
}

function render() {
  if (!lastData) return;
  mapEl.innerHTML = "";
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  if (W < 50 || H < 50) return;

  const groups = new Map();
  for (const s of lastData.stocks) {
    if (!groups.has(s.sector)) groups.set(s.sector, { name: s.sector, cap: 0, stocks: [] });
    const g = groups.get(s.sector);
    g.cap += s.cap;
    g.stocks.push(s);
  }
  const sectors = [...groups.values()].sort((a, b) => b.cap - a.cap);
  sectors.forEach(g => g.stocks.sort((a, b) => b.cap - a.cap));

  const sectorRects = squarify(sectors.map(g => g.cap), 0, 0, W, H);

  sectors.forEach((g, gi) => {
    const r = sectorRects[gi];
    if (r.w < 2 || r.h < 2) return;
    const secDiv = document.createElement("div");
    secDiv.className = "sector";
    secDiv.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;

    let headH = 0;
    if (r.h >= 46 && r.w >= 44) {
      headH = Math.min(20, Math.max(14, r.h * 0.06));
      const title = document.createElement("div");
      title.className = "sector-title";
      title.textContent = g.name;
      title.style.cssText = `height:${headH}px;line-height:${headH}px;font-size:${Math.min(12, headH - 4)}px;`;
      secDiv.appendChild(title);
    }

    const innerW = r.w - 2, innerH = r.h - headH - 2;
    const tileRects = squarify(g.stocks.map(s => s.cap), 0, 0, innerW, innerH);

    g.stocks.forEach((s, si) => {
      const t = tileRects[si];
      if (t.w < 1 || t.h < 1) return;
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.style.cssText =
        `left:${t.x + 1}px;top:${t.y + headH + 1}px;width:${t.w}px;height:${t.h}px;` +
        `background:${colorFor(s.rate)};`;

      const nameFit = (t.w * 1.55) / Math.max(2, s.name.length);
      const f = Math.min(t.h * 0.3, nameFit, 40);
      if (f >= 8) {
        const nm = document.createElement("div");
        nm.className = "nm";
        nm.textContent = s.name;
        nm.style.fontSize = f + "px";
        tile.appendChild(nm);
        const rf = Math.min(f * 0.72, t.h * 0.22);
        if (rf >= 7.5) {
          const rt = document.createElement("div");
          rt.className = "rt";
          rt.textContent = fmtRate(s.rate);
          rt.style.fontSize = rf + "px";
          tile.appendChild(rt);
        }
      }

      tile.addEventListener("mousemove", ev => showTooltip(ev, s, g.name));
      tile.addEventListener("mouseleave", hideTooltip);
      tile.addEventListener("click", () => openSheet(s, g.name));
      secDiv.appendChild(tile);
    });

    mapEl.appendChild(secDiv);
  });
}

/* ---------- 툴팁(데스크톱) ---------- */
function showTooltip(ev, s, sectorName) {
  if (ev.pointerType === "touch") return;
  tooltipEl.innerHTML =
    `<b>${s.name}</b> <span style="color:#8d968f">${s.code} · ${sectorName}</span><br>` +
    `현재가 ${s.price.toLocaleString()}원 ` +
    `<span style="color:${s.rate >= 0 ? "#f0736e" : "#7ba3f2"}">${fmtRate(s.rate)}</span><br>` +
    `시가총액 ${fmtCap(s.cap)}`;
  tooltipEl.style.display = "block";
  const pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
  if (x + tw > window.innerWidth - 6) x = ev.clientX - tw - pad;
  if (y + th > window.innerHeight - 6) y = ev.clientY - th - pad;
  tooltipEl.style.left = x + "px";
  tooltipEl.style.top = y + "px";
}
function hideTooltip() { tooltipEl.style.display = "none"; }

/* ---------- 바텀 시트(모바일 상세) ---------- */
function openSheet(s, sectorName) {
  hideTooltip();
  document.getElementById("shName").textContent = s.name;
  document.getElementById("shMeta").textContent = `${s.code} · ${sectorName}`;
  const cls = s.rate >= 0 ? "up" : "down";
  document.getElementById("shBody").innerHTML =
    `현재가 <b>${s.price.toLocaleString()}원</b> ` +
    `<span class="${cls}">${fmtRate(s.rate)} (${s.change > 0 ? "+" : ""}${s.change.toLocaleString()})</span><br>` +
    `시가총액 ${fmtCap(s.cap)}`;
  document.getElementById("shLink").href =
    `https://m.stock.naver.com/domestic/stock/${s.code}/total`;
  sheet.classList.add("open");
}
document.getElementById("shClose").addEventListener("click", () => sheet.classList.remove("open"));
mapEl.addEventListener("click", ev => {
  if (!ev.target.closest(".tile")) sheet.classList.remove("open");
});

/* ---------- 범례 ---------- */
(function buildLegend() {
  const legend = document.getElementById("legend");
  for (const v of [-3, -2, -1, 0, 1, 2, 3]) {
    const b = document.createElement("div");
    b.className = "bucket";
    b.style.background = colorFor(v);
    b.textContent = (v > 0 ? "+" : "") + v + "%";
    legend.appendChild(b);
  }
})();

/* ---------- 갱신 루프 ---------- */
async function refresh() {
  let data = null;
  try {
    data = await loadRealtime();
  } catch (e) {
    try {
      data = await loadSnapshot();
    } catch (e2) {
      if (!lastData) {
        mapEl.innerHTML = `<div id="overlay-msg">데이터를 불러오지 못했습니다.<br>잠시 후 자동으로 다시 시도합니다.</div>`;
      }
      updatedEl.textContent = "갱신 실패";
      return;
    }
  }
  lastData = data;
  updatedEl.textContent = "업데이트 " + data.updated;
  liveBadge.className = "badge " + (data.live ? "live" : "delay");
  liveBadge.textContent = data.live ? "실시간" : "지연";
  if (data.kospi && data.kospi.value) {
    const cls = data.kospi.rate >= 0 ? "up" : "down";
    kospiEl.innerHTML =
      `KOSPI <b>${data.kospi.value.toLocaleString()}</b> <span class="${cls}">${fmtRate(data.kospi.rate)}</span>`;
  }
  render();
}

function tick() {
  if (paused || document.hidden) return;
  remain -= 1;
  countdownEl.textContent = remain + "s";
  if (remain <= 0) {
    remain = Number(intervalSel.value);
    refresh();
  }
}

intervalSel.addEventListener("change", () => { remain = Number(intervalSel.value); });
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "▶" : "⏸";
  countdownEl.textContent = paused ? "정지" : remain + "s";
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && lastData) refresh();  // 화면 복귀 시 즉시 갱신
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

refresh();
setInterval(tick, 1000);
