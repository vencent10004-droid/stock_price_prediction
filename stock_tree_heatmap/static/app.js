/* KOSPI 100 실시간 트리맵 히트맵 */
"use strict";

const mapEl = document.getElementById("map");
const tooltipEl = document.getElementById("tooltip");
const updatedEl = document.getElementById("updatedAt");
const countdownEl = document.getElementById("countdown");
const kospiEl = document.getElementById("kospiChip");
const intervalSel = document.getElementById("intervalSel");
const pauseBtn = document.getElementById("pauseBtn");

let lastData = null;
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
  mapEl.innerHTML = "";
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  if (W < 50 || H < 50) return;

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
    const res = await fetch("/api/heatmap");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
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
    updatedEl.textContent = "업데이트 " + data.updated.slice(11);
    if (data.kospi && data.kospi.value) {
      const k = data.kospi;
      const cls = k.rate >= 0 ? "up" : "down";
      kospiEl.innerHTML =
        `KOSPI <b>${k.value.toLocaleString()}</b> <span class="${cls}">${fmtRate(k.rate)}</span>`;
    }
    render();
  } catch (e) {
    if (!lastData) {
      mapEl.innerHTML = `<div id="overlay-msg">데이터를 불러오지 못했습니다: ${e.message} — 자동으로 재시도합니다.</div>`;
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
