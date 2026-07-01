"""주가 차트 데이터 API (대시보드 차트 탭)"""

from fastapi import APIRouter, HTTPException
from pathlib import Path
import yaml

router = APIRouter(prefix="/api", tags=["chart"])


def _ticker_name(code: str) -> str:
    cfg_path = Path(__file__).parent.parent / "config" / "config.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for t in cfg.get("tickers", []):
        if t["code"] == code:
            return t["name"]
    return code


@router.get("/chart/{ticker_code}")
def get_chart(ticker_code: str, days: int = 90):
    """최근 N거래일 종가·이동평균·거래량 시계열 반환."""
    from services.data_collector import fetch_stock_data

    try:
        df = fetch_stock_data(ticker_code, years=1)
        df = df.copy()
        df["ma5"] = df["close"].rolling(5).mean()
        df["ma20"] = df["close"].rolling(20).mean()
        tail = df.tail(days)

        def _num(v):
            return None if v != v else round(float(v), 1)   # NaN → None

        return {
            "ticker_code": ticker_code,
            "ticker_name": _ticker_name(ticker_code),
            "dates": [str(d.date()) for d in tail.index],
            "open": [int(v) for v in tail["open"]],
            "high": [int(v) for v in tail["high"]],
            "low": [int(v) for v in tail["low"]],
            "close": [int(v) for v in tail["close"]],
            "ma5": [_num(v) for v in tail["ma5"]],
            "ma20": [_num(v) for v in tail["ma20"]],
            "volume": [int(v) for v in tail["volume"]],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
