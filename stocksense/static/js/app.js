let currentTicker = null;
let currentName = null;

function selectTicker(code, name) {
  currentTicker = code;
  currentName = name;
  document.querySelectorAll(".ticker-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("btn-" + code).classList.add("active");
  document.getElementById("panel-title").textContent = name + " (" + code + ")";
  document.getElementById("main-panel").style.display = "block";
  document.getElementById("prediction-content").innerHTML = '<div class="loading">예측 조회 버튼을 눌러주세요.</div>';
  document.getElementById("history-content").innerHTML = '<div class="loading">백테스트 버튼을 눌러 기록을 불러오세요.</div>';
  switchTab("prediction");
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t, i) => {
    const names = ["prediction", "chart", "history", "logs"];
    t.classList.toggle("active", names[i] === name);
  });
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
}

let chartDays = 90;       // 30 | 90 | 180
let chartType = "candle"; // "candle" | "line"
let showBB = false, showRSI = false, showMACD = false;  // 보조지표 토글
let lastChartData = null;

async function loadChart(days) {
  if (!currentTicker) return;
  if (days) chartDays = days;
  const el = document.getElementById("chart-content");
  el.innerHTML = '<div class="loading">주가 차트 로딩 중...</div>';
  switchTab("chart");
  try {
    const res = await fetch("/api/chart/" + currentTicker + "?days=" + chartDays);
    if (!res.ok) {
      const err = await res.json();
      el.innerHTML = '<div class="error">오류: ' + (err.detail || res.status) + '</div>';
      return;
    }
    lastChartData = await res.json();
    renderChart(el, lastChartData);
  } catch (e) {
    el.innerHTML = '<div class="error">네트워크 오류: ' + e.message + '</div>';
  }
}

function setChartType(t) {
  chartType = t;
  if (lastChartData) renderChart(document.getElementById("chart-content"), lastChartData);
}

function toggleInd(k) {
  if (k === "bb") showBB = !showBB;
  else if (k === "rsi") showRSI = !showRSI;
  else if (k === "macd") showMACD = !showMACD;
  if (lastChartData) renderChart(document.getElementById("chart-content"), lastChartData);
}

