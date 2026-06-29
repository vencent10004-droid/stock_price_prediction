# 소프트웨어 요구사항 명세서 (SRS)
# StockSense — AI 주가 방향 예측 & 애널리스트 리포트 자동화 시스템

| 항목 | 내용 |
|------|------|
| 문서 버전 | v1.0 |
| 작성일 | 2026-06-29 |
| 대상 시스템 | StockSense (AX 자동화 미니프로젝트) |
| 표준 | IEEE 830 / ISO·IEC·IEEE 29148 기반 |

---

## 1. 서론 (Introduction)

### 1.1 목적 (Purpose)
본 문서는 **StockSense** — AI 기반 한국 주식 방향 예측 및 애널리스트 리포트 자동화 시스템 —
의 소프트웨어 요구사항을 정의한다. 개발자, QA, PM, 운영자가 시스템을 설계·구현·테스트·운영하는
과정에서 참조한다.

### 1.2 범위 (Scope)
- **사용자:** 국내 주식에 관심 있는 개인 투자자 및 소규모 투자팀
- **기능:** 다종목 주가·뉴스·수급 데이터 수집, AI 방향/가격대 예측, 뉴스 감성 분석,
  애널리스트 리포트(PDF) 자동 생성, 웹 대시보드 조회, 이메일 자동 발송, 모델 자동 재학습
- **목표:** "내일 이 종목이 오를까 내릴까"에 대한 데이터 기반 예측과 근거를
  매일 자동으로 제공하여 투자 판단 보조
- **범위 외(Out of Scope):** 실제 매매 주문 실행, 자동 투자(트레이딩 봇), 투자 자문업 행위

### 1.3 정의 및 약어 (Definitions, Acronyms, Abbreviations)
| 용어 | 설명 |
|------|------|
| OHLCV | 시가(Open)·고가(High)·저가(Low)·종가(Close)·거래량(Volume) |
| RF | Random Forest (랜덤 포레스트 분류 모델) |
| XGB | XGBoost (그래디언트 부스팅 모델) |
| RSI / MACD | 기술적 지표 (상대강도지수 / 이동평균수렴확산) |
| ATR | Average True Range (평균 실제 변동폭) |
| 백테스트 | 과거 데이터로 모델 성능을 검증하는 시뮬레이션 |
| WAS | Web Application Server (웹 애플리케이션 서버) |
| API | Application Programming Interface |

### 1.4 참조 문서 (References)
- IEEE 830-1998 / ISO·IEC·IEEE 29148:2018 (요구사항 명세 표준)
- 프로젝트 내부 문서: [prd.md](prd.md), [architecture.md](architecture.md),
  [data-strategy.md](data-strategy.md), [model-strategy.md](model-strategy.md),
  [report-design.md](report-design.md), [화면설계서.html](화면설계서.html)

---

## 2. 전체 설명 (Overall Description)

### 2.1 제품 관점 (Product Perspective)
StockSense는 단일 서버에서 동작하는 웹 애플리케이션이다. 사용자는 웹 브라우저로 접속하며,
서버(FastAPI)는 외부 데이터 소스(한국거래소·네이버 뉴스·Google Gemini)와 연동하여 예측을 수행한다.
APScheduler가 매일 자동 파이프라인을 실행한다.

```
[웹 브라우저] → [FastAPI 서버] → [서비스 계층] → [외부 API / ML 모델]
                      │
                [APScheduler] 매일 16:30 자동 실행 → PDF + 이메일
```

### 2.2 제품 기능 요약 (Product Functions)
- 시가총액 상위 10개 종목의 주가·시장·수급·뉴스 데이터 수집
- 기술적 지표 및 뉴스 감성 점수 기반 피처 생성
- RF + XGBoost 앙상블로 내일 주가 방향(상승/하락) 및 신뢰도 예측
- 가격대 시나리오(상승/하락) 및 지지·저항선 산출
- Google Gemini 기반 뉴스 감성 분석 + 애널리스트 코멘트 생성
- PDF 애널리스트 리포트 자동 생성 및 이메일 발송
- 웹 대시보드(예측·백테스트·리포트 다운로드)
- 매주 1회 모델 자동 재학습

### 2.3 사용자 특성 (User Characteristics)
| 사용자 | 특성 | 요구 |
|--------|------|------|
| 개인 투자자 | IT 지식 보통, 빠른 결론 선호 | 직관적 대시보드, 한눈에 보이는 예측 |
| 투자팀 리더 | 매일 시황 공유 필요 | 자동 이메일 리포트 |
| 운영자/개발자 | 시스템 유지보수 | 로그, 설정 파일(config), 재학습 |

### 2.4 제약 조건 (Constraints)
- 실행 환경: Python 3.11+ (Windows / macOS), 24시간 구동 서버 권장
- 외부 의존: 한국거래소(FinanceDataReader·pykrx), 네이버 모바일 뉴스 API, Google Gemini API
- Gemini API 사용에 따른 소액 비용 발생
- 예측은 **참고용**이며 투자 자문이 아님 (면책 고지 필수 표기)

