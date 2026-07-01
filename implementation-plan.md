# Implementation Plan
# StockSense — 단계별 구현 계획

**작성일:** 2026-06-26 / **최종 업데이트:** 2026-06-29

> ⚠️ **구현 변경사항 (계획 → 실제):** 본 계획서는 초기 설계 문서이며, 실제 구현은 아래와 같이
> 변경되었다. 코드 스니펫 일부는 설계 당시의 의사코드이므로 실제 동작과 다를 수 있다.
> - 주가 데이터: `yfinance` → **FinanceDataReader** (`fdr.DataReader("005930", ...)`)
> - 뉴스 수집: BeautifulSoup HTML 크롤링 → **네이버 모바일 뉴스 API**(제목+원문 링크, 회사 관련성 정렬)
> - 감성 분석/코멘트: **Claude(Anthropic)** (`claude-opus-4-8`, 공식 anthropic SDK)
> - 발송: 텔레그램 → **이메일**(HTML 본문 + PDF 첨부)
> - 종목: 6개 → **시가총액 상위 10개**, 일별 실행 16:00 → **16:30**

---

## 개발 원칙
1. **Phase별 독립 실행** — 각 Phase 완료 후 실제로 돌아가는지 확인
2. **CLI 먼저, UI 나중** — 예측 로직 완성 후 웹/이메일 연결
3. **종목 1개(삼성전자)로 먼저** — 완성 후 다종목으로 확장

---

## Phase 0: 환경 세팅 (1일)

### 할 일
- [x] 프로젝트 폴더 구조 생성
- [x] 가상환경 생성 + 패키지 설치
- [x] `.env`, `config/config.yaml` 작성
- [x] Claude(Anthropic) API 키 연결 테스트
- [x] 이메일(Gmail 앱 비밀번호) 설정 확인

### 설치 패키지
```bash
pip install finance-datareader pykrx pandas scikit-learn xgboost joblib
pip install python-dotenv requests setuptools
pip install fastapi uvicorn apscheduler jinja2
pip install reportlab matplotlib pyyaml
# 감성 분석: Claude(Anthropic) 공식 anthropic SDK로 호출
# 이메일 전송: smtplib + email 은 Python 표준 라이브러리 (별도 설치 불필요)
```

### 검증
```bash
python -c "import FinanceDataReader as fdr; print(fdr.DataReader('005930').tail(2))"
# → 삼성전자 최근 데이터 출력 확인
```

---

## Phase 1: 데이터 수집 파이프라인 (2일)

### 1-A. OHLCV + 시장 데이터 (`services/data_collector.py`)
- [ ] 삼성전자 3년치 OHLCV 수집
- [ ] KOSPI, 나스닥, 환율 병합
- [ ] `data/raw/005930_raw.csv` 저장

### 1-B. 외국인/기관 데이터 (`services/krx_collector.py`)
```python
from pykrx import stock

def collect_investor_data(ticker: str, period_days: int = 90) -> pd.DataFrame:
    today = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=period_days)).strftime("%Y%m%d")
    df = stock.get_market_net_purchases_of_equities(start, today, ticker)
    return df
```
- [ ] 외국인·기관 순매수 수집 및 병합
- [ ] 연속 순매수 일수 계산

### 1-C. 뉴스 크롤링 (`services/news_crawler.py`)
```python
def crawl_naver_news(ticker_code: str, max_count: int = 15) -> list[str]:
    url = f"https://finance.naver.com/item/news_news.naver?code={ticker_code}&page=1"
    headers = {"User-Agent": "Mozilla/5.0"}
    resp = requests.get(url, headers=headers)
    soup = BeautifulSoup(resp.text, "html.parser")
    headlines = [a.get_text(strip=True) for a in soup.select(".title a")]
    return headlines[:max_count]
```
- [ ] 헤드라인 수집 + 날짜 필터링 (오늘 뉴스만)

### 검증
```bash
python -c "
from services.data_collector import DataCollector
from services.krx_collector import KRXCollector
from services.news_crawler import NewsCrawler

df = DataCollector().collect_all('005930.KS', period='3y')
print('OHLCV:', df.shape)

inv = KRXCollector().collect_investor_data('005930', 30)
print('투자자:', inv.tail(3))

news = NewsCrawler().crawl_naver_news('005930')
print('뉴스:', news[:3])
"
```

