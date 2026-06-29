"""pykrx로 외국인·기관 순매수 데이터 수집"""

import pandas as pd
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


def fetch_investor_data(ticker_code: str, days: int = 90) -> pd.DataFrame:
    """외국인·기관 순매수 수집 (최근 N일)"""
    try:
        from pykrx import stock  # pykrx 설치 필요

        end = datetime.today().strftime("%Y%m%d")
        start = (datetime.today() - timedelta(days=days)).strftime("%Y%m%d")

        df = stock.get_market_trading_value_by_date(start, end, ticker_code)
        if df.empty:
            raise ValueError(f"외국인/기관 데이터 없음: {ticker_code}")

        df.index.name = "date"
        df = df.rename(columns={
            "외국인합계": "foreign_net",
            "기관합계": "institution_net",
        })
        # 필요한 컬럼만 선택 (컬럼명이 다를 수 있어 방어적 처리)
        cols = [c for c in ["foreign_net", "institution_net"] if c in df.columns]
        df = df[cols]

        logger.info(f"{ticker_code} 외국인/기관 데이터 수집 완료: {len(df)}행")
        return df

    except Exception as e:
        logger.warning(f"pykrx 수집 실패 ({ticker_code}): {e} → 더미 데이터 반환")
        # pykrx 실패 시 0으로 채운 더미 반환 (서비스 중단 방지)
        idx = pd.date_range(end=datetime.today(), periods=days, freq="B")
        return pd.DataFrame({"foreign_net": 0, "institution_net": 0}, index=idx)


def calc_consecutive_days(series: pd.Series) -> int:
    """연속 순매수(+) 또는 순매도(-) 일수 계산"""
    if series.empty:
        return 0
    sign = 1 if series.iloc[-1] > 0 else -1
    count = 0
    for val in reversed(series.values):
        if (val > 0 and sign == 1) or (val < 0 and sign == -1):
            count += 1
        else:
            break
    return count * sign  # 양수=순매수 일수, 음수=순매도 일수
