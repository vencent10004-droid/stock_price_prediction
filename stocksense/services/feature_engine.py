"""기술적 지표 계산 + ML 피처 엔지니어링"""

import pandas as pd
import numpy as np
import logging

logger = logging.getLogger(__name__)


# ─── 기술적 지표 ───────────────────────────────────────────────

def calc_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def calc_macd(close: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def calc_bollinger(close: pd.Series, period: int = 20, std_k: float = 2.0):
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + std_k * std
    lower = mid - std_k * std
    bb_position = (close - lower) / (upper - lower).replace(0, np.nan)
    return upper, mid, lower, bb_position


def calc_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


# ─── 피처 테이블 생성 ──────────────────────────────────────────

def build_features(stock_df: pd.DataFrame, market_data: dict = None,
                   investor_df: pd.DataFrame = None,
                   sentiment_score: float = 0.0) -> pd.DataFrame:
    """
    stock_df: OHLCV (open, high, low, close, volume)
    market_data: {"kospi": df, "nasdaq": df, "usdkrw": df}
    investor_df: 외국인/기관 순매수
    sentiment_score: 뉴스 감성 점수
    """
    df = stock_df.copy()

    # ── 수익률 ──
    df["return_1d"] = df["close"].pct_change()
    df["return_5d"] = df["close"].pct_change(5)
    df["return_20d"] = df["close"].pct_change(20)

    # ── 이동평균 ──
    for w in [5, 20, 60]:
        df[f"ma{w}"] = df["close"].rolling(w).mean()
        df[f"ma{w}_ratio"] = df["close"] / df[f"ma{w}"]

    # ── RSI ──
    df["rsi_14"] = calc_rsi(df["close"], 14)

    # ── MACD ──
    _, _, df["macd_hist"] = calc_macd(df["close"])

    # ── 볼린저밴드 ──
    df["bb_upper"], df["bb_mid"], df["bb_lower"], df["bb_position"] = calc_bollinger(df["close"])

    # ── ATR ──
    df["atr_14"] = calc_atr(df["high"], df["low"], df["close"], 14)
    df["atr_ratio"] = df["atr_14"] / df["close"]

    # ── 거래량 ──
    df["volume_ma20"] = df["volume"].rolling(20).mean()
    df["volume_ratio"] = df["volume"] / df["volume_ma20"]

    # ── 시장 지표 ──
    if market_data:
        for key, mdf in market_data.items():
            try:
                mdf_clean = mdf.copy()
                mdf_clean.index = pd.to_datetime(mdf_clean.index).normalize()
                df_idx = df.index.normalize()
                aligned = mdf_clean.reindex(df_idx, method="ffill")
                df[f"{key}_return"] = aligned[key].pct_change(fill_method=None)
            except Exception as e:
                logger.warning(f"{key} 시장 데이터 조인 실패: {e}")

    # ── 외국인/기관 ──
    if investor_df is not None and not investor_df.empty:
        df = df.join(investor_df, how="left")
        if "foreign_net" in df.columns:
            df["foreign_net_ma5"] = df["foreign_net"].rolling(5).mean()
        if "institution_net" in df.columns:
            df["institution_net_ma5"] = df["institution_net"].rolling(5).mean()

    # ── 감성 점수 (당일 고정값) ──
    df["sentiment_score"] = sentiment_score

    # ── 타겟: 내일 종가 > 오늘 종가 ──
    df["target"] = (df["close"].shift(-1) > df["close"]).astype(int)

    # 핵심 피처가 있는 행만 유지 (시장/감성 피처 NaN은 0으로 채움)
    market_cols = [c for c in df.columns if c.endswith("_return") and c != "return_1d"]
    df[market_cols] = df[market_cols].fillna(0)
    df.dropna(subset=[c for c in FEATURE_COLS if c in df.columns and c not in market_cols],
              inplace=True)
    logger.info(f"피처 생성 완료: {df.shape}")
    return df


FEATURE_COLS = [
    "return_1d", "return_5d", "return_20d",
    "ma5_ratio", "ma20_ratio", "ma60_ratio",
    "rsi_14", "macd_hist", "bb_position", "atr_ratio",
    "volume_ratio",
    "kospi_return", "nasdaq_return", "usdkrw_return",
    "sentiment_score",
]
