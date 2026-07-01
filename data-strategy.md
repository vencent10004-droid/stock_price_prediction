# Data Strategy
# StockSense — 데이터 수집 및 피처 전략

**작성일:** 2026-06-26

---

## 1. 전체 데이터 파이프라인

```
[데이터 소스]                    [수집 방법]              [저장]
────────────────────────────────────────────────────────────
종목 OHLCV            →    FinanceDataReader     →  data/raw/
KOSPI / 나스닥 / 환율  →    FinanceDataReader     →  data/raw/
외국인/기관 순매수     →    pykrx                 →  data/raw/
종목 뉴스              →    네이버 모바일 뉴스 API  →  data/news/
                              ↓
                      [피처 엔지니어링]
                      기술적 지표 계산
                      감성 점수 계산 (Claude(Anthropic))
                      외국인/기관 파생 피처
                              ↓
                      data/features/{ticker}.csv
                              ↓
                      [모델 학습 / 예측]
```

---

## 2. 피처(Feature) 전체 목록

### 2-1. 가격 기반 피처 (8개)

| 피처명 | 설명 |
|--------|------|
| `daily_return` | 당일 등락률 `(종가-시가)/시가 × 100` |
| `overnight_gap` | 전일 종가 대비 오늘 시가 갭 |
| `high_low_range` | 당일 고저 변동폭 `(고가-저가)/저가 × 100` |
| `upper_shadow` | 윗꼬리 비율 (장대음봉/양봉 패턴) |
| `lower_shadow` | 아래꼬리 비율 (역망치 등 패턴) |
| `body_ratio` | 몸통 비율 (캔들 강도) |
| `prev_1d_return` | 전일 등락률 |
| `prev_5d_return` | 최근 5일 누적 등락률 |

### 2-2. 이동평균 피처 (6개)

| 피처명 | 설명 |
|--------|------|
| `ma5_ratio` | 종가 / MA5 (단기 위치) |
| `ma20_ratio` | 종가 / MA20 (중기 위치) |
| `ma60_ratio` | 종가 / MA60 (장기 위치) |
| `ma5_slope` | MA5 기울기 (상승 추세 강도) |
| `ma20_slope` | MA20 기울기 |
| `ma5_cross_ma20` | 골든크로스(1) / 데드크로스(0) |

### 2-3. 모멘텀·변동성 피처 (8개)

| 피처명 | 설명 | 해석 |
|--------|------|------|
| `rsi_14` | 14일 RSI | 70↑ 과매수 / 30↓ 과매도 |
| `rsi_slope` | RSI 기울기 | 방향 전환 신호 |
| `macd` | MACD 라인 | 추세 방향 |
| `macd_signal` | MACD 시그널 | 크로스 신호 |
| `macd_hist` | MACD 히스토그램 | 모멘텀 강도 |
| `bb_position` | 볼린저밴드 내 위치 (0~1) | 1 근접: 과매수 |
| `bb_width` | 볼린저밴드 폭 | 변동성 수준 |
| `atr_14` | ATR(평균 실제 변동폭) | 가격대 예측에 활용 |

### 2-4. 거래량 피처 (4개)

| 피처명 | 설명 |
|--------|------|
| `volume_ratio` | 당일 거래량 / 20일 평균 거래량 |
| `volume_ma5_slope` | 거래량 이동평균 기울기 |
| `obv` | OBV(On Balance Volume) — 누적 매수/매도 강도 |
| `volume_price_trend` | 거래량 × 가격 변화율 |

### 2-5. 시장 환경 피처 (5개)

| 피처명 | 소스 | 설명 |
|--------|------|------|
| `kospi_return` | FinanceDataReader `KS11` | KOSPI 당일 등락률 |
| `nasdaq_return` | FinanceDataReader `IXIC` | 나스닥 당일 등락률 |
| `usd_krw_change` | FinanceDataReader `USD/KRW` | 환율 전일 대비 변화 |
| `kospi_vs_stock` | 계산 | 종목 - KOSPI 상대 강도 |
| `market_fear_index` | 계산 | KOSPI 변동성 지수 대리변수 |

### 2-6. 외국인/기관 순매수 피처 (6개) ⭐ 신규

| 피처명 | 소스 | 설명 |
|--------|------|------|
| `foreign_net_buy` | pykrx | 외국인 당일 순매수(+)/순매도(-) 금액 |
| `institution_net_buy` | pykrx | 기관 당일 순매수/순매도 금액 |
| `foreign_consecutive` | 계산 | 외국인 연속 순매수(+)/순매도(-) 일수 |
| `institution_consecutive` | 계산 | 기관 연속 순매수/순매도 일수 |
| `foreign_buy_ratio` | pykrx | 외국인 보유 비율 변화 |
| `smart_money_signal` | 계산 | 외국인+기관 동반 순매수 여부 (0/1) |