### 2.5 가정 및 의존성 (Assumptions and Dependencies)
- 네트워크 연결이 안정적이며 외부 API가 정상 응답한다고 가정
- 예측 대상 종목의 과거 3년 주가 데이터가 존재
- 종목별 학습 모델(`models/{code}/`)이 사전에 학습되어 있음
- `.env`에 `GEMINI_API_KEY` 및 이메일 설정이 입력되어 있음

---

## 3. 기능 요구사항 (Functional Requirements)

| ID | 요구사항 설명 | 우선순위 | 비고 |
|----|--------------|---------|------|
| FR-01 | 시스템은 종목별 3년치 OHLCV 및 KOSPI·나스닥·환율을 수집해야 한다. | Must | FinanceDataReader |
| FR-02 | 시스템은 외국인·기관 순매수(수급) 데이터를 수집해야 한다. | Must | pykrx |
| FR-03 | 시스템은 종목 관련 뉴스 헤드라인과 원문 링크를 수집하고, 회사 관련성이 높은 기사를 우선 정렬해야 한다. | Must | 네이버 모바일 뉴스 API |
| FR-04 | 시스템은 뉴스 헤드라인을 긍정/중립/부정으로 분석하고 감성 점수를 산출해야 한다. | Must | Google Gemini |
| FR-05 | 시스템은 기술적 지표(RSI·MACD·볼린저·이동평균·ATR)와 감성 점수로 피처를 생성해야 한다. | Must | feature_engine |
| FR-06 | 시스템은 RF+XGBoost 앙상블로 내일 방향(상승/하락)과 신뢰도(확률)를 예측해야 한다. | Must | 이진 분류 |
| FR-07 | 시스템은 상승/하락 시나리오별 가격대와 지지·저항선을 산출해야 한다. | Must | ATR·볼린저·피벗 |
| FR-08 | 시스템은 예측·지표·감성을 종합한 애널리스트 코멘트를 생성해야 한다. | Must | Gemini, 실패 시 규칙 기반 대체 |
| FR-09 | 시스템은 종목별 PDF 애널리스트 리포트를 생성해야 한다. | Must | reportlab |
| FR-10 | 시스템은 매일 16:30 전체 파이프라인을 자동 실행하고 결과를 이메일(HTML 본문 + PDF 첨부)로 발송해야 한다. | Should | APScheduler + SMTP |
| FR-11 | 시스템은 매주 일요일 02:00 전 종목 모델을 자동 재학습해야 한다. | Should | APScheduler |
| FR-12 | 사용자는 웹 대시보드에서 종목을 선택해 예측 결과를 조회할 수 있어야 한다. | Must | GET /api/predict/{code} |
| FR-13 | 사용자는 종목별 백테스트 적중률과 일자별 기록을 조회할 수 있어야 한다. | Should | GET /api/history/{code} |
| FR-14 | 사용자는 대시보드에서 뉴스 헤드라인을 클릭해 원문 기사로 이동할 수 있어야 한다. | Should | 새 탭 링크 |
| FR-15 | 사용자는 PDF 리포트를 다운로드할 수 있어야 한다. | Should | GET /api/report/{code} |
| FR-16 | 학습된 모델이 없는 종목은 예측 시 404 오류와 안내 메시지를 반환해야 한다. | Must | 예외 처리 |
| FR-17 | 관심 종목 목록은 설정 파일(config.yaml)에서 추가·제거할 수 있어야 한다. | Must | 운영 편의 |

---

## 4. 비기능 요구사항 (Non-functional Requirements)

| ID | 요구사항 설명 | 기준치 | 비고 |
|----|--------------|--------|------|
| NFR-01 | 단일 종목 예측 응답 시간 | 30~60초 이내 | 데이터 수집 + AI 호출 포함 |
| NFR-02 | PDF 리포트 생성 시간 | 종목당 1분 이내 | |
| NFR-03 | 방향 예측 정확도(백테스트) | 55% 이상 목표 | 종목별 상이 |
| NFR-04 | 외부 API 호출 안정성 | Gemini 타임아웃 60초 + 재시도 2회 | 일시적 실패 대응 |
| NFR-05 | 이메일 전송 실패 처리 | 실패 시 재시도(최대 2회) | |
| NFR-06 | 가용성 | 스케줄러 24시간 구동 | 서버 상시 가동 권장 |
| NFR-07 | 유지보수성 | 종목·스케줄·이메일 설정을 config로 분리 | 코드 수정 불필요 |
| NFR-08 | 보안 | API 키·이메일 비밀번호는 `.env`로 분리 (소스 미포함) | |
| NFR-09 | 사용성 | 다크 테마 반응형 UI, 국내 증시 색상 관례(상승=빨강/하락=파랑) | |

