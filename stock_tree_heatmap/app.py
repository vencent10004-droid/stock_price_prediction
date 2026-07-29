# -*- coding: utf-8 -*-
"""KOSPI 시가총액 상위 100 종목 실시간 트리맵 히트맵 서버.

- 실시간 시세: 네이버 증권 모바일 API (지연 없음, 장중 실시간)
- 업종 분류(KRX): 다음 금융 API (하루 1회 캐시)
"""
import json
import os
import threading
import webbrowser
from datetime import date, datetime

import requests
from flask import Flask, jsonify, render_template

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SECTOR_CACHE_FILE = os.path.join(BASE_DIR, "sector_cache.json")

TOP_N = 100          # 표시할 종목 수
PORT = 8050

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
NAVER_HEADERS = {"User-Agent": UA}
DAUM_HEADERS = {"User-Agent": UA, "Referer": "https://finance.daum.net/domestic/sectors"}

# 개별 종목이 아닌 집계 지수는 업종 매핑에서 제외
AGGREGATE_SECTORS = {"제조업", "코스피 대형주", "코스피 중형주", "코스피 소형주"}

# 화면 표시용 업종명 정리
SECTOR_RENAME = {
    "전기,전자": "전기전자",
    "섬유,의복": "섬유의복",
    "종이,목재": "종이목재",
    "철강및금속": "철강금속",
    "운수창고": "운수창고업",
}

app = Flask(__name__)

_sector_lock = threading.Lock()


def _num(text, default=0.0):
    """'12,160,260' / '-5.45' / '-' 같은 문자열을 float로 변환."""
    if text is None:
        return default
    s = str(text).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return default


def fetch_sector_map():
    """다음 금융에서 KRX 업종 분류를 받아 {종목코드: 업종명} 매핑 생성."""
    r = requests.get("https://finance.daum.net/api/quotes/sectors?market=KOSPI",
                     headers=DAUM_HEADERS, timeout=20)
    r.raise_for_status()
    sectors = r.json()["data"]
    mapping = {}
    # 1차: 세부 업종 (금융업 제외 — 금융업이 보험/증권을 포괄하므로 마지막에 덮어씀)
    for sec in sectors:
        name = sec.get("sectorName", "")
        if name in AGGREGATE_SECTORS or name == "금융업":
            continue
        pretty = SECTOR_RENAME.get(name, name)
        for st in sec.get("includedStocks", []):
            code = st.get("symbolCode", "")[1:]  # 'A005930' -> '005930'
            if code:
                mapping[code] = pretty
    # 2차: 금융업(은행/보험/증권/지주 포괄)으로 덮어쓰기 — KOSPD 지도와 동일한 그룹화
    for sec in sectors:
        if sec.get("sectorName") == "금융업":
            for st in sec.get("includedStocks", []):
                code = st.get("symbolCode", "")[1:]
                if code:
                    mapping[code] = "금융업"
    return mapping


def get_sector_map():
    """업종 매핑을 하루 1회만 새로 받고 파일에 캐시. 실패 시 이전 캐시 사용."""
    today = date.today().isoformat()
    with _sector_lock:
        cache = None
        if os.path.exists(SECTOR_CACHE_FILE):
            try:
                with open(SECTOR_CACHE_FILE, encoding="utf-8") as f:
                    cache = json.load(f)
            except (json.JSONDecodeError, OSError):
                cache = None
        if cache and cache.get("date") == today and cache.get("mapping"):
            return cache["mapping"]
        try:
            mapping = fetch_sector_map()
            with open(SECTOR_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({"date": today, "mapping": mapping}, f, ensure_ascii=False)
            return mapping
        except (requests.RequestException, KeyError, ValueError):
            if cache and cache.get("mapping"):
                return cache["mapping"]  # 오래됐어도 있는 캐시로 버팀
            raise


def fetch_top_stocks():
    """네이버에서 코스피 시가총액 상위 종목 실시간 시세 조회 (우선주 제외 후 상위 TOP_N)."""
    rows = []
    for page in (1, 2):
        r = requests.get(
            f"https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page={page}&pageSize=100",
            headers=NAVER_HEADERS, timeout=15)
        r.raise_for_status()
        rows.extend(r.json().get("stocks", []))

    stocks = []
    for s in rows:
        code = s.get("itemCode", "")
        if s.get("stockEndType") != "stock":  # ETF/ETN 등 제외
            continue
        if not code or code[-1] != "0":   # 표준코드 끝자리 0이 아니면 우선주/특수주
            continue
        price = _num(s.get("closePrice"))
        o = s.get("overMarketPriceInfo") or {}
        ov_price = _num(o.get("overPrice"))
        # 시간외(NXT 프리/애프터마켓) 등락률: 직전 정규장 종가 대비
        ov_rate = round((ov_price - price) / price * 100, 2) if ov_price > 0 and price > 0 else 0.0
        stocks.append({
            "code": code,
            "name": s.get("stockName", ""),
            "price": price,
            "change": _num(s.get("compareToPreviousClosePrice")),
            "rate": _num(s.get("fluctuationsRatio")),
            "cap": _num(s.get("marketValue")),  # 단위: 억원
            "ov": {
                "price": ov_price,
                "rate": ov_rate,
                "session": o.get("tradingSessionType") or "",
                "status": o.get("overMarketStatus") or "",
            },
        })
        if len(stocks) >= TOP_N:
            break
    return stocks


def fetch_kospi_index():
    """코스피 지수 현재값."""
    try:
        r = requests.get("https://m.stock.naver.com/api/index/KOSPI/basic",
                         headers=NAVER_HEADERS, timeout=10)
        d = r.json()
        return {
            "value": _num(d.get("closePrice")),
            "rate": _num(d.get("fluctuationsRatio")),
        }
    except (requests.RequestException, ValueError):
        return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/heatmap")
def api_heatmap():
    try:
        stocks = fetch_top_stocks()
    except requests.RequestException as e:
        return jsonify({"error": f"시세 조회 실패: {e}"}), 502
    try:
        sector_map = get_sector_map()
    except Exception:
        sector_map = {}
    for st in stocks:
        st["sector"] = sector_map.get(st["code"], "기타")
    return jsonify({
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "kospi": fetch_kospi_index(),
        "stocks": stocks,
    })


def _open_browser():
    webbrowser.open(f"http://127.0.0.1:{PORT}")


if __name__ == "__main__":
    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(1.2, _open_browser).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)
