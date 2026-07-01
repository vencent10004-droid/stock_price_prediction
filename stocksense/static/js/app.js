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

async function loadChart() {
  if (!currentTicker) return;
  const el = document.getElementById("chart-content");
  el.innerHTML = '<div class="loading">주가 차트 로딩 중...</div>';
  switchTab("chart");
  try {
    const res = await fetch("/api/chart/" + currentTicker);
    if (!res.ok) {
      const err = await res.json();
      el.innerHTML = '<div class="error">오류: ' + (err.detail || res.status) + '</div>';
      return;
    }
    const d = await res.json();
    renderChart(el, d);
  } catch (e) {
    el.innerHTML = '<div class="error">네트워크 오류: ' + e.message + '</div>';
  }
}

function renderChart(el, d) {
  const close = d.close || [], dates = d.dates || [], ma5 = d.ma5 || [], ma20 = d.ma20 || [], vol = d.volume || [];
  const n = close.length;
  if (!n) { el.innerHTML = '<div class="loading">차트 데이터가 없습니다.</div>'; return; }

  const W = 760, H = 380, padL = 6, padR = 66, padT = 14, priceH = 250, volTop = 292, volH = 66;
  const xs = i => padL + (W - padL - padR) * (n === 1 ? 0 : i / (n - 1));

  const priceVals = [...close, ...ma5.filter(v => v != null), ...ma20.filter(v => v != null)];
  let lo = Math.min(...priceVals), hi = Math.max(...priceVals);
  const gap = (hi - lo) * 0.08 || 1; lo -= gap; hi += gap;
  const py = v => padT + priceH * (1 - (v - lo) / (hi - lo));

  const poly = arr => arr.map((v, i) => v == null ? null : `${xs(i).toFixed(1)},${py(v).toFixed(1)}`)
                        .filter(Boolean).join(' ');

  // 가격 가로 그리드 + 라벨(우측)
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const val = lo + (hi - lo) * k / 4;
    const yy = py(val);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#1E293B"/>`;
    grid += `<text x="${W - padR + 6}" y="${(yy + 3).toFixed(1)}" fill="#64748B" font-size="10">${Math.round(val).toLocaleString()}</text>`;
  }

  // 거래량 막대 (상승일 빨강 / 하락일 파랑)
  const vmax = Math.max(...vol, 1);
  const bw = Math.max(1, (W - padL - padR) / n * 0.6);
  let bars = '';
  for (let i = 0; i < n; i++) {
    const h = volH * (vol[i] / vmax);
    const up = i === 0 ? true : close[i] >= close[i - 1];
    bars += `<rect x="${(xs(i) - bw / 2).toFixed(1)}" y="${(volTop + volH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up ? '#EF4444' : '#3B82F6'}" opacity="0.55"/>`;
  }

  const last = close[n - 1], first = close[0];
  const chgPct = ((last - first) / first * 100);
  const lastColor = last >= first ? '#EF4444' : '#3B82F6';
  const lx = xs(n - 1), ly = py(last);

  const midIdx = Math.floor((n - 1) / 2);
  const xlabels = [0, midIdx, n - 1].map(i =>
    `<text x="${xs(i).toFixed(1)}" y="${H - 4}" fill="#64748B" font-size="10" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${dates[i].slice(2)}</text>`).join('');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
      <div style="font-size:0.95rem;font-weight:700">${d.ticker_name} 최근 ${n}거래일</div>
      <div style="font-size:0.85rem">
        <span style="color:#94A3B8">현재가</span>
        <b>${last.toLocaleString()}원</b>
        <span style="color:${lastColor};margin-left:6px">${chgPct >= 0 ? '▲' : '▼'}${Math.abs(chgPct).toFixed(2)}% (기간)</span>
      </div>
    </div>
    <div style="display:flex;gap:14px;font-size:0.75rem;color:#94A3B8;margin-bottom:6px">
      <span><span style="color:#E2E8F0">━</span> 종가</span>
      <span><span style="color:#22C55E">━</span> MA5</span>
      <span><span style="color:#FBBF24">━</span> MA20</span>
      <span style="margin-left:auto"><span style="color:#EF4444">▮</span>/<span style="color:#3B82F6">▮</span> 거래량(상승/하락)</span>
    </div>
    <div style="overflow-x:auto">
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px;background:#0F172A;border-radius:8px" xmlns="http://www.w3.org/2000/svg">
      ${grid}
      ${bars}
      <polyline points="${poly(ma20)}" fill="none" stroke="#FBBF24" stroke-width="1.3" opacity="0.9"/>
      <polyline points="${poly(ma5)}" fill="none" stroke="#22C55E" stroke-width="1.3" opacity="0.9"/>
      <polyline points="${poly(close)}" fill="none" stroke="#E2E8F0" stroke-width="1.8"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="${lastColor}"/>
      <text x="${(lx - 6).toFixed(1)}" y="${(ly - 8).toFixed(1)}" fill="${lastColor}" font-size="11" font-weight="700" text-anchor="end">${last.toLocaleString()}</text>
      ${xlabels}
    </svg>
    </div>
    <div style="text-align:right;margin-top:8px">
      <button class="btn btn-sm" onclick="loadChart()">🔄 새로고침</button>
    </div>`;
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
  const sigBadge = sig.active ? `
    <div style="background:#7F1D1D;border:1px solid #EF4444;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.2rem">⭐</span>
      <div>
        <div style="font-weight:700;color:#FCA5A5">강한 상승 신호 — 외국인 선물 + 콜옵션 동반 순매수</div>
        <div style="font-size:0.75rem;color:#FECACA;margin-top:2px">최근(${sig.date}) 외국인이 선물·콜옵션을 함께 순매수 → 과거 이 조건일 때 다음날 상승 72%</div>
      </div>
    </div>` : '';

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
    </div>

    ${renderPriceRange(d)}
    ${renderSentiment(d)}

    <div style="margin-bottom:8px;font-size:0.85rem;color:#64748B">애널리스트 코멘트</div>
    <div class="comment-box">${d.analyst_comment || '코멘트 없음'}</div>
    <div style="font-size:0.75rem;color:#475569">생성: ${d.generated_at?.replace('T', ' ').slice(0,19) ?? ''}</div>
  `;
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
