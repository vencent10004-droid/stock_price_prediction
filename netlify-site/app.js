/* KOSPI 100 실시간 트리맵 히트맵 — GitHub Pages 정적 버전
 * 1) 같은 저장소의 data.json(GitHub Actions가 장중 10분마다 갱신)을 먼저 즉시 표시
 * 2) CORS 프록시 → 네이버 증권 API 실시간 데이터가 받아지면 그걸로 업그레이드
 */
"use strict";

/* ---------- 시장 전환 (코스피 100 / 코스닥 50) ---------- */
const MARKETS = {
  KOSPI: { topN: 100, dataFile: "data.json", sectorFile: "sectors.json" },
  KOSDAQ: { topN: 50, dataFile: "data_kosdaq.json", sectorFile: "sectors_kosdaq.json" },
};
let market = localStorage.getItem("market");
if (!MARKETS[market]) market = "KOSPI";

/* 전용 프록시(Cloudflare Workers 등)를 배포했다면 여기에 URL을 넣으세요.
 * 예: "https://내이름.workers.dev/?url="  (repo의 proxy/cloudflare-worker.js 참고)
 * 설정하면 공개 프록시보다 항상 우선 사용되어 실시간이 안정적으로 동작합니다. */
const MY_PROXY = "";

/* 공개 CORS 프록시 후보 — 매 갱신마다 전부 동시에 시도(race)해서 가장 먼저
 * 성공한 응답을 사용하고, 그 프록시를 localStorage에 기억해 다음에도 우선한다. */
const PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
];
if (MY_PROXY) PROXIES.unshift(u => MY_PROXY + encodeURIComponent(u));
// Netlify에서 서빙 중이면 같은 출처 엣지 프록시(/api/naver/*)를 최우선 사용 — CORS 없음, 항상 실시간
if (location.hostname.endsWith(".netlify.app")) {
  PROXIES.unshift(u => u.replace(/^https:\/\/m\.stock\.naver\.com\//, "/api/naver/"));
}

const promiseAny = ps => Promise.any
  ? Promise.any(ps)
  : new Promise((res, rej) => {
      let n = ps.length;
      ps.forEach(p => p.then(res, () => { if (--n === 0) rej(new Error("all failed")); }));
    });

function fetchViaProxies(url, validate) {
  let order = PROXIES.map((_, i) => i);
  const good = Number(localStorage.getItem("goodProxy"));
  if (!isNaN(good) && good >= 0 && good < PROXIES.length) {
    order = [good, ...order.filter(i => i !== good)];
  }
  return promiseAny(order.map(i =>
    fetchJson(PROXIES[i](url), 7000).then(d => {
      if (validate && !validate(d)) throw new Error("bad payload");
      try { localStorage.setItem("goodProxy", i); } catch (e) { /* 사파리 프라이빗 등 */ }
      return d;
    })
  ));
}

const mapEl = document.getElementById("map");
const canvasEl = document.getElementById("canvas");
const overlayEl = document.getElementById("overlay-msg");
const zoomResetBtn = document.getElementById("zoomReset");
const tooltipEl = document.getElementById("tooltip");
const updatedEl = document.getElementById("updatedAt");
const countdownEl = document.getElementById("countdown");
const kospiEl = document.getElementById("kospiChip");
const intervalSel = document.getElementById("intervalSel");
const pauseBtn = document.getElementById("pauseBtn");
const liveBadge = document.getElementById("liveBadge");
const sheet = document.getElementById("sheet");

let lastData = null;
const sectorMaps = {};      // 시장별 업종 매핑 캐시
let paused = false;
let remain = Number(intervalSel.value);

const marketSeg = document.getElementById("marketSeg");
function syncMarketSeg() {
  for (const b of marketSeg.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.market === market);
  }
}
marketSeg.addEventListener("click", ev => {
  const btn = ev.target.closest("button");
  if (!btn || btn.dataset.market === market) return;
  market = btn.dataset.market;
  try { localStorage.setItem("market", market); } catch (e) { /* 무시 */ }
  syncMarketSeg();
  // 시장이 바뀌면 화면 초기화 후 즉시 재조회
  lastData = null;
  modeAutoSet = false;
  zoom = 1; panX = 0; panY = 0;
  updateZoomBtn();
  canvasEl.innerHTML = "";
  kospiEl.innerHTML = "";
  overlayEl.innerHTML = "시세 데이터를 불러오는 중…";
  overlayEl.style.display = "flex";
  remain = Number(intervalSel.value);
  refresh();
});
syncMarketSeg();

/* ---------- 정규장/시간외(프리·애프터마켓) 보기 전환 ---------- */
let viewMode = "regular";   // 'regular' | 'over'
let modeAutoSet = false;    // 최초 데이터 기준 자동 선택은 한 번만
const modeSeg = document.getElementById("modeSeg");

function rateOf(s) {
  // 시간외 뷰: 시간외 체결이 없는 종목은 정규장 등락률로 표시 (둘 다 전일 종가 대비)
  if (viewMode === "over") return (s.ov && s.ov.price > 0) ? s.ov.rate : s.rate;
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

async function fetchJson(url, timeoutMs = 8000, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", headers });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getSectorMap(m) {
  if (sectorMaps[m]) return sectorMaps[m];
  try {
    sectorMaps[m] = await fetchJson(`${MARKETS[m].sectorFile}?_=${Date.now()}`);
  } catch (e) {
    sectorMaps[m] = {};
  }
  return sectorMaps[m];
}

function parseStocks(rows, secs, topN) {
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
        // 네이버 표기와 동일: 전일 종가 대비 등락률
        rate: num(o.fluctuationsRatio),
        change: num(o.compareToPreviousClosePrice),
        session: o.tradingSessionType || "",
        status: o.overMarketStatus || "",
      },
    });
    if (stocks.length >= topN) break;
  }
  return stocks;
}

