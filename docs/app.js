/* KOSPI 100 실시간 트리맵 히트맵 — GitHub Pages 정적 버전
 * 1) 같은 저장소의 data.json(GitHub Actions가 장중 10분마다 갱신)을 먼저 즉시 표시
 * 2) CORS 프록시 → 네이버 증권 API 실시간 데이터가 받아지면 그걸로 업그레이드
 */
"use strict";

const TOP_N = 100;

/* 실시간 시세용 CORS 프록시 후보 (순서대로 시도, 성공한 프록시 기억) */
const PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];
let proxyIdx = 0;

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

/* ---------- 정규장/시간외(프리·애프터마켓) 보기 전환 ---------- */
let viewMode = "regular";   // 'regular' | 'over'
let modeAutoSet = false;    // 최초 데이터 기준 자동 선택은 한 번만
const modeSeg = document.getElementById("modeSeg");

function rateOf(s) {
  if (viewMode === "over") return (s.ov && s.ov.price > 0) ? s.ov.rate : 0;
  return s.rate;
}

function sessionLabel(session) {
  if (session === "PRE_MARKET") return "프리마켓";
  if (session === "AFTER_MARKET") return "애프터마켓";
  return "시간외";
}

function setMode(mode) {
  viewMode = mode;
  for (const b of modeSeg.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
  render();
}
modeSeg.addEventListener("click", ev => {
  const btn = ev.target.closest("button");
  if (btn) { modeAutoSet = true; setMode(btn.dataset.mode); }
});

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

async function fetchJson(url, timeoutMs = 8000) {
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

function parseStocks(rows, secs) {
  const stocks = [];
  for (const s of rows) {
    const code = s.itemCode || "";
    if (s.stockEndType !== "stock") continue;             // ETF/ETN 제외
    if (!code || code[code.length - 1] !== "0") continue; // 우선주 제외
    const price = num(s.closePrice);
    const o = s.overMarketPriceInfo || {};
    const ovPrice = num(o.overPrice);
    stocks.push({
      code,
      name: s.stockName || "",
      price,
      change: num(s.compareToPreviousClosePrice),
      rate: num(s.fluctuationsRatio),
      cap: num(s.marketValue),
      sector: secs[code] || "기타",
      ov: {
        price: ovPrice,
        // 시간외 등락률: 직전 정규장 종가 대비
        rate: (ovPrice > 0 && price > 0) ? +(((ovPrice - price) / price) * 100).toFixed(2) : 0,
        session: o.tradingSessionType || "",
        status: o.overMarketStatus || "",
      },
    });
    if (stocks.length >= TOP_N) break;
  }
  return stocks;
}

async function loadRealtime() {
  const secs = await getSectorMap();
  let lastErr = null;
  for (let n = 0; n < PROXIES.length; n++) {
    const idx = (proxyIdx + n) % PROXIES.length;
    const proxy = PROXIES[idx];
    const ts = Date.now();
    try {
      const pages = await Promise.all([1, 2].map(p =>
        fetchJson(proxy(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${p}&pageSize=100&_=${ts}`))
      ));
      const stocks = parseStocks(pages.flatMap(d => d.stocks || []), secs);
      if (stocks.length < 50) throw new Error("종목 수 부족");

      let kospi = null;
      try {
        const k = await fetchJson(proxy(`https://m.stock.naver.com/api/index/KOSPI/basic?_=${ts}`));
        kospi = { value: num(k.closePrice), rate: num(k.fluctuationsRatio) };
      } catch (e) { /* 지수는 없어도 무방 */ }

      proxyIdx = idx;  // 성공한 프록시를 다음에도 우선 사용
      return {
        updated: new Date().toTimeString().slice(0, 8),
        kospi,
        stocks,
        live: true,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("proxy fail");
}

async function loadSnapshot() {
  const d = await fetchJson(`data.json?_=${Date.now()}`);
  if (!d.stocks || d.stocks.length === 0) throw new Error("빈 데이터");
  return {
    updated: (d.updated || "").slice(11) || "-",
    kospi: d.kospi,
    stocks: d.stocks,
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

function apply(data) {
  lastData = data;
  // 시간외 세션 이름(프리마켓/애프터마켓)을 버튼에 반영
  const withOv = data.stocks.find(s => s.ov && s.ov.session);
  const overBtn = modeSeg.querySelector('button[data-mode="over"]');
  if (withOv) overBtn.textContent = sessionLabel(withOv.ov.session);
  // 첫 로드 시 시간외 거래가 진행 중이면 자동으로 시간외 보기
  if (!modeAutoSet) {
    modeAutoSet = true;
    if (data.stocks.some(s => s.ov && s.ov.status === "OPEN")) setMode("over");
  }
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
      const dispRate = rateOf(s);
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.style.cssText =
        `left:${t.x + 1}px;top:${t.y + headH + 1}px;width:${t.w}px;height:${t.h}px;` +
        `background:${colorFor(dispRate)};`;

      addTileText(tile, s.name, dispRate, t.w, t.h);

      tile.addEventListener("mousemove", ev => showTooltip(ev, s, g.name));
      tile.addEventListener("mouseleave", hideTooltip);
      tile.addEventListener("click", () => openSheet(s, g.name));
      secDiv.appendChild(tile);
    });

    mapEl.appendChild(secDiv);
  });
}

/* 타일 안에 종목명(+등락률)을 최대한 크게 배치. 긴 이름은 2줄로 줄바꿈 */
function addTileText(tile, name, rate, w, h) {
  // 글자 폭 추정: 한글 ≈ 1.0em, 영문/숫자/기호 ≈ 0.6em
  let effLen = 0;
  for (const ch of name) effLen += (ch >= "가" && ch <= "힣") ? 1 : 0.6;
  effLen = Math.max(effLen, 1);

  const innerW = w - 3;
  // 1줄 배치와 2줄 배치 중 더 큰 글자가 가능한 쪽 선택
  const f1 = Math.min(h * 0.42, innerW / effLen);
  let f2 = 0, split = 0;
  if (name.length >= 4) {
    split = Math.ceil(name.length / 2);
    let effFirst = 0;
    for (const ch of name.slice(0, split)) effFirst += (ch >= "가" && ch <= "힣") ? 1 : 0.6;
    const effLine = Math.max(effFirst, effLen - effFirst, 1);
    f2 = Math.min(h * 0.27, innerW / effLine);
  }
  const twoLine = f2 > f1;
  const f = Math.min(twoLine ? f2 : f1, 40);
  if (f < 6.5) return;  // 이 크기 밑으로는 읽을 수 없으므로 색상만 표시

  const nm = document.createElement("div");
  nm.className = "nm";
  if (twoLine) {
    nm.append(name.slice(0, split), document.createElement("br"), name.slice(split));
    nm.style.lineHeight = "1.05";
  } else {
    nm.textContent = name;
  }
  nm.style.fontSize = f + "px";
  tile.appendChild(nm);

  // 등락률: 이름을 배치하고 남는 높이에 들어갈 때만
  const usedH = (twoLine ? 2.2 : 1.2) * f;
  const rf = Math.min(f * 0.72, (h - usedH) * 0.8);
  if (rf >= 6) {
    const rt = document.createElement("div");
    rt.className = "rt";
    rt.textContent = fmtRate(rate);
    rt.style.fontSize = rf + "px";
    tile.appendChild(rt);
  }
}

/* ---------- 툴팁(데스크톱) ---------- */
function ovLine(s, sep) {
  if (!s.ov || !(s.ov.price > 0)) return "";
  const c = s.ov.rate >= 0 ? "#f0736e" : "#7ba3f2";
  return `${sessionLabel(s.ov.session)} ${s.ov.price.toLocaleString()}원 ` +
    `<span style="color:${c}">${fmtRate(s.ov.rate)}</span>` +
    `<span style="color:#8d968f"> (종가 대비)</span>${sep}`;
}

function showTooltip(ev, s, sectorName) {
  if (ev.pointerType === "touch") return;
  tooltipEl.innerHTML =
    `<b>${s.name}</b> <span style="color:#8d968f">${s.code} · ${sectorName}</span><br>` +
    `정규장 ${s.price.toLocaleString()}원 ` +
    `<span style="color:${s.rate >= 0 ? "#f0736e" : "#7ba3f2"}">${fmtRate(s.rate)}</span><br>` +
    ovLine(s, "<br>") +
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
  let ovHtml = "";
  if (s.ov && s.ov.price > 0) {
    const ovCls = s.ov.rate >= 0 ? "up" : "down";
    ovHtml =
      `${sessionLabel(s.ov.session)} <b>${s.ov.price.toLocaleString()}원</b> ` +
      `<span class="${ovCls}">${fmtRate(s.ov.rate)}</span>` +
      `<span style="color:#8d968f;font-size:12px"> 종가 대비${s.ov.status === "OPEN" ? " · 거래중" : ""}</span><br>`;
  }
  document.getElementById("shBody").innerHTML =
    `정규장 <b>${s.price.toLocaleString()}원</b> ` +
    `<span class="${cls}">${fmtRate(s.rate)} (${s.change > 0 ? "+" : ""}${s.change.toLocaleString()})</span><br>` +
    ovHtml +
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
function showError() {
  mapEl.innerHTML =
    `<div id="overlay-msg">데이터를 불러오지 못했습니다.<br>잠시 후 자동으로 다시 시도합니다.</div>`;
  updatedEl.textContent = "갱신 실패";
}

async function refresh() {
  // 실시간 데이터가 아직 없으면 같은 저장소의 스냅숏을 병행 로드해서 먼저 그림
  let snapPromise = null;
  if (!lastData || !lastData.live) {
    snapPromise = loadSnapshot()
      .then(d => { if (!lastData || !lastData.live) apply(d); })
      .catch(() => {});
  }
  try {
    apply(await loadRealtime());   // 실시간이 받아지면 스냅숏을 덮어씀
  } catch (e) {
    if (snapPromise) await snapPromise;
    if (!lastData) showError();
    else if (lastData.live) updatedEl.textContent = "갱신 실패 (이전 데이터 표시)";
  }
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
