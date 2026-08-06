# -*- coding: utf-8 -*-
"""GitHub Pages용 히트맵 데이터 생성 스크립트 (코스피 100 + 코스닥 50).

docs/sectors.json        : 코스피 {종목코드: KRX 업종명}
docs/sectors_kosdaq.json : 코스닥 {종목코드: KRX 업종명}
docs/data.json           : 코스피 상위 100 종목 시세 스냅숏
docs/data_kosdaq.json    : 코스닥 상위 50 종목 시세 스냅숏

GitHub Actions에서 장중 주기 실행되며, 실패해도 기존 파일을 유지한 채 종료한다.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(BASE, "docs")

KST = timezone(timedelta(hours=9))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
NAVER_H = {"User-Agent": UA}
DAUM_H = {"User-Agent": UA, "Referer": "https://finance.daum.net/domestic/sectors"}

MARKETS = {
    "KOSPI": {
        "top_n": 100,
        "data_file": "data.json",
        "sector_file": "sectors.json",
        # 개별 업종이 아닌 집계 지수는 매핑에서 제외
        "aggregates": {"제조업", "코스피 대형주", "코스피 중형주", "코스피 소형주"},
        # 금융업이 보험/증권을 포괄하므로 마지막에 덮어씀 (KOSPD 지도와 동일한 그룹화)
        "override_last": "금융업",
    },
    "KOSDAQ": {
        "top_n": 50,
        "data_file": "data_kosdaq.json",
        "sector_file": "sectors_kosdaq.json",
        "aggregates": {"제조", "코스닥 IT", "IT H/W", "IT S/W & SVC", "통신방송서비스",
                       "코스닥 대형주", "코스닥 중형주", "코스닥 소형주"},
        "override_last": None,
    },
}

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


def fetch_sectors(market):
    cfg = MARKETS[market]
    r = requests.get(f"https://finance.daum.net/api/quotes/sectors?market={market}",
                     headers=DAUM_H, timeout=20)
    r.raise_for_status()
    sectors = r.json()["data"]
    mapping = {}
    for sec in sectors:
        name = sec.get("sectorName", "")
        if name in cfg["aggregates"] or name == cfg["override_last"]:
            continue
        pretty = SECTOR_RENAME.get(name, name)
        for st in sec.get("includedStocks", []):
            code = st.get("symbolCode", "")[1:]
            if code:
                mapping[code] = pretty
    if cfg["override_last"]:
        for sec in sectors:
            if sec.get("sectorName") == cfg["override_last"]:
                for st in sec.get("includedStocks", []):
                    code = st.get("symbolCode", "")[1:]
                    if code:
                        mapping[code] = cfg["override_last"]
    return mapping


def fetch_stocks(market, sector_map):
    cfg = MARKETS[market]
    rows = []
    for page in (1, 2):
        r = requests.get(
            f"https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100",
            headers=NAVER_H, timeout=15)
        r.raise_for_status()
        rows.extend(r.json().get("stocks", []))
    stocks = []
    for s in rows:
        code = s.get("itemCode", "")
        if s.get("stockEndType") != "stock":     # ETF/ETN 등 제외
            continue
        if not code or code[-1] != "0":          # 우선주/특수주 제외
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
        if len(stocks) >= cfg["top_n"]:
            break
    return stocks


def fetch_index(market):
    try:
        r = requests.get(f"https://m.stock.naver.com/api/index/{market}/basic",
                         headers=NAVER_H, timeout=10)
        d = r.json()
        return {"value": num(d.get("closePrice")), "rate": num(d.get("fluctuationsRatio"))}
    except Exception:
        return None


def update_market(market):
    cfg = MARKETS[market]
    sector_path = os.path.join(DOCS, cfg["sector_file"])
    try:
        sector_map = fetch_sectors(market)
        with open(sector_path, "w", encoding="utf-8") as f:
            json.dump(sector_map, f, ensure_ascii=False)
        print(f"{cfg['sector_file']}: {len(sector_map)} codes")
    except Exception as e:
        print(f"WARN: {market} sector fetch failed ({e})", file=sys.stderr)
        if os.path.exists(sector_path):
            with open(sector_path, encoding="utf-8") as f:
                sector_map = json.load(f)
        else:
            sector_map = {}

    try:
        stocks = fetch_stocks(market, sector_map)
        if len(stocks) < cfg["top_n"] // 2:
            raise ValueError(f"too few stocks: {len(stocks)}")
        data = {
            "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
            "kospi": fetch_index(market),   # 프런트 호환 위해 키 이름 유지 (해당 시장 지수)
            "stocks": stocks,
        }
        with open(os.path.join(DOCS, cfg["data_file"]), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"{cfg['data_file']}: {len(stocks)} stocks @ {data['updated']}")
    except Exception as e:
        print(f"WARN: {market} quote fetch failed ({e})", file=sys.stderr)


def main():
    os.makedirs(DOCS, exist_ok=True)
    for market in MARKETS:
        update_market(market)


if __name__ == "__main__":
    main()
