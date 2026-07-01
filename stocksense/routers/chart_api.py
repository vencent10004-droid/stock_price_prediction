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
        close = df["close"]

        # 이동평균
        df["ma5"] = close.rolling(5).mean()
        df["ma20"] = close.rolling(20).mean()

        # 볼린저밴드 (중심=MA20, ±2σ)
        std20 = close.rolling(20).std()
        df["bb_upper"] = df["ma20"] + 2 * std20
        df["bb_lower"] = df["ma20"] - 2 * std20

        # RSI(14)
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, 1e-9)
        df["rsi"] = 100 - 100 / (1 + rs)

        # MACD (12,26,9)
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        signal = macd.ewm(span=9, adjust=False).mean()
        df["macd"] = macd
        df["macd_signal"] = signal
        df["macd_hist"] = macd - signal

        tail = df.tail(days)

        def _num(v, nd=1):
            return None if v != v else round(float(v), nd)   # NaN → None

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
            "bb_upper": [_num(v) for v in tail["bb_upper"]],
            "bb_lower": [_num(v) for v in tail["bb_lower"]],
            "rsi": [_num(v, 1) for v in tail["rsi"]],
            "macd": [_num(v, 2) for v in tail["macd"]],
            "macd_signal": [_num(v, 2) for v in tail["macd_signal"]],
            "macd_hist": [_num(v, 2) for v in tail["macd_hist"]],
            "volume": [int(v) for v in tail["volume"]],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