function buildChartInsight(a) {
  const { close, ma5, ma20, bbU, bbL, rsi, hist, vol, n, chgPct, UP, DOWN } = a;
  const lastVal = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  const c = close[n - 1], m5 = lastVal(ma5), m20 = lastVal(ma20), rv = lastVal(rsi), hv = lastVal(hist);
  const bu = lastVal(bbU), bl = lastVal(bbL);

  // 추세 (이동평균 배열 + 종가 위치)
  let trend = "혼조/횡보", tcol = "#94A3B8";
  if (m5 != null && m20 != null) {
    if (c >= m20 && m5 >= m20) { trend = "상승 추세"; tcol = UP; }
    else if (c < m20 && m5 < m20) { trend = "하락 추세"; tcol = DOWN; }
  }

  const bullets = [];
  // 이동평균 배열 상태
  if (m5 != null && m20 != null) {
    bullets.push(m5 >= m20
      ? `단기선(MA5)이 중기선(MA20) <b style="color:${UP}">위</b> — 단기 상승 우위`
      : `단기선(MA5)이 중기선(MA20) <b style="color:${DOWN}">아래</b> — 단기 약세`);
  }
  // 골든/데드크로스 (최근 6봉)
  if (ma5.length === n && ma20.length === n) {
    for (let i = n - 1; i >= Math.max(1, n - 6); i--) {
      if (ma5[i] != null && ma20[i] != null && ma5[i - 1] != null && ma20[i - 1] != null) {
        const now = ma5[i] - ma20[i], prev = ma5[i - 1] - ma20[i - 1];
        if (prev <= 0 && now > 0) { bullets.push(`⭐ 최근 <b style="color:${UP}">골든크로스</b> 발생 — 상승 전환 신호`); break; }
        if (prev >= 0 && now < 0) { bullets.push(`⚠️ 최근 <b style="color:${DOWN}">데드크로스</b> 발생 — 하락 전환 신호`); break; }
      }
    }
  }
  // MACD
  if (hv != null) bullets.push(hv > 0
    ? `MACD 히스토그램 <b style="color:${UP}">양(+)</b> — 상승 모멘텀 우위`
    : `MACD 히스토그램 <b style="color:${DOWN}">음(−)</b> — 하락 모멘텀 우위`);
  // RSI
  if (rv != null) bullets.push(rv >= 70
    ? `RSI <b style="color:${UP}">${rv.toFixed(0)}</b> — 과매수 구간, 단기 조정 주의`
    : rv <= 30 ? `RSI <b style="color:${DOWN}">${rv.toFixed(0)}</b> — 과매도 구간, 반등 가능성`
    : `RSI ${rv.toFixed(0)} — 중립 구간`);
  // 볼린저 위치
  if (bu != null && bl != null && bu > bl) {
    const pos = (c - bl) / (bu - bl);
    if (pos >= 0.8) bullets.push(`주가가 볼린저 <b style="color:${UP}">상단</b> 부근 — 단기 과열 가능`);
    else if (pos <= 0.2) bullets.push(`주가가 볼린저 <b style="color:${DOWN}">하단</b> 부근 — 낙폭 과대 가능`);
    else bullets.push(`주가가 볼린저 중앙권 — 추세 방향 확인 필요`);
  }
  // 거래량
  if (vol.length) {
    const k = Math.min(5, vol.length);
    const recent = vol.slice(-k).reduce((x, y) => x + y, 0) / k;
    const base = vol.reduce((x, y) => x + y, 0) / vol.length;
    if (base > 0) {
      const r = recent / base;
      bullets.push(r > 1.3 ? `최근 거래량 <b>증가</b> (평균 대비 ${r.toFixed(1)}배) — 관심 유입`
        : r < 0.7 ? `최근 거래량 <b>감소</b> — 관망세` : `거래량 평균 수준`);
    }
  }

  const summary = `최근 ${n}거래일 <b style="color:${chgPct >= 0 ? UP : DOWN}">${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(1)}%</b>, `
    + `현재 <b style="color:${tcol}">${trend}</b>로 판단됩니다. 지표들은 ${bulletsBias(bullets, UP, DOWN)}.`;

  return `
    <div style="background:#0F172A;border:1px solid #1E293B;border-left:3px solid #3B82F6;border-radius:8px;padding:14px 16px;margin-top:12px">
      <div style="font-size:0.9rem;font-weight:700;margin-bottom:8px">📈 차트 해석 <span style="font-size:0.72rem;color:#64748B;font-weight:400">· AI 기술적 분석</span></div>
      <div style="font-size:0.86rem;line-height:1.6;color:#CBD5E1;margin-bottom:10px">${summary}</div>
      <ul style="margin:0 0 8px 18px;padding:0;font-size:0.82rem;line-height:1.7;color:#CBD5E1">
        ${bullets.map(b => `<li>${b}</li>`).join('')}
      </ul>
      <div style="font-size:0.72rem;color:#64748B">※ 과거 데이터 기반 기술적 참고 해석이며, 투자 권유가 아닙니다. 투자 판단과 책임은 본인에게 있습니다.</div>
    </div>`;
}

// 상승/하락 신호 개수로 종합 편향 문구
function bulletsBias(bullets, UP, DOWN) {
  const txt = bullets.join(" ");
  const up = (txt.match(new RegExp(UP, "g")) || []).length;
  const dn = (txt.match(new RegExp(DOWN, "g")) || []).length;
  if (up > dn) return `<b style="color:${UP}">상승 우호적 신호</b>가 우세합니다`;
  if (dn > up) return `<b style="color:${DOWN}">하락 경계 신호</b>가 우세합니다`;
  return `상승·하락 신호가 <b>혼재</b>합니다`;
}

