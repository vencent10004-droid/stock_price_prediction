import time
import logging
from fastapi import APIRouter, HTTPException
from datetime import datetime

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["prediction"])

# ── AI 호출(감성분석·코멘트) 캐시 — 주가/예측은 캐싱하지 않고 항상 새로 계산 ──
_CACHE_TTL = 1800  # 30분
_news_cache = {}     # ticker -> (만료ts, headlines, sentiment)
_comment_cache = {}  # (ticker, 방향, 신뢰도버킷) -> (만료ts, comment)


def _get_ticker_name(code: str, cfg: dict) -> str:
    for t in cfg.get("tickers", []):
        if t["code"] == code:
            return t["name"]
    return code


@router.get("/predict/{ticker_code}")
def predict_ticker(ticker_code: str):
    """단일 종목 즉시 예측"""
    import yaml
    from pathlib import Path
    from dotenv import load_dotenv
    load_dotenv()

    cfg_path = Path(__file__).parent.parent / "config" / "config.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    from services.data_collector import fetch_stock_data, fetch_market_data
    from services.krx_collector import fetch_investor_data
    from services.news_crawler import fetch_naver_news
    from services.sentiment_analyzer import analyze_sentiment, generate_analyst_comment
    from services.feature_engine import build_features, latest_flow_signal
    from services.direction_predictor import predict, models_exist

    ticker_name = _get_ticker_name(ticker_code, cfg)

    if not models_exist(ticker_code):
        raise HTTPException(status_code=404,
                            detail=f"{ticker_code} 모델 없음. train.py 먼저 실행하세요.")
    try:
        now = time.time()

        # ① 주가·시장·수급은 매번 새로 계산 (오늘 현재가·방향 항상 최신)
        stock_df = fetch_stock_data(ticker_code, years=3)
        market_data = fetch_market_data(years=1)
        investor_df = fetch_investor_data(ticker_code, days=90)

        # ② 뉴스+감성(Claude)은 30분 캐시 (뉴스는 자주 안 바뀜, 느리고 유료)
        nc = _news_cache.get(ticker_code)
        if nc and nc[0] > now:
            headlines, sentiment = nc[1], nc[2]
            logger.info(f"{ticker_code} 감성 캐시 사용")
        else:
            headlines = fetch_naver_news(ticker_code, ticker_name, max_articles=10)
            sentiment = analyze_sentiment(ticker_name, headlines)
            _news_cache[ticker_code] = (now + _CACHE_TTL, headlines, sentiment)

        # ③ 방향 예측은 항상 새로 계산
        df = build_features(stock_df, market_data, investor_df, sentiment["score"], ticker_code=ticker_code)
        latest = df.iloc[-1]
        prediction = predict(ticker_code, latest)
        indicators = {k: round(float(latest.get(k, 0)), 4)
                      for k in ["rsi_14", "macd_hist", "volume_ratio"]}

        # ④ 코멘트(Claude)는 (종목+방향+신뢰도) 캐시 → 예측 바뀌면 자동 재생성
        ckey = (ticker_code, prediction.get("direction"), round(prediction.get("probability", 0), 2))
        cc = _comment_cache.get(ckey)
        if cc and cc[0] > now:
            analyst_comment = cc[1]
            logger.info(f"{ticker_code} 코멘트 캐시 사용")
        else:
            analyst_comment = generate_analyst_comment(ticker_name, prediction, indicators, sentiment)
            _comment_cache[ckey] = (now + _CACHE_TTL, analyst_comment)

        from services.price_range_estimator import estimate_price_range
        price_range = estimate_price_range(df)

        return {
            "ticker_code": ticker_code,
            "ticker_name": ticker_name,
            **prediction,
            "close_price": int(stock_df["close"].iloc[-1]),
            **{k: indicators[k] for k in indicators},
            "sentiment_score": sentiment["score"],
            "sentiment_summary": sentiment.get("summary", ""),
            "sentiment": sentiment,
            "headlines": headlines,
            "bull": price_range.get("bull", {}),
            "bear": price_range.get("bear", {}),
            "pivot": price_range.get("pivot", 0),
            "analyst_comment": analyst_comment,
            "strong_signal": latest_flow_signal(),
            "generated_at": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
