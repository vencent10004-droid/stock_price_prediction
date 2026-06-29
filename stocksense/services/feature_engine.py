"""기술적 지표 계산 + ML 피처 엔지니어링"""

import pandas as pd
import numpy as np
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_FOREIGN_CSV = Path(__file__).parent.parent / "data" / "foreign_flow.csv"


def load_foreign_flow() -> pd.DataFrame | None:
    """외국인/기관 순매수 일별 데이터 로드 (data/foreign_flow.csv). 없으면 None."""
    if not _FOREIGN_CSV.exists():
        return None
    try:
        f = pd.read_csv(_FOREIGN_CSV, parse_dates=["date"]).set_index("date").sort_index()
        return f
    except Exception as e:
        logger.warning(f"외국인 순매수 데이터 로드 실패: {e}")
        return None


def flow_signal_map() -> dict:
    """날짜별 '선물+ AND 콜+' 신호 여부 맵 {'YYYY-MM-DD': True/False}."""
    ff = load_foreign_flow()
    if ff is None or ff.empty or "foreign_net" not in ff.columns:
        return {}
    has_call = "call_net" in ff.columns
    out = {}
    for d, row in ff.iterrows():
        fnet = row.get("foreign_net", 0)
        cnet = row.get("call_net", 0) if has_call else 0
        if pd.notna(fnet):
            out[str(d.date())] = bool(fnet > 0 and (cnet if pd.notna(cnet) else 0) > 0)
    return out


def load_stock_flow(ticker_code: str) -> pd.Series | None:
    """종목별 외국인 현물 순매수 로드 (data/stock_flow_{code}.csv). 없으면 None."""
    if not ticker_code:
        return None
    path = _FOREIGN_CSV.parent / f"stock_flow_{ticker_code}.csv"
    if not path.exists():
        return None
    try:
        f = pd.read_csv(path, parse_dates=["date"]).set_index("date").sort_index()
        return f["foreign_stock_net"]
    except Exception as e:
        logger.warning(f"현물 수급 로드 실패 ({ticker_code}): {e}")
        return None


def latest_flow_signal() -> dict:
    """최신 외국인 선물·콜옵션 순매수 기준 '강한 상승 신호' 판정.

    선물 순매수>0 AND 콜옵션 순매수>0 → 검증상 다음날 상승 72% (고신뢰 알림용).
    """
    ff = load_foreign_flow()
    if ff is None or ff.empty or "foreign_net" not in ff.columns:
        return {"active": False}
    row = ff.dropna(subset=["foreign_net"])
    if row.empty:
        return {"active": False}
    last = row.iloc[-1]
    fnet = float(last.get("foreign_net", 0) or 0)
    cnet = float(last.get("call_net", 0) or 0) if "call_net" in ff.columns else 0.0
    return {
        "active": bool(fnet > 0 and cnet > 0),
        "date": str(row.index[-1].date()),
        "foreign_net": fnet,
        "call_net": cnet,
    }


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
                   sentiment_score: float = 0.0,
                   ticker_code: str = None) -> pd.DataFrame:
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

    # ── 추가 피처 (모두 과거 정보만 사용, 누수 없음) ──
    df["mom_10"] = df["close"].pct_change(10)             # 10일 모멘텀
    df["mom_60"] = df["close"].pct_change(60)             # 60일 모멘텀
    df["rsi_norm"] = (df["rsi_14"] - 50) / 50             # RSI 중심화(-1~1)
    df["bb_dist"] = df["bb_position"] - 0.5               # 볼린저 중앙 대비 위치
    df["atr_mean60"] = df["atr_ratio"].rolling(60).mean()
    df["vol_regime"] = df["atr_ratio"] / df["atr_mean60"] # 변동성 국면
    df["ma_gap"] = (df["ma5"] - df["ma20"]) / df["close"] # 단기-중기 추세 간격
    df["dow"] = df.index.dayofweek                        # 요일(0~4)
    df["hl_range"] = (df["high"] - df["low"]) / df["close"]  # 당일 변동폭
    df["up_streak"] = (df["return_1d"] > 0).rolling(3).sum()  # 최근 3일 상승일수

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

    # ── 외국인/기관 순매수 (data/foreign_flow.csv, 날짜 결합) ──
    # 외국인 순매수는 장 마감 후 집계 → T일 값으로 T+1 예측 (누수 아님)
    ff = load_foreign_flow()
    if ff is not None:
        idx = df.index.normalize()
        f_aligned = ff.reindex(idx)
        fn = f_aligned["foreign_net"].values
        df["foreign_net"] = np.nan_to_num(fn, nan=0.0)
        std = np.nanstd(fn) or 1.0
        df["foreign_net_z"] = np.nan_to_num(fn / std, nan=0.0)
        df["foreign_buy"] = (df["foreign_net"] > 0).astype(int)
        df["foreign_net_ma5"] = pd.Series(df["foreign_net"].values, index=df.index).rolling(5).mean().fillna(0).values
        # 콜옵션 외국인 순매수 (있을 때)
        if "call_net" in f_aligned.columns:
            cn = f_aligned["call_net"].values
            cstd = np.nanstd(cn) or 1.0
            df["call_net_z"] = np.nan_to_num(cn / cstd, nan=0.0)
            df["call_buy"] = (np.nan_to_num(cn, nan=0.0) > 0).astype(int)
        else:
            df["call_net_z"] = 0.0
            df["call_buy"] = 0
        # 상호작용: 선물 매수 + 콜 매수 동시 (검증상 다음날 상승 72%)
        df["fut_call_both"] = (df["foreign_buy"] & df["call_buy"]).astype(int)
    else:
        for col in ["foreign_net", "foreign_net_z", "foreign_net_ma5", "call_net_z"]:
            df[col] = 0.0
        for col in ["foreign_buy", "call_buy", "fut_call_both"]:
            df[col] = 0

    # ── 외국인 현물 순매수 (종목별 data/stock_flow_{code}.csv) ──
    sflow = load_stock_flow(ticker_code)
    if sflow is not None:
        sa = sflow.reindex(df.index.normalize()).values
        sstd = np.nanstd(sa) or 1.0
        df["foreign_stock_z"] = np.nan_to_num(sa / sstd, nan=0.0)
        df["foreign_stock_buy"] = (np.nan_to_num(sa, nan=0.0) > 0).astype(int)
    else:
        df["foreign_stock_z"] = 0.0
        df["foreign_stock_buy"] = 0

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


# 모델 입력 피처 (sentiment_score는 학습 시 상수라 제외 → 리포트 표시용으로만 사용)
FEATURE_COLS = [
    "return_1d", "return_5d", "return_20d",
    "ma5_ratio", "ma20_ratio", "ma60_ratio",
    "rsi_14", "macd_hist", "bb_position", "atr_ratio",
    "volume_ratio",
    "kospi_return", "nasdaq_return", "usdkrw_return",
    # 추가 피처
    "mom_10", "mom_60", "rsi_norm", "bb_dist", "vol_regime",
    "ma_gap", "dow", "hl_range", "up_streak",
    # 외국인 선물 순매수 피처 (검증상 모델 정확도 향상에 기여)
    "foreign_net_z", "foreign_buy", "foreign_net_ma5",
    # 외국인 현물 순매수 피처 (종목별, 검증상 정확도 향상)
    "foreign_stock_z", "foreign_stock_buy",
    # ※ 콜옵션(call_net_z/call_buy/fut_call_both)은 held-out 검증에서 개선 없어 모델 제외.
    #    단 "선물+ AND 콜+" 조합은 다음날 상승 72%로, 고신뢰 알림 규칙용으로는 유효.
]
