"""볼린저밴드 + ATR + 피봇 포인트 기반 가격대 예측"""

import pandas as pd
import numpy as np


def estimate_price_range(df: pd.DataFrame) -> dict:
    """
    df: 피처가 계산된 DataFrame (마지막 행 = 오늘)
    반환: 상승/하락 시나리오 가격대
    """
    row = df.iloc[-1]
    close = float(row["close"])
    high = float(df["high"].iloc[-1])
    low = float(df["low"].iloc[-1])
    prev_close = float(df["close"].iloc[-2]) if len(df) >= 2 else close

    # ATR
    atr = float(row.get("atr_14", close * 0.015))

    # 볼린저밴드
    bb_upper = float(row.get("bb_upper", close * 1.02))
    bb_lower = float(row.get("bb_lower", close * 0.98))

    # 피봇 포인트
    pivot = (high + low + prev_close) / 3
    r1 = 2 * pivot - low       # 저항1
    r2 = pivot + (high - low)  # 저항2
    s1 = 2 * pivot - high      # 지지1
    s2 = pivot - (high - low)  # 지지2

    # 상승 시나리오: 목표가 범위
    bull_low = close + atr * 0.3
    bull_high = max(bb_upper, r1, bull_low + atr)

    # 하락 시나리오: 지지선 범위
    bear_high = close - atr * 0.3
    bear_low = min(bb_lower, s1, bear_high - atr)

    # 역전 방지
    if bull_high < bull_low:
        bull_high = bull_low + atr
    if bear_low > bear_high:
        bear_low = bear_high - atr

    return {
        "bull": {
            "low": int(bull_low),
            "high": int(bull_high),
            "resistance1": int(round(r1)),
            "resistance2": int(round(r2)),
        },
        "bear": {
            "low": int(bear_low),
            "high": int(bear_high),
            "support1": int(round(s1)),
            "support2": int(round(s2)),
        },
        "pivot": int(round(pivot)),
        "atr": round(atr, 0),
    }