---

## Phase 2: 피처 엔지니어링 (2일)

### 2-A. 기술적 지표 계산 (`services/feature_engine.py`)
- [ ] RSI, MACD, 볼린저밴드, ATR 계산 (`ta` 라이브러리)
- [ ] 이동평균, 캔들 패턴, 거래량 피처
- [ ] 외국인/기관 파생 피처 (연속일수, 스마트머니 신호)
- [ ] 레이블 생성 (`label_direction`)

### 2-B. 뉴스 감성 분석 (`services/sentiment_analyzer.py`)
```python
import anthropic
CLAUDE_MODEL = "claude-opus-4-8"

def analyze_sentiment(ticker_name: str, headlines: list[dict]) -> dict:
    titles = [h["title"] for h in headlines]
    prompt = f"""
{ticker_name} 주가 관련 뉴스 헤드라인을 분석하세요.
각 뉴스가 주가에 미치는 영향을 긍정(1)/중립(0)/부정(-1)으로 분류하고
JSON으로 반환: {{"overall_score": 0.42, "items": [...], "summary": "..."}}

헤드라인:
{chr(10).join(f"- {t}" for t in titles)}
"""
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용 (SDK 자동 재시도)
    resp = client.messages.create(model=CLAUDE_MODEL, max_tokens=1024,
                                  messages=[{"role": "user", "content": prompt}])
    text = "".join(b.text for b in resp.content if b.type == "text")
    return json.loads(text)
```
- [ ] 감성 점수 → 피처 컬럼 추가

### 검증
```bash
python -c "
from services.feature_engine import FeatureEngine
df = FeatureEngine().calculate_all_features('005930')
print(df.columns.tolist())  # 44개 피처 확인
print(df[['rsi_14','macd_hist','news_sentiment_score','foreign_net_buy']].tail(3))
"
```

---

## Phase 3: 예측 모델 학습 (2일)

### 3-A. 방향 예측 모델 (`services/model_trainer.py`)
```python
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier

# 앙상블: RF + XGB
rf  = RandomForestClassifier(n_estimators=200, max_depth=10, random_state=42)
xgb = XGBClassifier(n_estimators=200, max_depth=6, learning_rate=0.05)

# 시계열 분리
train_X, test_X = X[:split], X[split:]
rf.fit(train_X, train_y)
xgb.fit(train_X, train_y)

# 앙상블 확률 평균
prob = (rf.predict_proba(test_X)[:,1] + xgb.predict_proba(test_X)[:,1]) / 2
pred = (prob >= 0.5).astype(int)
```
- [ ] 학습 + 백테스트 + 피처 중요도 출력
- [ ] `models/005930/` 에 모델 저장

### 3-B. 가격대 추정 (`services/price_range_estimator.py`)
```python
def estimate_price_range(today_close, atr, bb_upper, bb_lower, pivot):
    bull = {
        "low":  round(today_close + atr * 0.3, 0),
        "high": round(min(today_close + atr * 1.2, bb_upper), 0),
    }
    bear = {
        "low":  round(max(today_close - atr * 1.2, bb_lower), 0),
        "high": round(today_close - atr * 0.3, 0),
    }
    return bull, bear
```
- [ ] 피봇 포인트 지지/저항선 계산

### 검증
```bash
python train.py --ticker 005930
# → 백테스트 정확도 55%+ 확인
```

---

## Phase 4: 리포트 생성 (3일)

### 4-A. AI 코멘트 생성
```python
def generate_analyst_comment(prediction_data: dict, ticker_name: str) -> str:
    prompt = f"""
당신은 증권사 주식 애널리스트입니다.
아래 데이터를 바탕으로 {ticker_name}에 대한 내일 주가 전망 코멘트를
전문 애널리스트 보고서 스타일로 3~4 문단 작성해 주세요.

데이터: {json.dumps(prediction_data, ensure_ascii=False)}

작성 지침:
- 전문적이고 객관적인 어조 사용
- 데이터 수치를 구체적으로 인용
- 상승 요인과 하락 리스크 모두 언급
- 마지막에 투자 의견 한 줄 요약
"""
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용
    resp = client.messages.create(model=CLAUDE_MODEL, max_tokens=1024,
                                  messages=[{"role": "user", "content": prompt}])
    # 호출 실패 시 규칙 기반 코멘트로 대체
    return "".join(b.text for b in resp.content if b.type == "text")
```