async function loadRealtime(m) {
  const cfg = MARKETS[m];
  const secs = await getSectorMap(m);
  const ts = Date.now();
  const okList = d => d && d.stocks && d.stocks.length > 0;
  const pages = await Promise.all([1, 2].map(p =>
    fetchViaProxies(
      `https://m.stock.naver.com/api/stocks/marketValue/${m}?page=${p}&pageSize=100&_=${ts}`,
      okList)
  ));
  const stocks = parseStocks(pages.flatMap(d => d.stocks || []), secs, cfg.topN);
  if (stocks.length < cfg.topN / 2) throw new Error("종목 수 부족");

  let kospi = null;
  try {
    const k = await fetchViaProxies(
      `https://m.stock.naver.com/api/index/${m}/basic?_=${ts}`,
      d => d && d.closePrice);
    kospi = { value: num(k.closePrice), rate: num(k.fluctuationsRatio) };
  } catch (e) { /* 지수는 없어도 무방 */ }

  return {
    market: m,
    updated: new Date().toTimeString().slice(0, 8),
    kospi,
    stocks,
    live: true,
  };
}

/* Actions가 장중 60초마다 갱신하는 data 브랜치 (raw는 CORS 허용이라 프록시 불필요) */
const RAW_BASE =
  "https://raw.githubusercontent.com/vencent10004-droid/stock_price_prediction/data/docs/";

let lastApiFetch = 0;   // GitHub API는 비인증 시간당 60회 제한 → 70초에 1회만

