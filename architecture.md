# Architecture Document
# StockSense — 시스템 아키텍처

**작성일:** 2026-06-26

---

## 1. 전체 시스템 구조

```
┌──────────────────────────────────────────────────────────────────┐
│                       스케줄러 (APScheduler)                       │
│   매일 16:30 → 데이터수집+예측+리포트    매주 일요일 02:00 → 재학습   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│                      데이터 수집 레이어                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │FinanceData- │  │pykrx         │  │네이버 모바일 뉴스 API      │ │
│  │Reader       │  │외국인/기관    │  │종목 뉴스 헤드라인+링크 수집 │ │
│  │OHLCV/지수/환율│  │순매수 수집    │  │(회사 관련성 정렬)         │ │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬──────────────┘ │
└─────────┼────────────────┼──────────────────────┼────────────────┘
          │                │                      │
┌─────────▼────────────────▼──────────────────────▼────────────────┐
│                     피처 엔지니어링 레이어                          │
│  ┌──────────────────┐          ┌──────────────────────────────┐  │
│  │FeatureEngine     │          │SentimentAnalyzer             │  │
│  │RSI/MACD/볼린저   │          │Gemini API로 뉴스 감성 분석    │  │
│  │이동평균/ATR 계산  │          │감성 점수 → 피처로 변환        │  │
│  └────────┬─────────┘          └─────────────┬────────────────┘  │
└───────────┼───────────────────────────────────┼───────────────────┘
            │                                   │
┌───────────▼───────────────────────────────────▼───────────────────┐
│                        AI 예측 레이어                               │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  DirectionPredictor (방향 예측)                               │  │
│  │  RandomForest + XGBoost 앙상블 → 상승/하락 + 확률            │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │  PriceRangeEstimator (가격대 예측)                            │  │
│  │  ATR + 볼린저밴드 + 피봇포인트 → 상승/하락 시나리오 가격대    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬───────────────────────────────┘
                                    │
┌───────────────────────────────────▼───────────────────────────────┐
│                      리포트 생성 레이어                              │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  ReportGenerator                                           │   │
│  │  ① Gemini AI → 종합 코멘트 문장 생성                        │   │
│  │  ② matplotlib → 주가 차트 PNG 생성                          │   │
│  │  ③ reportlab → PDF 애널리스트 리포트 조합                    │   │
│  └───────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────┼───────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐   ┌───────────────────────┐  ┌───────────────────┐
│  이메일 발송  │   │   FastAPI 웹서버       │  │   로컬 파일 저장   │
│  HTML 본문 +  │   │   대시보드/API        │  │   reports/{날짜}/  │
│  PDF 첨부     │   │   http://localhost:8000│  │   {티커}.pdf      │
└───────────────┘   └───────────────────────┘  └───────────────────┘
```

---

## 2. 디렉토리 구조

```
stocksense/
├── main.py                         # FastAPI 앱 + APScheduler 등록
├── train.py                        # 수동 모델 학습 스크립트
├── predict.py                      # CLI 즉시 예측 스크립트
│
├── config/
│   └── config.yaml                 # 종목 목록, 스케줄 시간, 이메일 설정
│
├── routers/
│   ├── dashboard.py                # GET / (대시보드 HTML)
│   ├── predict_api.py              # GET /api/predict/{ticker}
│   ├── report_api.py               # GET /api/report/{ticker}
│   └── history_api.py              # GET /api/history/{ticker}
│
├── services/
│   ├── data_collector.py           # FinanceDataReader 데이터 수집
│   ├── krx_collector.py            # pykrx 외국인/기관 수집
│   ├── news_crawler.py             # 네이버 모바일 뉴스 API (제목+링크, 관련성 정렬)
│   ├── sentiment_analyzer.py       # Gemini API 감성 분석 + 코멘트 생성
│   ├── feature_engine.py           # 기술적 지표 + 피처 계산
│   ├── direction_predictor.py      # 방향 예측 (RF + XGB 앙상블)
│   ├── price_range_estimator.py    # 가격대 예측 (ATR + 볼린저)
│   ├── model_trainer.py            # 모델 학습 + 저장
│   ├── report_generator.py         # PDF 애널리스트 리포트 생성
│   └── email_sender.py             # 이메일 HTML 본문 + PDF 첨부 전송
│
├── scheduler/
│   └── jobs.py                     # APScheduler 작업 정의
│
├── schemas/
│   ├── prediction.py               # 예측 결과 Pydantic 모델
│   └── report.py                   # 리포트 데이터 모델
│
├── models/                         # 학습된 모델 파일 (git 제외)
│   └── {ticker}/
│       ├── rf_model.pkl
│       ├── xgb_model.pkl
│       └── scaler.pkl
│
├── data/
│   ├── raw/                        # FinanceDataReader + pykrx 원본
│   ├── news/                       # 수집 뉴스 원본
│   └── features/                   # 피처 계산 결과
│
├── reports/                        # 생성된 PDF 리포트
│   └── 2026-06-26/
│       ├── 005930_report.pdf
│       └── 000660_report.pdf
│
├── logs/
│   ├── prediction_log.csv          # 날짜별 예측 기록
│   └── train_log.csv               # 재학습 기록
│
├── templates/
│   └── dashboard.html
│
├── static/
│   └── js/app.js
│
├── requirements.txt
└── .env                            # GEMINI_API_KEY, 이메일 설정
```