function renderChart(el, d) {
  const close = d.close || [], dates = d.dates || [], ma5 = d.ma5 || [], ma20 = d.ma20 || [], vol = d.volume || [];
  const open = d.open || [], high = d.high || [], low = d.low || [];
  const bbU = d.bb_upper || [], bbL = d.bb_lower || [];
  const rsi = d.rsi || [], macd = d.macd || [], sig = d.macd_signal || [], hist = d.macd_hist || [];
  const n = close.length;
  if (!n) { el.innerHTML = '<div class="loading">차트 데이터가 없습니다.</div>'; return; }
  const hasOHLC = open.length === n && high.length === n && low.length === n;
  const candle = chartType === "candle" && hasOHLC;
  const UP = "#EF4444", DOWN = "#3B82F6";

  // ── 패널 동적 배치 ──
  const W = 760, padL = 6, padR = 66, padT = 14, gap = 26;
  const priceH = 240, volH = 46, subH = 62;
  let y = padT;
  const priceTop = y; y += priceH + gap;
  const volTop = y;   y += volH + gap;
  let rsiTop = null, macdTop = null;
  if (showRSI)  { rsiTop = y;  y += subH + gap; }
  if (showMACD) { macdTop = y; y += subH + gap; }
  const lastBottom = y - gap;
  const H = lastBottom + 20;
  const xLabelY = lastBottom + 14;
  const xs = i => padL + (W - padL - padR) * (n === 1 ? 0 : i / (n - 1));

  // ── 가격 범위 ──
  const bbVals = showBB ? [...bbU.filter(v => v != null), ...bbL.filter(v => v != null)] : [];
  const priceVals = [...(candle ? [...high, ...low] : close),
                     ...ma5.filter(v => v != null), ...ma20.filter(v => v != null), ...bbVals];
  let lo = Math.min(...priceVals), hi = Math.max(...priceVals);
  const gp = (hi - lo) * 0.08 || 1; lo -= gp; hi += gp;
  const py = v => priceTop + priceH * (1 - (v - lo) / (hi - lo));
  const poly = (arr, f) => arr.map((v, i) => v == null ? null : `${xs(i).toFixed(1)},${f(v).toFixed(1)}`)
                              .filter(Boolean).join(' ');

  // 가격 그리드 + 라벨
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const val = lo + (hi - lo) * k / 4, yy = py(val);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#1E293B"/>`;
    grid += `<text x="${W - padR + 6}" y="${(yy + 3).toFixed(1)}" fill="#64748B" font-size="10">${Math.round(val).toLocaleString()}</text>`;
  }

  // 볼린저밴드 오버레이
  let bb = '';
  if (showBB) {
    const upPts = bbU.map((v, i) => v == null ? null : `${xs(i).toFixed(1)},${py(v).toFixed(1)}`).filter(Boolean);
    const lwPts = bbL.map((v, i) => v == null ? null : `${xs(i).toFixed(1)},${py(v).toFixed(1)}`).filter(Boolean).reverse();
    if (upPts.length && lwPts.length)
      bb += `<polygon points="${upPts.concat(lwPts).join(' ')}" fill="#8B5CF6" opacity="0.10"/>`;
    bb += `<polyline points="${poly(bbU, py)}" fill="none" stroke="#8B5CF6" stroke-width="1" opacity="0.75"/>`;
    bb += `<polyline points="${poly(bbL, py)}" fill="none" stroke="#8B5CF6" stroke-width="1" opacity="0.75"/>`;
  }

  // 거래량 막대
  const vmax = Math.max(...vol, 1);
  const bw = Math.max(1.2, (W - padL - padR) / n * 0.6);
  let bars = '';
  for (let i = 0; i < n; i++) {
    const h = volH * (vol[i] / vmax);
    const up = hasOHLC ? close[i] >= open[i] : (i === 0 ? true : close[i] >= close[i - 1]);
    bars += `<rect x="${(xs(i) - bw / 2).toFixed(1)}" y="${(volTop + volH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up ? UP : DOWN}" opacity="0.5"/>`;
  }

  // 메인 시리즈 (캔들/라인) + MA
  let series = '';
  if (candle) {
    for (let i = 0; i < n; i++) {
      const o = open[i], c = close[i], h = high[i], l = low[i];
      const up = c >= o, col = up ? UP : DOWN, X = xs(i);
      const top = py(Math.max(o, c)), bot = py(Math.min(o, c)), bh = Math.max(1, bot - top);
      series += `<line x1="${X.toFixed(1)}" y1="${py(h).toFixed(1)}" x2="${X.toFixed(1)}" y2="${py(l).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
      series += `<rect x="${(X - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
    }
  } else {
    const lastP = close[n - 1], firstP = close[0], lc = lastP >= firstP ? UP : DOWN, lx = xs(n - 1), ly = py(lastP);
    series = `<polyline points="${poly(close, py)}" fill="none" stroke="#E2E8F0" stroke-width="1.8"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="${lc}"/>
      <text x="${(lx - 6).toFixed(1)}" y="${(ly - 8).toFixed(1)}" fill="${lc}" font-size="11" font-weight="700" text-anchor="end">${lastP.toLocaleString()}</text>`;
  }
  series += `<polyline points="${poly(ma20, py)}" fill="none" stroke="#FBBF24" stroke-width="1.3" opacity="0.9"/>
             <polyline points="${poly(ma5, py)}" fill="none" stroke="#22C55E" stroke-width="1.3" opacity="0.9"/>`;

  // RSI 패널
  let rsiPanel = '';
  if (showRSI) {
    const ry = v => rsiTop + subH * (1 - Math.max(0, Math.min(100, v)) / 100);
    [[70, "#7F1D1D"], [50, "#334155"], [30, "#155E45"]].forEach(([lv, c]) =>
      rsiPanel += `<line x1="${padL}" y1="${ry(lv).toFixed(1)}" x2="${W - padR}" y2="${ry(lv).toFixed(1)}" stroke="${c}" stroke-dasharray="3 3"/>`);
    rsiPanel += `<text x="${W - padR + 6}" y="${(ry(70) + 3).toFixed(1)}" fill="#64748B" font-size="9">70</text>`;
    rsiPanel += `<text x="${W - padR + 6}" y="${(ry(30) + 3).toFixed(1)}" fill="#64748B" font-size="9">30</text>`;
    rsiPanel += `<polyline points="${poly(rsi, ry)}" fill="none" stroke="#A78BFA" stroke-width="1.3"/>`;
    const cur = [...rsi].reverse().find(v => v != null);
    rsiPanel += `<text x="${padL + 2}" y="${(rsiTop + 12).toFixed(1)}" fill="#A78BFA" font-size="10" font-weight="700">RSI(14) ${cur != null ? cur.toFixed(1) : '-'}</text>`;
  }

  // MACD 패널
  let macdPanel = '';
  if (showMACD) {
    const vals = [...macd, ...sig, ...hist].filter(v => v != null).map(Math.abs);
    const m = Math.max(...vals, 1e-9);
    const my = v => macdTop + subH * (1 - (v + m) / (2 * m));
    macdPanel += `<line x1="${padL}" y1="${my(0).toFixed(1)}" x2="${W - padR}" y2="${my(0).toFixed(1)}" stroke="#334155"/>`;
    const mbw = Math.max(1, (W - padL - padR) / n * 0.5);
    for (let i = 0; i < n; i++) {
      if (hist[i] == null) continue;
      const zero = my(0), hy = my(hist[i]), top = Math.min(zero, hy), h = Math.max(1, Math.abs(hy - zero));
      macdPanel += `<rect x="${(xs(i) - mbw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${mbw.toFixed(1)}" height="${h.toFixed(1)}" fill="${hist[i] >= 0 ? UP : DOWN}" opacity="0.55"/>`;
    }
    macdPanel += `<polyline points="${poly(macd, my)}" fill="none" stroke="#38BDF8" stroke-width="1.2"/>`;
    macdPanel += `<polyline points="${poly(sig, my)}" fill="none" stroke="#F59E0B" stroke-width="1.2"/>`;
    macdPanel += `<text x="${padL + 2}" y="${(macdTop + 12).toFixed(1)}" fill="#94A3B8" font-size="10" font-weight="700">MACD(12,26,9)</text>`;
  }

  const last = close[n - 1], first = close[0];
  const chgPct = ((last - first) / first * 100), lastColor = last >= first ? UP : DOWN;
  const midIdx = Math.floor((n - 1) / 2);
  const xlabels = [0, midIdx, n - 1].map(i =>
    `<text x="${xs(i).toFixed(1)}" y="${xLabelY}" fill="#64748B" font-size="10" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${dates[i].slice(2)}</text>`).join('');

  const on = "background:#1E3A8A;color:#93C5FD;border-color:#3B82F6";
  const pBtn = (dv, lbl) => `<button class="btn btn-sm" onclick="loadChart(${dv})" style="${chartDays === dv ? on : ''}">${lbl}</button>`;
  const tBtn = (tv, lbl) => `<button class="btn btn-sm" onclick="setChartType('${tv}')" style="${chartType === tv ? on : ''}">${lbl}</button>`;
  const iBtn = (kv, lbl, active) => `<button class="btn btn-sm" onclick="toggleInd('${kv}')" style="${active ? on : ''}">${lbl}</button>`;

  const insight = buildChartInsight({ close, ma5, ma20, bbU, bbL, rsi, hist, vol, n, chgPct, UP, DOWN });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
      <div style="font-size:0.95rem;font-weight:700">${d.ticker_name} 최근 ${n}거래일</div>
      <div style="font-size:0.85rem">
        <span style="color:#94A3B8">현재가</span>
        <b>${last.toLocaleString()}원</b>
        <span style="color:${lastColor};margin-left:6px">${chgPct >= 0 ? '▲' : '▼'}${Math.abs(chgPct).toFixed(2)}% (기간)</span>
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      ${pBtn(30, '30일')}${pBtn(90, '90일')}${pBtn(180, '180일')}
      <span style="width:1px;height:20px;background:#334155;margin:0 4px"></span>
      ${tBtn('candle', '캔들')}${tBtn('line', '라인')}
      <span style="width:1px;height:20px;background:#334155;margin:0 4px"></span>
      ${iBtn('bb', '볼린저', showBB)}${iBtn('rsi', 'RSI', showRSI)}${iBtn('macd', 'MACD', showMACD)}
    </div>
    <div style="display:flex;gap:14px;font-size:0.75rem;color:#94A3B8;margin-bottom:6px;flex-wrap:wrap">
      ${candle ? '<span><span style="color:#EF4444">▮</span>/<span style="color:#3B82F6">▮</span> 캔들</span>' : '<span><span style="color:#E2E8F0">━</span> 종가</span>'}
      <span><span style="color:#22C55E">━</span> MA5</span>
      <span><span style="color:#FBBF24">━</span> MA20</span>
      ${showBB ? '<span><span style="color:#8B5CF6">━</span> 볼린저</span>' : ''}
      <span style="margin-left:auto"><span style="color:#EF4444">▮</span>/<span style="color:#3B82F6">▮</span> 거래량</span>
    </div>
    <div id="cht-wrap" style="position:relative;overflow-x:auto">
    <svg id="cht-svg" viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px;background:#0F172A;border-radius:8px;cursor:crosshair;display:block" xmlns="http://www.w3.org/2000/svg">
      ${grid}
      ${bb}
      ${bars}
      ${series}
      ${rsiPanel}
      ${macdPanel}
      ${xlabels}
      <line id="cht-cx" x1="0" x2="0" y1="${padT}" y2="${lastBottom}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4 3" opacity="0" pointer-events="none"/>
      <circle id="cht-cdot" r="4" fill="#E2E8F0" stroke="#0F172A" stroke-width="1.5" opacity="0" pointer-events="none"/>
    </svg>
    <div id="cht-tip" style="position:absolute;display:none;pointer-events:none;background:#1E293B;border:1px solid #334155;border-radius:6px;padding:8px 10px;font-size:0.75rem;line-height:1.55;box-shadow:0 4px 14px rgba(0,0,0,0.5);z-index:5;white-space:nowrap"></div>
    </div>
    ${insight}
    <div style="text-align:right;margin-top:8px">
      <button class="btn btn-sm" onclick="loadChart()">🔄 새로고침</button>
    </div>`;

  // ── 크로스헤어 + 툴팁 ──
  const svg = document.getElementById("cht-svg");
  const wrap = document.getElementById("cht-wrap");
  const cx = document.getElementById("cht-cx");
  const cdot = document.getElementById("cht-cdot");
  const tip = document.getElementById("cht-tip");

  function showAt(clientX) {
    const rect = svg.getBoundingClientRect();
    const vbX = (clientX - rect.left) / rect.width * W;
    let i = Math.round((vbX - padL) / (W - padL - padR) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const X = xs(i), Y = py(close[i]);
    cx.setAttribute("x1", X); cx.setAttribute("x2", X); cx.setAttribute("opacity", "1");
    cdot.setAttribute("cx", X); cdot.setAttribute("cy", Y); cdot.setAttribute("opacity", "1");

    const c = close[i], prev = i > 0 ? close[i - 1] : c;
    const chg = c - prev, chgp = prev ? chg / prev * 100 : 0;
    const col = chg >= 0 ? UP : DOWN;
    const ohlc = hasOHLC
      ? `<div style="color:#CBD5E1">시 ${open[i].toLocaleString()} · 고 ${high[i].toLocaleString()} · 저 ${low[i].toLocaleString()}</div>` : '';
    const rsiLine = showRSI && rsi[i] != null ? `<div style="color:#A78BFA">RSI ${rsi[i].toFixed(1)}</div>` : '';
    const macdLine = showMACD && hist[i] != null ? `<div style="color:#38BDF8">MACD Hist ${hist[i].toFixed(2)}</div>` : '';
    tip.innerHTML = `
      <div style="font-weight:700;margin-bottom:2px">${dates[i]}</div>
      <div>종가 <b>${c.toLocaleString()}원</b> <span style="color:${col}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chgp).toFixed(2)}%</span></div>
      ${ohlc}
      <div style="color:#22C55E">MA5 ${ma5[i] != null ? Math.round(ma5[i]).toLocaleString() : '-'}</div>
      <div style="color:#FBBF24">MA20 ${ma20[i] != null ? Math.round(ma20[i]).toLocaleString() : '-'}</div>
      ${rsiLine}${macdLine}
      <div style="color:#94A3B8">거래량 ${vol[i].toLocaleString()}</div>`;
    tip.style.display = "block";

    const wrapRect = wrap.getBoundingClientRect();
    let left = (clientX - wrapRect.left) + wrap.scrollLeft + 14;
    if (left > wrap.clientWidth + wrap.scrollLeft - tip.offsetWidth - 6)
      left = (clientX - wrapRect.left) + wrap.scrollLeft - tip.offsetWidth - 14;
    tip.style.left = Math.max(2, left) + "px";
    tip.style.top = "6px";
  }
  function hide() { cx.setAttribute("opacity", "0"); cdot.setAttribute("opacity", "0"); tip.style.display = "none"; }

  svg.addEventListener("mousemove", e => showAt(e.clientX));
  svg.addEventListener("mouseleave", hide);
  svg.addEventListener("touchmove", e => { if (e.touches[0]) { showAt(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  svg.addEventListener("touchend", hide);
}

async function loadLogs() {
  const el = document.getElementById("logs-content");
  el.innerHTML = '<div class="loading">실행 로그 불러오는 중...</div>';
  switchTab("logs");
  try {
    const res = await fetch("/api/logs?lines=120");
    const d = await res.json();
    renderLogs(el, d);
  } catch (e) {
    el.innerHTML = '<div class="error">로그 조회 오류: ' + e.message + '</div>';
  }
}

function renderLogs(el, d) {
  const recs = d.records || [];
  if (!recs.length) { el.innerHTML = '<div class="loading">기록된 로그가 없습니다.</div>'; return; }
  const rows = recs.map(r => `
    <div class="log-row">
      <span class="log-time">${r.time}</span>
      <span class="log-lvl log-${r.level}">${r.level}</span>
      <span class="log-name">${r.name}</span>
      <span class="log-msg">${r.msg.replace(/</g,'&lt;')}</span>
    </div>`).join('');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:0.85rem;color:#64748B">최근 실행 로그 (${recs.length}건, 최신순)</span>
      <button class="btn btn-sm" onclick="loadLogs()">🔄 새로고침</button>
    </div>
    <div class="log-box">${rows}</div>`;
}

