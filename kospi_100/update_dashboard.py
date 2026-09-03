# -*- coding: utf-8 -*-
"""
KOSPI 상위 400 + KOSDAQ 상위 100 종목 — 외국인/기관 매매동향 대시보드 자동 업데이트

데이터 출처 : 네이버 증권 (m.stock.naver.com 비공식 API)
동작 방식   :
  - 시가총액 상위 기업(ETF 제외) — KOSPI 400개, KOSDAQ 100개
  - 실행 시점 기준 최근 14일(2주) 롤링 윈도우 → 매일 실행하면 시작일/종료일이 자동으로 하루씩 이동
  - 종목별 일별 외국인/기관 순매매량 + 종가 수집
  - 순매매금액(추정) = 순매매량 x 당일 종가
  - 결과를 data.json 저장 후 template.html 에 주입하여 dashboard.html 생성

실행       : python update_dashboard.py
자동 실행  : GitHub Actions (평일 KST 18:30) + Windows 작업 스케줄러 "KOSPI100_Dashboard"
"""
import datetime
import json
import pathlib
import sys
import time

import requests

BASE = pathlib.Path(__file__).resolve().parent
WINDOW_DAYS = 14          # 롤링 윈도우 (달력일 기준 2주)
MARKETS = [("KOSPI", 400), ("KOSDAQ", 100)]   # (시장, 시총 상위 기업 수) — ETF 제외
REQUEST_DELAY = 0.12      # 요청 간 지연 (초)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://m.stock.naver.com",
    "Accept": "application/json",
}


def get_json(url, retries=3):
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(1 + attempt)
    return None


def num(s):
    """'+5,971,830' / '-3,550,689' / '208,500' → int"""
    if s is None:
        return 0
    s = str(s).replace(",", "").replace("+", "").strip()
    try:
        return int(s)
    except ValueError:
        return 0


def fetch_top(market, n):
    """시가총액 상위 n개 기업 (ETF/ETN 제외)."""
    picked, page = [], 1
    while len(picked) < n and page <= 15:
        url = f"https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100"
        data = get_json(url)
        batch = (data or {}).get("stocks", [])
        if not batch:
            break
        picked += [s for s in batch if s.get("stockEndType") == "stock"]
        page += 1
        time.sleep(REQUEST_DELAY)
    if not picked:
        raise RuntimeError(f"{market} 시가총액 상위 종목 목록을 가져오지 못했습니다.")
    return picked[:n]


def fetch_trend(code, start_str):
    """종목별 일별 투자자 동향. bizdate >= start_str 인 행만 반환."""
    url = f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize=25&page=1"
    rows = get_json(url)
    days = {}
    if not isinstance(rows, list):
        return days
    for row in rows:
        bd = row.get("bizdate")
        if not bd or bd < start_str:
            continue
        fq = num(row.get("foreignerPureBuyQuant"))
        oq = num(row.get("organPureBuyQuant"))
        close = num(row.get("closePrice"))
        diff = num(row.get("compareToPreviousClosePrice"))
        prev = close - diff
        chg = round(diff / prev * 100, 2) if prev else 0.0
        days[bd] = {
            "fq": fq,                              # 외국인 순매매량 (주)
            "oq": oq,                              # 기관 순매매량 (주)
            "fv": round(fq * close / 1e8, 1),      # 외국인 순매매금액 추정 (억원)
            "ov": round(oq * close / 1e8, 1),      # 기관 순매매금액 추정 (억원)
            "close": close,
            "chg": chg,                            # 일별 주가 등락률 (%)
        }
    return days


def main():
    today = datetime.date.today()
    start = today - datetime.timedelta(days=WINDOW_DAYS - 1)
    start_str = start.strftime("%Y%m%d")

    print(f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] 수집 시작 "
          f"(기간 {start} ~ {today})")

    targets = []
    for market, n in MARKETS:
        top = fetch_top(market, n)
        print(f"  {market} 상위 {len(top)}개 기업 목록 확보")
        for rank, s in enumerate(top, 1):
            targets.append((market, rank, s))

    all_dates = set()
    stocks = []
    failed = []

    for i, (market, rank, s) in enumerate(targets, 1):
        code = s.get("itemCode")
        name = s.get("stockName", code)
        days = fetch_trend(code, start_str)
        if not days:
            failed.append(f"{name}({code})")
        all_dates.update(days.keys())
        stocks.append({
            "rank": rank,
            "market": market,
            "code": code,
            "name": name,
            "mcap": s.get("marketValueHangeul", ""),
            "days": days,
        })
        if i % 50 == 0:
            print(f"  ... {i}/{len(targets)} 종목 수집")
        time.sleep(REQUEST_DELAY)

    data = {
        "updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "windowStart": start.isoformat(),
        "windowEnd": today.isoformat(),
        "dates": sorted(all_dates),
        "stocks": stocks,
    }

    (BASE / "data.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8")

    tpl_path = BASE / "template.html"
    if not tpl_path.exists():
        print("경고: template.html 이 없어 dashboard.html 을 생성하지 못했습니다.")
        sys.exit(1)
    tpl = tpl_path.read_text(encoding="utf-8")
    html = tpl.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False))
    (BASE / "dashboard.html").write_text(html, encoding="utf-8")

    msg = (f"완료: 종목 {len(stocks)}개, 거래일 {len(data['dates'])}일 "
           f"→ dashboard.html")
    if failed:
        msg += f" (데이터 없음: {', '.join(failed[:5])}"
        msg += f" 외 {len(failed)-5}건)" if len(failed) > 5 else ")"
    print(msg)


if __name__ == "__main__":
    main()