async function loadSnapshot(m) {
  const file = MARKETS[m].dataFile;
  const tryFetch = (url, headers) =>
    fetchJson(url, 6000, headers).then(d => (d && d.stocks && d.stocks.length ? d : null)).catch(() => null);
  // 세 경로를 동시에 시도해 가장 최신 데이터 사용:
  // raw(분 단위, 일부 통신망에서 차단됨) / Pages(5분 단위) / GitHub API(분 단위, 횟수 제한)
  const cands = [
    tryFetch(`${RAW_BASE}${file}?_=${Date.now()}`),
    tryFetch(`${file}?_=${Date.now()}`),
  ];
  if (Date.now() - lastApiFetch > 70000) {
    lastApiFetch = Date.now();
    cands.push(tryFetch(
      `https://api.github.com/repos/vencent10004-droid/stock_price_prediction/contents/docs/${file}?ref=data`,
      { Accept: "application/vnd.github.raw+json" }));
  }
  const results = await Promise.all(cands);
  let d = null;
  for (const r of results) {
    if (r && (!d || (r.updated || "") > (d.updated || ""))) d = r;
  }
  if (!d) throw new Error("빈 데이터");
  return {
    market: m,
    updated: (d.updated || "").slice(11) || "-",
    updatedFull: d.updated || "",
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
  if (data.market !== market) return;  // 조회 중 시장이 바뀐 경우 폐기
  data.fetchedAt = Date.now();
  lastData = data;
  // 시간외 세션 이름(프리마켓/애프터마켓)을 버튼에 반영
  const withOv = data.stocks.find(s => s.ov && s.ov.session);
  const overBtn = modeSeg.querySelector('button[data-mode="over"]');
  if (withOv) overBtn.textContent = sessionLabel(withOv.ov.session);
  // 첫 로드 시 프리마켓/애프터마켓이 진행 중이면 자동으로 시간외 보기
  // (정규장 중 NXT 병행 거래는 OPEN이어도 정규장 뷰 유지)
  if (!modeAutoSet) {
    modeAutoSet = true;
    if (data.stocks.some(s => s.ov && s.ov.status === "OPEN" &&
        (s.ov.session === "PRE_MARKET" || s.ov.session === "AFTER_MARKET"))) {
      setMode("over");
    }
  }
  // 오늘 데이터가 아니면 날짜까지 표시해서 혼동 방지
  let label = data.updated;
  if (data.updatedFull) {
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    if (!data.updatedFull.startsWith(today)) label = data.updatedFull.slice(5, 16);
  }
  updatedEl.textContent = "업데이트 " + label;
  if (data.live) {
    liveBadge.className = "badge live";
    liveBadge.textContent = "실시간";
  } else {
    // 스냅숏 데이터가 얼마나 지났는지 표시 (기기 시간 기준)
    let ageMin = 0;
    if (data.updatedFull) {
      const t = new Date(data.updatedFull.replace(" ", "T")).getTime();
      ageMin = Math.round((Date.now() - t) / 60000);
    }
    if (ageMin <= 2) {
      liveBadge.className = "badge semi";
      liveBadge.textContent = "준실시간";
    } else {
      liveBadge.className = "badge delay";
      liveBadge.textContent = ageMin >= 90
        ? `지연 ${Math.round(ageMin / 60)}시간`
        : `지연 ${ageMin}분`;
    }
  }
  if (data.kospi && data.kospi.value) {
    const cls = data.kospi.rate >= 0 ? "up" : "down";
    kospiEl.innerHTML =
      `${data.market} <b>${data.kospi.value.toLocaleString()}</b> <span class="${cls}">${fmtRate(data.kospi.rate)}</span>`;
  }
  render();
}

function render() {
  if (!lastData) return;
  overlayEl.style.display = "none";
  canvasEl.innerHTML = "";
  const baseW = mapEl.clientWidth, baseH = mapEl.clientHeight;
  if (baseW < 50 || baseH < 50) return;
  // 확대 배율만큼 큰 캔버스에 그리면 작은 타일도 커져서 글자가 나타난다
  const W = baseW * zoom, H = baseH * zoom;
  clampPan();
  canvasEl.style.width = W + "px";
  canvasEl.style.height = H + "px";
  canvasEl.style.left = panX + "px";
  canvasEl.style.top = panY + "px";
  canvasEl.style.transform = "";

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

    canvasEl.appendChild(secDiv);
  });
}

/* ---------- 확대/축소(핀치 줌)·이동 ---------- */
let zoom = 1, panX = 0, panY = 0;

function clampPan() {
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  panX = Math.min(0, Math.max(W - W * zoom, panX));
  panY = Math.min(0, Math.max(H - H * zoom, panY));
}

function updateZoomBtn() {
  zoomResetBtn.style.display = zoom > 1.01 ? "block" : "none";
  zoomResetBtn.textContent = Math.round(zoom * 100) + "% ⟲";
}

/* (cx, cy): #map 좌표 기준으로 화면에 고정할 점 */
function setZoom(z, cx, cy) {
  z = Math.max(1, Math.min(10, z));
  const px = (cx - panX) / zoom, py = (cy - panY) / zoom;
  zoom = z;
  panX = cx - px * zoom;
  panY = cy - py * zoom;
  render();
  updateZoomBtn();
}