async function loadPrediction() {
  if (!currentTicker) return;
  const el = document.getElementById("prediction-content");
  el.innerHTML = '<div class="loading">AI 예측 중... (10~30초 소요될 수 있습니다)</div>';
  switchTab("prediction");
  try {
    const res = await fetch("/api/predict/" + currentTicker);
    if (!res.ok) {
      const err = await res.json();
      el.innerHTML = '<div class="error">오류: ' + (err.detail || res.status) + '</div>';
      return;
    }
    const d = await res.json();
    renderPrediction(el, d);
  } catch (e) {
    el.innerHTML = '<div class="error">네트워크 오류: ' + e.message + '</div>';
  }
}

function renderPrediction(el, d) {
  const isUp = d.direction === "상승";
  const dirClass = isUp ? "up" : "down";
  const arrow = isUp ? "▲" : "▼";
  const prob = (d.probability * 100).toFixed(1);

  const sig = d.strong_signal || {};
  let sigBadge = '';
  if (sig.active) {
    const stale = sig.stale;
    const bg = stale ? '#3B2F14' : '#7F1D1D', bd = stale ? '#B45309' : '#EF4444';
    const tc = stale ? '#FCD34D' : '#FCA5A5', sub = stale ? '#FDE68A' : '#FECACA';
    const note = stale ? ` <b>(⚠ 수급 데이터 ${sig.days_old}일 전 기준 — 최신이 아닐 수 있음)</b>` : '';
    sigBadge = `
    <div style="background:${bg};border:1px solid ${bd};border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.2rem">⭐</span>
      <div>
        <div style="font-weight:700;color:${tc}">강한 상승 신호 — 외국인 선물 + 콜옵션 동반 순매수</div>
        <div style="font-size:0.75rem;color:${sub};margin-top:2px">데이터 기준일 <b>${sig.date}</b>${note} · 과거 이 조건일 때 다음날 상승 72%</div>
      </div>
    </div>`;
  }

  el.innerHTML = `
    ${sigBadge}
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">내일 방향</div>
        <div class="value ${dirClass}">${arrow} ${d.direction}</div>
      </div>
      <div class="stat-card">
        <div class="label">신뢰도</div>
        <div class="value">${prob}%</div>
      </div>
      <div class="stat-card">
        <div class="label">투자의견</div>
        <div class="value"><span class="opinion-badge opinion-${d.investment_opinion}">${d.investment_opinion}</span></div>
      </div>
      <div class="stat-card">
        <div class="label">현재 종가</div>
        <div class="value">${Number(d.close_price).toLocaleString()}원</div>
      </div>
      <div class="stat-card">
        <div class="label">RSI(14)</div>
        <div class="value ${d.rsi_14 > 70 ? 'up' : d.rsi_14 < 30 ? 'down' : 'neutral'}">${d.rsi_14?.toFixed(1) ?? '-'}</div>
      </div>
      <div class="stat-card">
        <div class="label">거래량 비율</div>
        <div class="value">${d.volume_ratio?.toFixed(2) ?? '-'}x</div>
      </div>
      <div class="stat-card">
        <div class="label">과거 적중률</div>
        <div class="value" id="stat-acc"><span style="font-size:0.9rem;color:#64748B">…</span></div>
      </div>
    </div>

    ${renderPriceRange(d)}
    ${renderSentiment(d)}

    <div style="margin-bottom:8px;font-size:0.85rem;color:#64748B">애널리스트 코멘트</div>
    <div class="comment-box">${d.analyst_comment || '코멘트 없음'}</div>
    <div style="font-size:0.75rem;color:#475569">생성: ${d.generated_at?.replace('T', ' ').slice(0,19) ?? ''}</div>
  `;

  loadAccuracyBadge(d.ticker_code);   // 백테스트 적중률을 비동기로 채움
}

