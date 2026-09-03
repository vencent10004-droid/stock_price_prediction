# KOSPI 400 · KOSDAQ 100 외국인·기관 매매동향 대시보드

시가총액 상위 기업 — **코스피 400개 + 코스닥 100개 (ETF 제외)** — 의 일별 외국인·기관
매매동향을 수집해 `dashboard.html` 대시보드로 만들어주는 자동화 프로그램입니다.
대시보드에서 전체/코스피/코스닥 필터로 전환할 수 있습니다.

## 파일 구성

| 파일 | 설명 |
|---|---|
| `update_dashboard.py` | 데이터 수집 + 대시보드 생성 메인 스크립트 |
| `template.html` | 대시보드 HTML 템플릿 |
| `dashboard.html` | **결과물** — 브라우저로 열어서 보는 대시보드 |
| `data.json` | 수집된 원본 데이터 |
| `run_update.bat` | 작업 스케줄러가 매일 호출하는 배치 파일 |
| `update_log.txt` | 자동 실행 로그 |

## 외부 배포 (GitHub Pages)

- **대시보드 URL**: https://vencent10004-droid.github.io/stock_price_prediction/kospi100/
- GitHub Actions 워크플로(`update-kospi100.yml`)가 **평일 KST 18:30 클라우드에서 직접 수집**해
  `docs/kospi100/` 에 배포합니다 — 로컬 PC가 꺼져 있어도 매일 갱신됩니다.
- 저장소: https://github.com/vencent10004-droid/stock_price_prediction (`kospi_100/` 폴더)

## 동작 방식

- **데이터 출처**: 네이버 증권 (m.stock.naver.com)
- **종목 구성**: 실행일 기준 시가총액 상위 기업 KOSPI 400 + KOSDAQ 100 (`stockEndType == "stock"`, ETF/ETN 제외)
- **기간**: 실행일 기준 최근 14일(2주) 롤링 윈도우 — 매일 실행되면 시작일/종료일이 자동으로 하루씩 이동
- **지표**: 종목별 일별 외국인/기관 **순매매량(주)**, **순매매금액(억원, 추정 = 순매매량 × 당일 종가)**,
  **일별 주가 등락률(%)** (등락률 탭의 합계 열은 기간 누적 수익률)
  - 양수 = 순매수/상승(빨강), 음수 = 순매도/하락(파랑)
- **종목 링크**: 종목명 클릭(모바일은 상세 펼침의 "네이버 증권 ↗") 시 네이버 증권 종목 페이지로 이동
- **자동 실행**: Windows 작업 스케줄러 `KOSPI100_Dashboard` 가 **매일 18:30** `run_update.bat` 실행
  - 당일 투자자 데이터는 장 마감 후 저녁에 확정되므로, 18:30 실행 시점에 아직 없으면 다음 날 반영됩니다.
  - 주말/휴장일에도 실행되지만 새 거래일 데이터가 없으면 기간만 갱신됩니다.

## 수동 실행

```bash
python update_dashboard.py
```

## 스케줄 변경/삭제

```bash
schtasks /Change /TN "KOSPI100_Dashboard" /ST 19:00
```

```bash
schtasks /Delete /TN "KOSPI100_Dashboard" /F
```

## 참고 (데이터 한계)

- 네이버 증권은 종목별 매수/매도 **총액을 분리 제공하지 않고 순매매량만** 제공합니다.
  매수·매도 총액 분리 데이터가 필요하면 KRX 정보데이터시스템 계정이 필요합니다
  (pykrx 1.2.x 에 `KRX_ID`/`KRX_PW` 환경변수 설정).
- 순매매금액은 종가 기준 추정치로, 실제 체결 단가 기준 금액과 다소 차이가 있을 수 있습니다.
