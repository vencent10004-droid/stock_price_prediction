# -*- coding: utf-8 -*-
"""GitHub Pages용 히트맵 데이터 생성 스크립트.

docs/sectors.json  : {종목코드: KRX 업종명} (다음 금융)
docs/data.json     : 코스피 상위 100 종목 시세 스냅숏 (네이버 증권)

GitHub Actions에서 장중 주기 실행되며, 실패해도 기존 파일을 유지한 채 종료한다.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(BASE, "docs")

TOP_N = 100
KST = timezone(timedelta(hours=9))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
NAVER_H = {"User-Agent": UA}
DAUM_H = {"User-Agent": UA, "Referer": "https://finance.daum.net/domestic/sectors"}

AGGREGATE_SECTORS = {"제조업", "코스피 대형주", "코스피 중형주", "코스피 소형주"}
SECTOR_RENAME = {
    "전기,전자": "전기전자",
    "섬유,의복": "섬유의복",
    "종이,목재": "종이목재",
    "철강및금속": "철강금속",
    "운수창고": "운수창고업",
}


def num(text, default=0.0):
    if text is None:
        return default
    try:
        return float(str(text).replace(",", "").strip())
    except ValueError:
        return default


def fetch_sectors():
    r = requests.get("https://finance.daum.net/api/quotes/sectors?market=KOSPI",
                     headers=DAUM_H, timeout=20)
    r.raise_for_status()
    sectors = r.json()["data"]
    mapping = {}
    for sec in sectors:
        name = sec.get("sectorName", "")
        if name in AGGREGATE_SECTORS or name == "금융업":
            continue
        pretty = SECTOR_RENAME.get(name, name)
        for st in sec.get("includedStocks", []):
            code = st.get("symbolCode", "")[1:]
            if code:
                mapping[code] = pretty
    for sec in sectors:
        if sec.get("sectorName") == "금융업":
            for st in sec.get("includedStocks", []):
                code = st.get("symbolCode", "")[1:]
                if code:
                    mapping[code] = "금융업"
    return mapping


def fetch_stocks(sector_map):
    rows = []
    for page in (1, 2):
        r = requests.get(
            f"https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page={page}&pageSize=100",
            headers=NAVER_H, timeout=15)
        r.raise_for_status()
        rows.extend(r.json().get("stocks", []))
    stocks = []
    for s in rows:
        code = s.get("itemCode", "")
        if s.get("stockEndType") != "stock":
            continue
        if not code or code[-1] != "0":
            continue
        price = num(s.get("closePrice"))
        o = s.get("overMarketPriceInfo") or {}
        ov_price = num(o.get("overPrice"))
        stocks.append({
            "code": code,
            "name": s.get("stockName", ""),
            "price": price,
            "change": num(s.get("compareToPreviousClosePrice")),
            "rate": num(s.get("fluctuationsRatio")),
            "cap": num(s.get("marketValue")),
            "sector": sector_map.get(code, "기타"),
            "ov": {
                "price": ov_price,
                # 네이버 표기와 동일: 전일 종가 대비 등락률
                "rate": num(o.get("fluctuationsRatio")),
                "change": num(o.get("compareToPreviousClosePrice")),
                "session": o.get("tradingSessionType") or "",
                "status": o.get("overMarketStatus") or "",
            },
        })
        if len(stocks) >= TOP_N:
            break
    return stocks


def fetch_kospi():
    try:
        r = requests.get("https://m.stock.naver.com/api/index/KOSPI/basic",
                         headers=NAVER_H, timeout=10)
        d = r.json()
        return {"value": num(d.get("closePrice")), "rate": num(d.get("fluctuationsRatio"))}
    except Exception:
        return None


def main():
    os.makedirs(DOCS, exist_ok=True)
    try:
        sector_map = fetch_sectors()
        with open(os.path.join(DOCS, "sectors.json"), "w", encoding="utf-8") as f:
            json.dump(sector_map, f, ensure_ascii=False)
        print(f"sectors.json: {len(sector_map)} codes")
    except Exception as e:
        print(f"WARN: sector fetch failed ({e}) — keeping existing file", file=sys.stderr)
        sector_path = os.path.join(DOCS, "sectors.json")
        if os.path.exists(sector_path):
            with open(sector_path, encoding="utf-8") as f:
                sector_map = json.load(f)
        else:
            sector_map = {}

    try:
        stocks = fetch_stocks(sector_map)
        if len(stocks) < 50:
            raise ValueError(f"too few stocks: {len(stocks)}")
        data = {
            "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
            "kospi": fetch_kospi(),
            "stocks": stocks,
        }
        with open(os.path.join(DOCS, "data.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"data.json: {len(stocks)} stocks @ {data['updated']}")
    except Exception as e:
        print(f"WARN: quote fetch failed ({e}) — keeping existing file", file=sys.stderr)


if __name__ == "__main__":
    main()
