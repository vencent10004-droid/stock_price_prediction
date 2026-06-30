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
    const names = ["prediction", "history", "logs"];
    t.classList.toggle("active", names[i] === name);
  });
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
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
      <span style="font-size:0.85rem;color:var(--text-secondary)">최근 실행 로그 (${recs.length}건, 최신순)</span>
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
    <div style="background:#FCE9E4;border:1px solid #F2935C;border-radius:var(--radius-card);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.3rem">⭐</span>
      <div>
        <div style="font-weight:700;color:#C76A2E">강한 상승 신호 — 외국인 선물 + 콜옵션 동반 순매수</div>
        <div style="font-size:0.76rem;color:#A8632F;margin-top:2px">최근(${sig.date}) 외국인이 선물·콜옵션을 함께 순매수 → 과거 이 조건일 때 다음날 상승 72%</div>
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

    <div style="margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">애널리스트 코멘트</div>
    <div class="comment-box">${d.analyst_comment || '코멘트 없음'}</div>
    <div style="font-size:0.75rem;color:var(--text-tertiary)">생성: ${d.generated_at?.replace('T', ' ').slice(0,19) ?? ''}</div>
  `;
}

function renderPriceRange(d) {
  const bull = d.bull || {};
  const bear = d.bear || {};
  if (!bull.low && !bear.low) return '';
  return `
    <div style="margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">가격대 예측 (다음 거래일)</div>
    <div class="price-range" style="margin-bottom:16px">
      <div class="range-card bull">
        <h4>▲ 상승 시나리오</h4>
        <div class="range-val up">${Number(bull.low).toLocaleString()} ~ ${Number(bull.high).toLocaleString()}원</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px">
          저항1: ${Number(bull.resistance1||0).toLocaleString()} / 저항2: ${Number(bull.resistance2||0).toLocaleString()}
        </div>
      </div>
      <div class="range-card bear">
        <h4>▼ 하락 시나리오</h4>
        <div class="range-val down">${Number(bear.low).toLocaleString()} ~ ${Number(bear.high).toLocaleString()}원</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px">
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
    <div style="margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">뉴스 감성 분석</div>
    <div class="news-sent" style="margin-bottom:8px">
      <span style="font-size:0.8rem;color:var(--text-secondary)">${score.toFixed(2)} (${label})</span>
      <div class="sent-bar">
        <div class="sent-pos" style="width:${pos/total*100}%"></div>
        <div class="sent-neu" style="width:${neu/total*100}%"></div>
        <div class="sent-neg" style="width:${neg/total*100}%"></div>
      </div>
      <span style="font-size:0.75rem;color:var(--text-secondary)">긍${pos} 중${neu} 부${neg}</span>
    </div>
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px">${d.sentiment_summary || ''}</div>
    ${(d.headlines && d.headlines.length > 0) ? `
    <div style="margin-bottom:6px;font-size:0.8rem;color:var(--text-secondary)">주요 뉴스 헤드라인 (${d.headlines.length}건)</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${d.headlines.map((h, i) => {
        const title = (typeof h === 'object' && h !== null) ? h.title : h;
        const url = (typeof h === 'object' && h !== null) ? h.url : '';
        const inner = `${i+1}. ${title}`;
        return url
          ? `<a href="${url}" target="_blank" rel="noopener noreferrer" style="font-size:0.8rem;color:var(--text-primary);padding:7px 10px;background:var(--surface-muted);border-radius:var(--radius-sm);border-left:3px solid var(--primary);text-decoration:none;display:block;transition:background 0.15s" onmouseover="this.style.background='var(--primary-soft)'" onmouseout="this.style.background='var(--surface-muted)'">${inner} <span style="color:var(--text-tertiary);font-size:0.72rem">↗</span></a>`
          : `<div style="font-size:0.8rem;color:var(--text-primary);padding:7px 10px;background:var(--surface-muted);border-radius:var(--radius-sm);border-left:3px solid var(--primary)">${inner}</div>`;
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
  const rows = (d.records || []).slice().reverse().map(r => `
    <tr style="${r.signal ? 'background:#FCEEE3' : ''}">
      <td>${r.date}</td>
      <td class="${r.predicted === '상승' ? 'up' : 'down'}">${r.predicted}</td>
      <td class="${r.actual === '상승' ? 'up' : 'down'}">${r.actual}</td>
      <td class="${r.correct ? 'correct' : 'wrong'}">${r.correct ? '✓' : '✗'}</td>
      <td>${(r.prob * 100).toFixed(1)}%</td>
      <td style="text-align:center">${r.signal ? '<span title="외국인 선물+콜옵션 동반 순매수">⭐</span>' : ''}</td>
    </tr>`).join('');
  const sigCount = (d.records || []).filter(r => r.signal).length;

  el.innerHTML = `
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card"><div class="label">테스트 샘플</div><div class="value">${d.total}일</div></div>
      <div class="stat-card"><div class="label">정답</div><div class="value correct">${d.correct}일</div></div>
      <div class="stat-card"><div class="label">정확도</div><div class="value">${pct}%</div></div>
      <div class="stat-card"><div class="label">⭐ 신호일</div><div class="value">${sigCount}일</div></div>
    </div>
    <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:10px">⭐ = 외국인 선물 + 콜옵션 동반 순매수일 (과거 이 조건 다음날 상승 72%)</div>
    <div style="overflow-x:auto">
      <table class="history-table">
        <thead><tr><th>날짜</th><th>예측</th><th>실제</th><th>정오</th><th>신뢰도</th><th>신호</th></tr></thead>
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