async function loadAccuracyBadge(ticker) {
  const elA = document.getElementById("stat-acc");
  if (!elA) return;
  try {
    const res = await fetch("/api/history/" + ticker);
    if (!res.ok) { elA.innerHTML = '<span style="font-size:0.9rem;color:#64748B">-</span>'; return; }
    const h = await res.json();
    const pct = (h.accuracy * 100).toFixed(1);
    const col = h.accuracy >= 0.55 ? '#22C55E' : h.accuracy >= 0.5 ? '#FBBF24' : '#F87171';
    elA.innerHTML = `<span style="color:${col}">${pct}%</span> <span style="font-size:0.7rem;color:#64748B">(${h.total}일)</span>`;
  } catch {
    elA.innerHTML = '<span style="font-size:0.9rem;color:#64748B">-</span>';
  }
}

function renderPriceRange(d) {
  const bull = d.bull || {};
  const bear = d.bear || {};
  if (!bull.low && !bear.low) return '';
  return `
    <div style="margin-bottom:8px;font-size:0.85rem;color:#64748B">가격대 예측 (다음 거래일)</div>
    <div class="price-range" style="margin-bottom:16px">
      <div class="range-card bull">
        <h4>▲ 상승 시나리오</h4>
        <div class="range-val up">${Number(bull.low).toLocaleString()} ~ ${Number(bull.high).toLocaleString()}원</div>
        <div style="font-size:0.75rem;color:#64748B;margin-top:6px">
          저항1: ${Number(bull.resistance1||0).toLocaleString()} / 저항2: ${Number(bull.resistance2||0).toLocaleString()}
        </div>
      </div>
      <div class="range-card bear">
        <h4>▼ 하락 시나리오</h4>
        <div class="range-val down">${Number(bear.low).toLocaleString()} ~ ${Number(bear.high).toLocaleString()}원</div>
        <div style="font-size:0.75rem;color:#64748B;margin-top:6px">
          지지1: ${Number(bear.support1||0).toLocaleString()} / 지지2: ${Number(bear.support2||0).toLocaleString()}
        </div>
      </div>
    </div>`;
}