zoomResetBtn.addEventListener("click", () => {
  zoom = 1; panX = 0; panY = 0;
  render();
  updateZoomBtn();
});

let gesture = null;       // 진행 중인 터치 제스처
let movedDist = 0;        // 제스처 이동량 (탭과 구분)
let lastTap = { t: 0, x: 0, y: 0 };

const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

mapEl.addEventListener("touchstart", ev => {
  if (ev.touches.length === 2) {
    const [a, b] = ev.touches;
    gesture = {
      mode: "pinch",
      d0: dist(a, b), c0: mid(a, b),
      z0: zoom, panX0: panX, panY0: panY,
      pending: null,
    };
  } else if (ev.touches.length === 1 && zoom > 1) {
    const t = ev.touches[0];
    gesture = { mode: "pan", x0: t.clientX, y0: t.clientY, panX0: panX, panY0: panY };
  }
}, { passive: true });

mapEl.addEventListener("touchmove", ev => {
  if (!gesture) return;
  const rect = mapEl.getBoundingClientRect();
  if (gesture.mode === "pinch" && ev.touches.length === 2) {
    const [a, b] = ev.touches;
    const z = Math.max(1, Math.min(10, gesture.z0 * dist(a, b) / gesture.d0));
    // 시작 시 두 손가락 중심이 가리키던 지점을 현재 중심에 고정
    const p = {
      x: (gesture.c0.x - rect.left - gesture.panX0) / gesture.z0,
      y: (gesture.c0.y - rect.top - gesture.panY0) / gesture.z0,
    };
    const c = mid(a, b);
    const nPanX = (c.x - rect.left) - p.x * z;
    const nPanY = (c.y - rect.top) - p.y * z;
    gesture.pending = { z, panX: nPanX, panY: nPanY };
    // 제스처 중에는 CSS transform으로 미리보기만 (손을 떼면 다시 그림)
    canvasEl.style.transform =
      `translate(${nPanX - panX}px, ${nPanY - panY}px) scale(${z / zoom})`;
    movedDist += 5;
  } else if (gesture.mode === "pan" && ev.touches.length === 1) {
    const t = ev.touches[0];
    const dx = t.clientX - gesture.x0, dy = t.clientY - gesture.y0;
    movedDist = Math.max(movedDist, Math.abs(dx) + Math.abs(dy));
    panX = gesture.panX0 + dx;
    panY = gesture.panY0 + dy;
    clampPan();
    canvasEl.style.left = panX + "px";
    canvasEl.style.top = panY + "px";
  }
}, { passive: true });

mapEl.addEventListener("touchend", ev => {
  if (gesture && gesture.mode === "pinch" && gesture.pending) {
    zoom = gesture.pending.z;
    panX = gesture.pending.panX;
    panY = gesture.pending.panY;
    render();          // 확정 배율로 다시 그리면 글자 표시 기준도 재계산됨
    updateZoomBtn();
  }
  if (ev.touches.length === 0) {
    // 더블탭: 확대 <-> 원복
    if (movedDist < 12 && ev.changedTouches.length === 1) {
      const t = ev.changedTouches[0];
      const now = Date.now();
      if (now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40) {
        const rect = mapEl.getBoundingClientRect();
        if (zoom > 1.01) { zoom = 1; panX = 0; panY = 0; render(); updateZoomBtn(); }
        else setZoom(2.5, t.clientX - rect.left, t.clientY - rect.top);
        lastTap = { t: 0, x: 0, y: 0 };
      } else {
        lastTap = { t: now, x: t.clientX, y: t.clientY };
      }
    }
    gesture = null;
    setTimeout(() => { movedDist = 0; }, 80);
  } else if (gesture && gesture.mode === "pinch") {
    gesture = null;
  }
}, { passive: true });

/* 드래그/핀치 직후 발생하는 클릭이 종목 시트를 열지 않도록 차단 */
mapEl.addEventListener("click", ev => {
  if (movedDist >= 12) {
    ev.stopPropagation();
    ev.preventDefault();
  }
}, true);

