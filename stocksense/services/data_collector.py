"""FinanceDataReader + pykrx 기반 주가/시장 데이터 수집"""

import pandas as pd
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


def _date_range(years: int):
    end = datetime.today()
    start = end - timedelta(days=years * 365)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def fetch_stock_data(ticker_code: str, years: int = 3) -> pd.DataFrame:
    """종목 OHLCV 수집"""
    import FinanceDataReader as fdr
    start, end = _date_range(years)
    df = fdr.DataReader(ticker_code, start, end)
    if df.empty:
        raise ValueError(f"데이터 없음: {ticker_code}")

    df.columns = [c.lower() for c in df.columns]
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    # 필수 컬럼만
    cols = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
    df = df[cols].dropna()
    logger.info(f"{ticker_code} 주가 수집 완료: {len(df)}행")
    return df


def fetch_market_data(years: int = 3) -> dict:
    """KOSPI / NASDAQ / USD-KRW 수집"""
    import FinanceDataReader as fdr
    start, end = _date_range(years)
    result = {}

    sources = {
        "kospi":  ("KS11",  "KOSPI"),
        "nasdaq": ("IXIC",  "NASDAQ"),
        "usdkrw": ("USD/KRW", "USD/KRW"),
    }
    for key, (symbol, label) in sources.items():
        try:
            df = fdr.DataReader(symbol, start, end)
            if df.empty:
                raise ValueError("empty")
            df.columns = [c.lower() for c in df.columns]
            df.index = pd.to_datetime(df.index)
            df.index.name = "date"
            close_col = "close" if "close" in df.columns else df.columns[0]
            result[key] = df[[close_col]].rename(columns={close_col: key})
            logger.info(f"{label} 수집: {len(df)}행")
        except Exception as e:
            logger.warning(f"{label}({symbol}) 수집 실패: {e}")
    return result


def fetch_latest_close(ticker_code: str) -> float:
    """최신 종가 반환"""
    import FinanceDataReader as fdr
    df = fdr.DataReader(ticker_code)
    if df.empty:
        raise ValueError(f"최신 종가 없음: {ticker_code}")
    close_col = "Close" if "Close" in df.columns else "close"
    return float(df[close_col].iloc[-1])