### 4-B. 주가 차트 이미지 생성 (`matplotlib`)
- [ ] 최근 60일 종가 + MA5 + MA20 라인 차트
- [ ] 거래량 막대 차트 (하단)
- [ ] PNG로 저장 후 PDF에 삽입

### 4-C. PDF 리포트 조합 (`reportlab`)
- [ ] 섹션별 레이아웃 구성 (report-design.md 기준)
- [ ] 차트 이미지 삽입
- [ ] `reports/{날짜}/{티커}_report.pdf` 저장

### 검증
```bash
python -c "
from services.report_generator import ReportGenerator
ReportGenerator().generate('005930')
# → reports/2026-06-26/005930_report.pdf 생성 확인
"
```

---

## Phase 5: 이메일 전송 (1일)

### `services/email_sender.py`
```python
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

def send_daily_report(predictions: list[dict], pdf_paths: list[str]):
    """전체 종목 요약 + PDF 첨부 이메일 발송"""
    sender   = os.getenv("EMAIL_SENDER")
    password = os.getenv("EMAIL_PASSWORD")
    recipients = os.getenv("EMAIL_RECIPIENTS", "").split(",")
    predict_date = predictions[0]["predict_date"]

    # 이메일 구성
    msg = MIMEMultipart("mixed")
    msg["From"]    = sender
    msg["To"]      = ", ".join(recipients)
    msg["Subject"] = f"[StockSense] {predict_date} 일일 주가 브리프"

    # HTML 본문 (종목별 요약 카드)
    html_body = build_html_body(predictions)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    # PDF 파일 첨부
    for ticker_data, pdf_path in zip(predictions, pdf_paths):
        with open(pdf_path, "rb") as f:
            part = MIMEApplication(f.read(), Name=os.path.basename(pdf_path))
            part["Content-Disposition"] = f'attachment; filename="{os.path.basename(pdf_path)}"'
            msg.attach(part)

    # Gmail SMTP 전송
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(sender, password)
        server.sendmail(sender, recipients, msg.as_string())
    print(f"✅ 이메일 전송 완료 → {recipients}")


def build_html_body(predictions: list[dict]) -> str:
    """종목별 요약 카드 HTML 생성"""
    rows = ""
    for p in predictions:
        color  = "#27ae60" if p["direction"] == "상승" else "#e74c3c"
        emoji  = "📈" if p["direction"] == "상승" else "📉"
        rows += f"""
        <tr>
          <td style="padding:12px;border-bottom:1px solid #eee">
            <strong>{p['name']} ({p['ticker']})</strong>
          </td>
          <td style="color:{color};font-weight:bold">{emoji} {p['direction']}</td>
          <td>{p['probability']:.1%}</td>
          <td>{p['investment_opinion']}</td>
          <td>{p['today_close']:,}원</td>
          <td style="font-size:12px">
            상승: {p['price_range']['bull']['low']:,}~{p['price_range']['bull']['high']:,}원<br>
            하락: {p['price_range']['bear']['low']:,}~{p['price_range']['bear']['high']:,}원
          </td>
        </tr>"""

    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:800px;margin:auto">
      <h2 style="color:#1a3a6b">StockSense AI Research — 일일 주가 브리프</h2>
      <p style="color:#666">{predictions[0]['predict_date']} 예측 결과</p>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#2c5f9e;color:#fff">
            <th style="padding:10px">종목</th>
            <th>예측</th>
            <th>신뢰도</th>
            <th>투자의견</th>
            <th>오늘 종가</th>
            <th>가격대 시나리오</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="font-size:12px;color:#999;margin-top:24px">
        ⚠️ 본 내용은 AI 알고리즘 기반 참고 자료입니다. 투자 손실 책임은 본인에게 있습니다.<br>
        📎 종목별 상세 PDF 리포트가 첨부되어 있습니다.
      </p>
    </body></html>
    """
```
- [ ] Gmail 앱 비밀번호 발급 (Google 계정 → 보안 → 앱 비밀번호)
- [ ] `.env` 에 `EMAIL_SENDER`, `EMAIL_PASSWORD`, `EMAIL_RECIPIENTS` 설정
- [ ] 이메일 전송 테스트 (종목 1개, PDF 1개)
- [ ] 전체 종목 전송 + 실패 시 재시도 로직 (2회)

