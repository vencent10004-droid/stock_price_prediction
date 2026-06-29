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

## ⚠️ 면책 고지
이 프로그램의 예측 결과는 **학습 및 참고 목적**입니다.  
실제 투자 결정의 책임은 본인에게 있습니다. 주식 투자에는 원금 손실 위험이 있습니다.