function renderSentiment(d) {
  const pos = d.sentiment?.positive ?? 0;
  const neu = d.sentiment?.neutral ?? 0;
  const neg = d.sentiment?.negative ?? 0;
  const total = pos + neu + neg || 1;
  const score = d.sentiment_score ?? 0;
  const label = score > 0.1 ? '긍정' : score < -0.1 ? '부정' : '중립';
  return `
    <div style="margin-bottom:8px;font-size:0.85rem;color:#64748B">뉴스 감성 분석</div>
    <div class="news-sent" style="margin-bottom:8px">
      <span style="font-size:0.8rem;color:#94A3B8">${score.toFixed(2)} (${label})</span>
      <div class="sent-bar">
        <div class="sent-pos" style="width:${pos/total*100}%"></div>
        <div class="sent-neu" style="width:${neu/total*100}%"></div>
        <div class="sent-neg" style="width:${neg/total*100}%"></div>
      </div>
      <span style="font-size:0.75rem;color:#64748B">긍${pos} 중${neu} 부${neg}</span>
    </div>
    <div style="font-size:0.82rem;color:#94A3B8;margin-bottom:12px">${d.sentiment_summary || ''}</div>
    ${(d.headlines && d.headlines.length > 0) ? `
    <div style="margin-bottom:6px;font-size:0.8rem;color:#64748B">주요 뉴스 헤드라인 (${d.headlines.length}건)</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${d.headlines.map((h, i) => {
        const title = (typeof h === 'object' && h !== null) ? h.title : h;
        const url = (typeof h === 'object' && h !== null) ? h.url : '';
        const inner = `${i+1}. ${title}`;
        return url
          ? `<a href="${url}" target="_blank" rel="noopener noreferrer" style="font-size:0.78rem;color:#CBD5E1;padding:5px 8px;background:#1E293B;border-radius:4px;border-left:2px solid #3B82F6;text-decoration:none;display:block;transition:background 0.15s" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='#1E293B'">${inner} <span style="color:#64748B;font-size:0.7rem">↗</span></a>`
          : `<div style="font-size:0.78rem;color:#CBD5E1;padding:5px 8px;background:#1E293B;border-radius:4px;border-left:2px solid #3B82F6">${inner}</div>`;
      }).join('')}
    </div>` : ''}`;
}