**수집 예시:**
```python
from pykrx import stock

# 외국인/기관 순매수
df = stock.get_market_net_purchases_of_equities(
    fromdate="20260601",
    todate="20260626",
    ticker="005930",
    etf=False
)
# 컬럼: 외국인, 기관합계, 개인, 기타법인, 전체
```

### 2-7. 뉴스 감성 피처 (4개) ⭐ 신규

| 피처명 | 설명 |
|--------|------|
| `news_sentiment_score` | 당일 뉴스 평균 감성 점수 (-1 ~ +1) |
| `news_positive_ratio` | 긍정 뉴스 비율 (0 ~ 1) |
| `news_count` | 당일 수집된 뉴스 건수 |
| `news_sentiment_3d_avg` | 3일 이동평균 감성 점수 |

**수집 및 분석 흐름:**
```python
# 1. 네이버 모바일 주식 뉴스 API (제목 + 원문 링크 수집, 회사 관련성 우선 정렬)
import requests

def fetch_naver_news(ticker_code: str, ticker_name: str, max_articles=10) -> list[dict]:
    url = f"https://m.stock.naver.com/api/news/stock/{ticker_code}?pageSize=30&page=0"
    # 응답 JSON에서 title + mobileNewsUrl 추출 → {"title": ..., "url": ...}
    # 종목명이 제목/본문에 포함된 기사를 상위로 정렬
    ...

# 2. Claude(Anthropic) API로 감성 분석 (공식 anthropic SDK)
import anthropic

CLAUDE_MODEL = "claude-opus-4-8"

def analyze_sentiment(ticker_name: str, headlines: list[dict]) -> dict:
    titles = [h["title"] for h in headlines]
    prompt = f"""다음은 {ticker_name} 관련 오늘 뉴스 헤드라인입니다.
각 헤드라인을 긍정(+1)/중립(0)/부정(-1)으로 분류하고,
전체 점수(-1.0~+1.0)와 한 줄 요약을 JSON으로 반환하세요.
헤드라인: {titles}"""
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용 (SDK가 자동 재시도)
    resp = client.messages.create(model=CLAUDE_MODEL, max_tokens=1024,
                                  messages=[{"role": "user", "content": prompt}])
    text = "".join(b.text for b in resp.content if b.type == "text")
    return json.loads(text)
```

### 2-8. 시간 피처 (3개)

| 피처명 | 설명 |
|--------|------|
| `weekday` | 요일 (0=월 ~ 4=금) |
| `month` | 월 (1~12) |
| `is_month_end` | 월말 여부 (기관 리밸런싱 패턴) |

---

## 3. 레이블 (Label) 정의

### 방향 예측 레이블
```python
# 이진 분류: 내일 종가 > 오늘 종가 → 1(상승), 아니면 0(하락)
df['label_direction'] = (df['close'].shift(-1) > df['close']).astype(int)
```

### 가격대 예측 타깃
```python
# 내일 고가 / 저가 (회귀 예측용)
df['target_high']  = df['high'].shift(-1)   # 내일 도달 가능 고가
df['target_low']   = df['low'].shift(-1)    # 내일 하락 시 저가
df['target_close'] = df['close'].shift(-1)  # 내일 종가
```

---

## 4. 가격대 예측 계산 방법

```
[상승 시나리오 가격대]
  하단 = 오늘 종가 + (ATR_14 × 0.3)
  상단 = 오늘 종가 + (ATR_14 × 1.2) 또는 볼린저밴드 상단 중 낮은 값

[하락 시나리오 가격대]
  하단 = 오늘 종가 - (ATR_14 × 1.2) 또는 볼린저밴드 하단 중 높은 값
  상단 = 오늘 종가 - (ATR_14 × 0.3)

[피봇 포인트 지지/저항선 보조 활용]
  피봇 = (전일 고가 + 전일 저가 + 전일 종가) / 3
  1차 저항 = 2×피봇 - 전일 저가
  1차 지지 = 2×피봇 - 전일 고가
```

---

## 5. 전체 피처 수 요약

| 카테고리 | 피처 수 |
|----------|--------|
| 가격 기반 | 8개 |
| 이동평균 | 6개 |
| 모멘텀·변동성 | 8개 |
| 거래량 | 4개 |
| 시장 환경 | 5개 |
| 외국인/기관 | 6개 |
| 뉴스 감성 | 4개 |
| 시간 | 3개 |
| **합계** | **44개** |

---

## 6. 데이터 수집 범위

| 항목 | 내용 |
|------|------|
| 수집 기간 | 과거 3년 (약 750 거래일) |
| 학습/테스트 분리 | 최근 6개월 = 테스트, 나머지 = 학습 |
| 일별 업데이트 | 장 마감 후 오후 4시 30분 (외국인 데이터 공시 반영) |
| 뉴스 수집 시간 | 오후 4시 30분 (장 마감 직후 뉴스) |
| 재학습 주기 | 매주 일요일 새벽 2시 |
