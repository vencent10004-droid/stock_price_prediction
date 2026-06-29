from fastapi import APIRouter, HTTPException
from datetime import datetime

router = APIRouter(prefix="/api", tags=["prediction"])


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
        stock_df = fetch_stock_data(ticker_code, years=3)
        market_data = fetch_market_data(years=1)
        investor_df = fetch_investor_data(ticker_code, days=90)
        headlines = fetch_naver_news(ticker_code, ticker_name, max_articles=10)
        sentiment = analyze_sentiment(ticker_name, headlines)
        df = build_features(stock_df, market_data, investor_df, sentiment["score"], ticker_code=ticker_code)
        latest = df.iloc[-1]
        prediction = predict(ticker_code, latest)
        indicators = {k: round(float(latest.get(k, 0)), 4)
                      for k in ["rsi_14", "macd_hist", "volume_ratio"]}
        analyst_comment = generate_analyst_comment(ticker_name, prediction, indicators, sentiment)

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