---

## 3. API 설계

### `GET /api/predict/{ticker}`
```json
{
  "ticker": "005930",
  "name": "삼성전자",
  "base_date": "2026-06-26",
  "predict_date": "2026-06-27",
  "today_close": 74200,
  "direction": "상승",
  "probability": 0.683,
  "investment_opinion": "매수",
  "price_range": {
    "bull": { "low": 74800, "high": 76500, "resistance1": 75200, "resistance2": 76500 },
    "bear": { "low": 72100, "high": 73200, "support1": 73200, "support2": 72100 }
  },
  "indicators": {
    "rsi_14": 58.2,
    "macd_hist": 142.0,
    "bb_position": 0.643,
    "volume_ratio": 1.38,
    "kospi_return": 0.83
  },
  "sentiment": {
    "score": 0.42,
    "news_count": 12,
    "positive": 7, "neutral": 3, "negative": 2
  },
  "smart_money": {
    "foreign_net_buy": 48500000000,
    "institution_net_buy": 12700000000,
    "foreign_consecutive_days": 3,
    "signal": "긍정적"
  },
  "model_accuracy_30d": 0.574
}
```

### `GET /api/report/{ticker}`
```
응답: PDF 파일 (application/pdf)
```

### `GET /api/history/{ticker}?days=30`
```json
{
  "ticker": "005930",
  "records": [
    { "date": "2026-06-26", "predicted": "상승", "actual": "상승", "correct": true, "prob": 0.683 },
    ...
  ],
  "accuracy_30d": 0.574
}
```

### `POST /api/train/{ticker}` (수동 재학습 트리거)
```json
{ "ticker": "005930", "status": "started", "job_id": "train_005930_20260626" }
```

---

## 4. 스케줄러 설계 (APScheduler)

```python
# scheduler/jobs.py

from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler(timezone="Asia/Seoul")

# 매일 오후 4시 30분: 전체 파이프라인 실행 (데이터→예측→리포트→이메일)
scheduler.add_job(
    run_daily_pipeline,
    trigger="cron",
    hour=16, minute=30,
    id="daily_pipeline"
)

# 매주 일요일 새벽 2시: 모델 자동 재학습
scheduler.add_job(
    run_weekly_retrain,
    trigger="cron",
    day_of_week="sun",
    hour=2, minute=0,
    id="weekly_retrain"
)
```

**`run_daily_pipeline` 실행 순서:**
```
1. 전체 종목 데이터 수집 (FinanceDataReader + pykrx)
2. 뉴스 수집 + Gemini 감성 분석
3. 피처 계산
4. 방향 예측 + 가격대 예측
5. Gemini AI 코멘트 생성
6. PDF 리포트 생성
7. 이메일 전송 (HTML 본문 + PDF 첨부)
8. 예측 결과 로그 저장
```

---

## 5. 환경 설정 (`config/config.yaml`)

```yaml
# 시가총액 상위 10개 기업 (삼성전자, SK하이닉스, SK스퀘어, 삼성전기, 현대차,
#  LG에너지솔루션, 삼성생명, 삼성물산, 삼성바이오로직스, HD현대중공업)
tickers:
  - code: "005930"
    name: "삼성전자"
    sector: "반도체/전자"
  - code: "000660"
    name: "SK하이닉스"
    sector: "반도체"
  # ... (전체 10개, config.yaml 참고)

schedule:
  daily_run_hour: 16        # 매일 오후 4시 30분
  daily_run_minute: 30
  retrain_day: "sun"        # 매주 일요일
  retrain_hour: 2           # 새벽 2시
  retrain_minute: 0

model:
  lookback_years: 3
  retrain_period_weeks: 1
  min_accuracy_threshold: 0.52  # 이 이하면 재학습 경고

email:
  send_report: true
  send_summary: true
  retry_on_fail: 2          # 실패 시 재시도 횟수
  recipients:               # 수신자 목록 (여러 명 가능)
    - "user@gmail.com"
  subject_prefix: "[StockSense]"
```

---

## 6. `.env` 파일

```env
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxx

# 이메일 발송 설정 (Gmail SMTP 기준)
EMAIL_SENDER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password      # Gmail 앱 비밀번호 (2단계 인증 필요)
EMAIL_RECIPIENTS=recipient@gmail.com  # 쉼표로 복수 입력 가능
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```
