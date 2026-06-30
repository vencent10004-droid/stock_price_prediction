# StockSense — AI 주가 방향 예측 & 애널리스트 리포트 자동화
## BMAD 개발 문서 인덱스

**프로젝트명:** StockSense  
**버전:** 2.0 (전면 확장)  
**작성일:** 2026-06-26 / **최종 업데이트:** 2026-06-29  
**목표:** 다종목 AI 주가 예측 + 가격대 제시 + 전문 애널리스트 리포트 자동 생성 + 이메일 발송

---

## 핵심 플로우

```
[매일 장 마감 후 16:30 자동 실행]
         │
         ├─① 주가 OHLCV + 기술적 지표 수집 (FinanceDataReader)
         ├─② 뉴스 크롤링 → Google Gemini 감성 분석
         ├─③ 외국인/기관 순매수 데이터 수집 (pykrx)
         │
         ▼
   [AI 예측 엔진]
   방향 예측 (상승↑/하락↓) + 확률  (RandomForest + XGBoost 앙상블)
   가격대 예측 (상승 시 목표가 범위 / 하락 시 지지선 범위)
         │
         ▼
   [애널리스트 리포트 자동 생성]
   전문가 수준 분석 보고서 (PDF)
         │
         ├─ 웹 대시보드 시각화 (http://localhost:8000)
         └─ 이메일 자동 전송 (HTML 본문 + PDF 첨부)
```

---

## 문서 목록

| # | 문서 | 파일 | 설명 |
|---|------|------|------|
| 1 | 제품 요구사항 | [prd.md](prd.md) | 전체 기능 요구사항, 성공 지표 |
| 2 | 데이터 전략 | [data-strategy.md](data-strategy.md) | 피처 목록, 뉴스·외국인 데이터 수집 |
| 3 | 아키텍처 | [architecture.md](architecture.md) | 시스템 구조, API, 스케줄러 설계 |
| 4 | 모델 전략 | [model-strategy.md](model-strategy.md) | 방향+가격대 예측 모델 설계 |
| 5 | 리포트 설계 | [report-design.md](report-design.md) | 애널리스트 리포트 구성 및 포맷 |
| 6 | 유저 스토리 | [stories.md](stories.md) | Epic/Story 백로그 |
| 7 | 구현 계획 | [implementation-plan.md](implementation-plan.md) | 단계별 개발 순서 |
| 8 | 화면 설계서 | [화면설계서.html](화면설계서.html) | 대시보드 UI 화면 명세 |

---

## 현재 상태

| 단계 | 상태 |
|------|------|
| 기획 / 문서화 | ✅ 완료 |
| 데이터 파이프라인 | ✅ 완료 (FinanceDataReader + pykrx) |
| AI 예측 모델 | ✅ 완료 (RF + XGBoost, 종목별 학습) |
| 뉴스 감성 분석 | ✅ 완료 (Google Gemini, 회사 관련성 정렬 + 기사 링크) |
| 외국인/기관 데이터 | ✅ 완료 |
| 애널리스트 리포트 생성 | ✅ 완료 (PDF) |
| 이메일 알림 | ✅ 완료 (HTML 본문 + PDF 첨부) |
| 자동 재학습 스케줄러 | ✅ 완료 (APScheduler) |
| 웹 대시보드 | ✅ 완료 (FastAPI) |

---

## 실행 방법

```bash
cd stocksense
pip install -r requirements.txt

# .env 파일에 GEMINI_API_KEY, 이메일 설정 입력 (.env.example 참고)

python train.py        # 전체 종목 모델 학습 (최초 1회)
python -m uvicorn main:app --host 127.0.0.1 --port 8000   # 웹 서버 실행
# → 브라우저에서 http://localhost:8000 접속
```

지원 종목은 `stocksense/config/config.yaml`에서 관리하며, 현재 시가총액 상위 10개 기업으로 설정되어 있다.

---

## ☁️ 클라우드 배포 (Render.com)

외부에서 브라우저로 접속 가능한 웹 서비스로 배포하려면:

1. [Render.com](https://render.com) 가입 후 GitHub 계정 연결
2. 대시보드 → **New → Blueprint** → 이 저장소(`stock_price_prediction`) 선택
   - 저장소 루트의 `render.yaml`을 자동 인식한다.
3. 환경변수 입력 (Environment 탭):
   - `GEMINI_API_KEY` — **필수** (Google AI Studio에서 발급)
   - `EMAIL_SENDER`, `EMAIL_PASSWORD`, `EMAIL_RECIPIENTS` — 이메일 리포트 사용 시 (Gmail은 앱 비밀번호)
4. **Create** → 자동 빌드·배포 → 발급된 `https://stocksense-xxxx.onrender.com` 주소를 외부인에게 공유

**배포 시 참고**
- 학습 모델(`models/`)은 저장소에 포함되어 있어 배포 즉시 예측이 동작한다.
- 무료 플랜은 15분 미사용 시 휴면(첫 접속이 느려짐)하며 RAM 512MB 제한이 있다. 안정 운영 시 유료 플랜 권장.
- 접속자 모두가 배포자의 `GEMINI_API_KEY`를 공유 사용한다(호출 비용·한도 주의).
- 자동 스케줄러(매일 16:30 이메일)는 서버 휴면 시 발동되지 않는다.

---

## ⚠️ 면책 고지
이 프로그램의 예측 결과는 **학습 및 참고 목적**입니다.  
실제 투자 결정의 책임은 본인에게 있습니다. 주식 투자에는 원금 손실 위험이 있습니다.