async function loadHistory() {
  if (!currentTicker) return;
  const el = document.getElementById("history-content");
  el.innerHTML = '<div class="loading">백테스트 데이터 로딩 중...</div>';
  switchTab("history");
  try {
    const res = await fetch("/api/history/" + currentTicker);
    if (!res.ok) {
      const err = await res.json();
      el.innerHTML = '<div class="error">오류: ' + (err.detail || res.status) + '</div>';
      return;
    }
    const d = await res.json();
    renderHistory(el, d);
  } catch (e) {
    el.innerHTML = '<div class="error">네트워크 오류: ' + e.message + '</div>';
  }
}

function renderHistory(el, d) {
  const pct = (d.accuracy * 100).toFixed(1);
  const rows = (d.records || []).slice().reverse().map(r => {
    let arrow = '';
    const amt = (typeof r.chg_amt === 'number') ? Math.abs(r.chg_amt).toLocaleString() : '';
    if (typeof r.chg_pct === 'number' && r.chg_pct > 0)
      arrow = ` <span class="up">▲${r.chg_pct.toFixed(2)}% (+${amt}원)</span>`;
    else if (typeof r.chg_pct === 'number' && r.chg_pct < 0)
      arrow = ` <span class="down">▼${Math.abs(r.chg_pct).toFixed(2)}% (-${amt}원)</span>`;
    const closeTxt = (r.close != null)
      ? Number(r.close).toLocaleString() + '원' + arrow
        + (r.pending ? ' <span style="color:#FBBF24;font-size:0.7rem">(현재가)</span>' : '')
      : '-';
    const actualCell = r.pending
      ? '<span class="neutral">예측 대기</span>'
      : `<span class="${r.actual === '상승' ? 'up' : 'down'}">${r.actual}</span>`;
    const correctCell = r.pending
      ? '<span class="neutral">—</span>'
      : `<span class="${r.correct ? 'correct' : 'wrong'}">${r.correct ? '✓' : '✗'}</span>`;
    const rowBg = r.pending ? 'background:#0B2A4A' : (r.signal ? 'background:#7F1D1D33' : '');
    return `
    <tr style="${rowBg}">
      <td>${r.date}${r.pending ? ' <span style="color:#FBBF24;font-size:0.7rem">오늘</span>' : ''}</td>
      <td class="${r.predicted === '상승' ? 'up' : 'down'}">${r.predicted}</td>
      <td>${actualCell}</td>
      <td>${closeTxt}</td>
      <td style="text-align:center">${correctCell}</td>
      <td>${(r.prob * 100).toFixed(1)}%</td>
      <td style="text-align:center">${r.signal ? '<span title="외국인 선물+콜옵션 동반 순매수">⭐</span>' : ''}</td>
    </tr>`;
  }).join('');
  const sigCount = (d.records || []).filter(r => r.signal).length;

  el.innerHTML = `
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="label">테스트 샘플</div><div class="value">${d.total}일</div></div>
      <div class="stat-card"><div class="label">정답</div><div class="value correct">${d.correct}일</div></div>
      <div class="stat-card"><div class="label">정확도</div><div class="value">${pct}%</div></div>
      <div class="stat-card"><div class="label">⭐ 신호일</div><div class="value">${sigCount}일</div></div>
    </div>
    <div style="font-size:0.78rem;color:#94A3B8;margin-bottom:10px">⭐ = 외국인 선물 + 콜옵션 동반 순매수일 (과거 이 조건 다음날 상승 72%)</div>
    <div style="overflow-x:auto">
      <table class="history-table">
        <thead><tr><th>날짜</th><th>예측</th><th>실제</th><th>종가</th><th>정오</th><th>신뢰도</th><th>신호</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function downloadReport() {
  if (!currentTicker) return;
  const url = "/api/report/" + currentTicker + "?generate=true";
  const a = document.createElement("a");
  a.href = url;
  a.download = currentTicker + "_report.pdf";
  a.click();
}
