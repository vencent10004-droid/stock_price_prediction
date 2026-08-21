/* KOSPI 100 실시간 트리맵 히트맵 */
"use strict";

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

let lastData = null;
let paused = false;
let remain = Number(intervalSel.value);

/* ---------- 시장 전환 (코스피 100 / 코스닥 50) ---------- */
let market = localStorage.getItem("market");
if (market !== "KOSPI" && market !== "KOSDAQ") market = "KOSPI";
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

/* ---------- 색상: 등락률 → KOSPD 스타일 파랑(하락)~빨강(상승) ---------- */
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

/* ---------- 스퀘리파이 트리맵 레이아웃 ---------- */
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

  // 업종별 그룹화
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

    // 업종 제목 바 (공간이 있을 때만)
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
      tile.addEventListener("click", () =>
        window.open(`https://m.stock.naver.com/domestic/stock/${s.code}/total`, "_blank"));
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

/* 드래그/핀치 직후 발생하는 클릭이 종목 페이지를 열지 않도록 차단 */
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

/* 시간외 가격의 당일 종가 대비 변동률 (순수 시간외 변동분) */
function ovVsClose(s) {
  if (!s.ov || !(s.ov.price > 0) || !(s.price > 0)) return null;
  return ((s.ov.price - s.price) / s.price) * 100;
}

function ovLine(s) {
  if (!s.ov || !(s.ov.price > 0)) return "";
  const c = s.ov.rate >= 0 ? "#f0736e" : "#7ba3f2";
  return `${sessionLabel(s.ov.session)} ${s.ov.price.toLocaleString()}원 ` +
    `<span style="color:${c}">${fmtRate(s.ov.rate)}</span>` +
    `<span style="color:#8d968f"> 전일 대비 · 종가 대비 ${fmtRate(ovVsClose(s))}` +
    `${s.ov.status === "OPEN" ? " · 거래중" : ""}</span><br>`;
}

function showTooltip(ev, s, sectorName) {
  tooltipEl.innerHTML =
    `<b>${s.name}</b> <span style="color:#8d968f">${s.code} · ${sectorName}</span><br>` +
    `정규장 ${s.price.toLocaleString()}원 ` +
    `<span style="color:${s.rate >= 0 ? "#f0736e" : "#7ba3f2"}">${fmtRate(s.rate)} (${s.change > 0 ? "+" : ""}${s.change.toLocaleString()})</span><br>` +
    ovLine(s) +
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

/* ---------- 범례 ---------- */
function buildLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";
  for (const v of [-3, -2, -1, 0, 1, 2, 3]) {
    const b = document.createElement("div");
    b.className = "bucket";
    b.style.background = colorFor(v);
    b.textContent = (v > 0 ? "+" : "") + v + "%";
    legend.appendChild(b);
  }
}

/* ---------- 데이터 갱신 루프 ---------- */
async function refresh() {
  try {
    const res = await fetch(`/api/heatmap?market=${market}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.market && data.market !== market) return;  // 조회 중 시장이 바뀐 경우 폐기
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
    updatedEl.textContent = "업데이트 " + data.updated.slice(11);
    if (data.kospi && data.kospi.value) {
      const k = data.kospi;
      const cls = k.rate >= 0 ? "up" : "down";
      kospiEl.innerHTML =
        `${market} <b>${k.value.toLocaleString()}</b> <span class="${cls}">${fmtRate(k.rate)}</span>`;
    }
    render();
  } catch (e) {
    if (!lastData) {
      overlayEl.innerHTML = "데이터를 불러오지 못했습니다.<br>잠시 후 자동으로 다시 시도합니다.";
      overlayEl.style.display = "flex";
    }
    updatedEl.textContent = "갱신 실패 (" + new Date().toTimeString().slice(0, 8) + ")";
  }
}

function tick() {
  if (paused) return;
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

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

buildLegend();
refresh();
remain = Number(intervalSel.value);
setInterval(tick, 1000);