/* PC: 마우스 휠로 확대/축소 */
mapEl.addEventListener("wheel", ev => {
  ev.preventDefault();
  const rect = mapEl.getBoundingClientRect();
  const factor = ev.deltaY < 0 ? 1.25 : 1 / 1.25;
  setZoom(zoom * factor, ev.clientX - rect.left, ev.clientY - rect.top);
}, { passive: false });

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
/* 시간외 가격의 당일 종가 대비 변동률 (순수 시간외 변동분) */
function ovVsClose(s) {
  if (!s.ov || !(s.ov.price > 0) || !(s.price > 0)) return null;
  return ((s.ov.price - s.price) / s.price) * 100;
}

function ovLine(s, sep) {
  if (!s.ov || !(s.ov.price > 0)) return "";
  const c = s.ov.rate >= 0 ? "#f0736e" : "#7ba3f2";
  const vs = ovVsClose(s);
  return `${sessionLabel(s.ov.session)} ${s.ov.price.toLocaleString()}원 ` +
    `<span style="color:${c}">${fmtRate(s.ov.rate)}</span>` +
    `<span style="color:#8d968f"> 전일 대비 · 종가 대비 ${fmtRate(vs)}</span>${sep}`;
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
    const chg = s.ov.change || 0;
    ovHtml =
      `${sessionLabel(s.ov.session)} <b>${s.ov.price.toLocaleString()}원</b> ` +
      `<span class="${ovCls}">${fmtRate(s.ov.rate)} (${chg > 0 ? "+" : ""}${chg.toLocaleString()})</span><br>` +
      `<span style="color:#8d968f;font-size:12px">당일 종가 대비 ${fmtRate(ovVsClose(s))}` +
      `${s.ov.status === "OPEN" ? " · 거래중" : ""}</span><br>`;
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
  overlayEl.innerHTML = "데이터를 불러오지 못했습니다.<br>잠시 후 자동으로 다시 시도합니다.";
  overlayEl.style.display = "flex";
  updatedEl.textContent = "갱신 실패";
}

async function refresh() {
  const m = market;
  // 실시간 데이터가 아직 없으면 같은 저장소의 스냅숏을 병행 로드해서 먼저 그림
  let snapPromise = null;
  if (!lastData || !lastData.live) {
    snapPromise = loadSnapshot(m)
      .then(d => { if (!lastData || !lastData.live) apply(d); })
      .catch(() => {});
  }
  try {
    apply(await loadRealtime(m));   // 실시간이 받아지면 스냅숏을 덮어씀
  } catch (e) {
    if (snapPromise) await snapPromise;
    if (!lastData && m === market) showError();
    else if (lastData && lastData.live) updatedEl.textContent = "갱신 실패 (이전 데이터 표시)";
  }
}

function tick() {
  if (paused || document.hidden) return;
  // 감시: 타이머가 절전 등으로 멈췄다 재개되어 데이터가 오래됐으면 즉시 갱신
  const interval = Number(intervalSel.value);
  if (lastData && lastData.fetchedAt && Date.now() - lastData.fetchedAt > interval * 3000) {
    lastData.fetchedAt = Date.now();  // 중복 트리거 방지
    remain = interval;
    refresh();
    return;
  }
  remain -= 1;
  countdownEl.textContent = remain + "s";
  if (remain <= 0) {
    remain = interval;
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
// 인앱 브라우저가 저장된 화면을 복원하거나(bfcache) 앱 전환 후 돌아왔을 때도 갱신
window.addEventListener("pageshow", ev => {
  if (ev.persisted && lastData) refresh();
});
window.addEventListener("focus", () => {
  if (lastData && lastData.fetchedAt && Date.now() - lastData.fetchedAt > 60000) refresh();
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

/* ---------- 앱 설치 버튼 (Chrome 등 설치 지원 브라우저) ---------- */
const installBtn = document.getElementById("installBtn");
let installPrompt = null;
window.addEventListener("beforeinstallprompt", ev => {
  ev.preventDefault();
  installPrompt = ev;
  installBtn.style.display = "inline-block";
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.style.display = "none";
});
window.addEventListener("appinstalled", () => {
  installBtn.style.display = "none";
});

refresh();
setInterval(tick, 1000);