---

## Phase 6: 스케줄러 + 자동 재학습 (2일)

### `scheduler/jobs.py`
```python
async def run_daily_pipeline():
    tickers = load_config()["tickers"]
    for ticker_config in tickers:
        ticker = ticker_config["code"]
        try:
            # 전체 파이프라인 실행
            data = await collect_all_data(ticker)
            prediction = await predict(ticker, data)
            pdf_path = await generate_report(ticker, prediction)
            send_report(pdf_path, name, prediction, sentiment)  # 이메일 발송
            log_prediction(ticker, prediction)
        except Exception as e:
            logger.error(f"{ticker} 파이프라인 오류: {e}")

async def run_weekly_retrain():
    for ticker in get_all_tickers():
        result = retrain_model(ticker)
        if result["new_accuracy"] < result["old_accuracy"] - 0.03:
            send_accuracy_alert_email(ticker, result)  # 이메일로 경고 발송
```
- [ ] APScheduler 등록 및 테스트
- [ ] 에러 발생 시 로그 기록

---

## Phase 7: 웹 대시보드 (2일)

- [ ] `GET /` — 종목 선택 + 예측 결과 카드
- [ ] `GET /api/predict/{ticker}` — JSON 예측 결과
- [ ] `GET /api/report/{ticker}` — PDF 다운로드
- [ ] Chart.js로 주가 차트 + 예측 히스토리 시각화
- [ ] 종목 추가/제거 UI

---

## Phase 8: 다종목 확장 & 마무리 (1일)

- [x] `config.yaml`에 종목 추가 후 전체 파이프라인 테스트
- [x] 시가총액 상위 10개 종목 실행 성능 확인
- [x] 에러 핸들링 전체 점검
- [x] `README.md` 사용 방법 작성

---

## 전체 일정 요약

| Phase | 내용 | 예상 기간 |
|-------|------|---------|
| 0 | 환경 세팅 | 1일 |
| 1 | 데이터 수집 (OHLCV + 외국인 + 뉴스) | 2일 |
| 2 | 피처 엔지니어링 + 감성 분석 | 2일 |
| 3 | 예측 모델 학습 + 가격대 추정 | 2일 |
| 4 | 애널리스트 리포트 생성 | 3일 |
| 5 | 이메일 전송 | 1일 |
| 6 | 스케줄러 + 자동 재학습 | 2일 |
| 7 | 웹 대시보드 | 2일 |
| 8 | 다종목 확장 + 마무리 | 1일 |
| **합계** | | **약 16일** |

---

## 첫 번째로 만들 파일 순서

```
1. config/config.yaml            ← 종목 + 스케줄 설정
2. services/data_collector.py    ← FinanceDataReader OHLCV 수집
3. services/krx_collector.py     ← 외국인/기관 수집
4. services/news_crawler.py      ← 네이버 모바일 뉴스 API (제목+링크)
5. services/sentiment_analyzer.py ← Claude 감성 분석 + 코멘트
6. services/feature_engine.py    ← 피처 계산
7. services/model_trainer.py     ← RF + XGB 학습
8. train.py                      ← 학습 실행 스크립트
9. services/price_range_estimator.py ← 가격대 추정
10. services/report_generator.py  ← PDF 리포트
11. services/email_sender.py      ← 이메일 HTML 본문 + PDF 첨부 발송
12. scheduler/jobs.py             ← 자동화 스케줄러
13. main.py + dashboard.html      ← 웹 대시보드
```