---

## 5. 외부 인터페이스 요구사항

### 5.1 사용자 인터페이스 (UI/UX)
- 웹 대시보드 (단일 페이지): 종목 선택 그리드 → 예측/백테스트 탭, PDF 다운로드 버튼
- 통계 카드(방향·신뢰도·투자의견·종가·RSI·거래량), 가격대 시나리오, 뉴스 감성 막대,
  헤드라인 목록(링크), 애널리스트 코멘트
- 상세: [화면설계서.html](화면설계서.html) 참조

### 5.2 하드웨어 인터페이스
- 클라이언트: PC/모바일 웹 브라우저
- 서버: Python 실행 가능 환경 (일반 PC 또는 클라우드 VM)

### 5.3 소프트웨어 인터페이스
| 구분 | 기술 |
|------|------|
| 백엔드 | Python · FastAPI · Uvicorn · APScheduler |
| 프런트엔드 | HTML · CSS · JavaScript (Jinja2 템플릿) |
| 데이터 수집 | FinanceDataReader, pykrx, 네이버 모바일 뉴스 API |
| AI/ML | scikit-learn(RandomForest), XGBoost, Google Gemini(REST) |
| 리포트/메일 | reportlab, matplotlib, smtplib(SMTP) |
| 데이터베이스 | (현재 파일 기반: .pkl·CSV·YAML) MariaDB/PostgreSQL 도입은 향후 과제 |

#### 주요 API
| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/` | 대시보드 화면 |
| GET | `/api/predict/{code}` | 단일 종목 예측 |
| GET | `/api/history/{code}` | 백테스트 기록 |
| GET | `/api/report/{code}` | PDF 리포트 생성·다운로드 |

### 5.4 통신 인터페이스
- 프로토콜: HTTP (로컬 `http://localhost:8000`), 외부 API는 HTTPS
- 응답 형식: JSON (예측/이력), application/pdf (리포트), text/html (대시보드)

---

## 6. 시스템 아키텍처 개요

```
[사용자] → [웹 브라우저] → [FastAPI 서버 / 라우터]
                                  │
                          [서비스 계층]
            data_collector · krx_collector · news_crawler
            sentiment_analyzer · feature_engine
            direction_predictor · price_range_estimator
            report_generator · email_sender
                                  │
        ┌─────────────────────────┼──────────────────────────┐
   [한국거래소/FDR]        [네이버 뉴스 API]          [Google Gemini]
   [pykrx 수급]            [ML 모델 RF+XGB(.pkl)]
```
- 상세 구조도: [architecture.md](architecture.md), `StockSense_웹서비스_구조도_v2.png`
- 처리 흐름: `StockSense_플로우차트_상세.png`

---

## 7. 요구사항 추적성 매트릭스 (RTM)

| 요구사항 ID | 구현 모듈 | 검증 방법 (테스트) |
|-------------|-----------|--------------------|
| FR-01 | services/data_collector.py | 3년 OHLCV 행 수 700+ 확인 |
| FR-02 | services/krx_collector.py | 수급 데이터 수집 확인 |
| FR-03 | services/news_crawler.py | 헤드라인 10건·링크·관련성 정렬 확인 |
| FR-04 | services/sentiment_analyzer.py | 긍/중/부 분류 및 점수 산출 확인 |
| FR-06 | services/direction_predictor.py | 백테스트 정확도 출력 |
| FR-07 | services/price_range_estimator.py | 상승/하락 시나리오 산출 확인 |
| FR-09 | services/report_generator.py | PDF 생성 확인 |
| FR-10 | scheduler/jobs.py + email_sender.py | 16:30 자동 실행·이메일 발송 확인 |
| FR-12 | routers/predict_api.py + app.js | 대시보드 예측 조회 동작 확인 |
| FR-16 | direction_predictor.models_exist | 모델 없는 종목 404 반환 확인 |

---

## 8. 부록 (Appendices)

### 8.1 지원 종목 (시가총액 상위 10개 · 기준 2026-06-26)
삼성전자(005930), SK하이닉스(000660), SK스퀘어(402340), 삼성전기(009150), 현대차(005380),
LG에너지솔루션(373220), 삼성생명(032830), 삼성물산(028260), 삼성바이오로직스(207940),
HD현대중공업(329180)

### 8.2 향후 과제
- 데이터베이스(MariaDB/PostgreSQL) 도입으로 예측 이력·뉴스·종목 마스터 영속화
- 예측 적중률 자동 집계 및 모델 성능 모니터링 대시보드

### ⚠️ 면책 고지
> 본 시스템이 생성하는 모든 예측 및 리포트는 알고리즘 기반 **참고 자료**이며 투자 권유가 아니다.
> 투자 결정과 그 결과에 대한 책임은 투자자 본인에게 있으며, 주식 투자에는 원금 손실 위험이 있다.
