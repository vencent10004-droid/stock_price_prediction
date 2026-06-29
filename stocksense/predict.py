"""즉시 예측 CLI: python predict.py [ticker_code]"""

import sys
import logging
import yaml
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.WARNING)

from services.data_collector import fetch_stock_data, fetch_market_data
from services.krx_collector import fetch_investor_data
from services.news_crawler import fetch_naver_news
from services.sentiment_analyzer import analyze_sentiment, generate_analyst_comment
from services.feature_engine import build_features
from services.direction_predictor import predict, models_exist
from services.price_range_estimator import estimate_price_range

cfg_path = Path(__file__).parent / "config" / "config.yaml"
with open(cfg_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f)

tickers = cfg.get("tickers", [])
target_codes = sys.argv[1:] if len(sys.argv) > 1 else [t["code"] for t in tickers]
market_data = fetch_market_data(years=1)

for t in tickers:
    if t["code"] not in target_codes:
        continue
    code = t["code"]
    name = t["name"]

    if not models_exist(code):
        print(f"[{name}] 모델 없음 – train.py 먼저 실행하세요.")
        continue

    print(f"\n{'='*50}")
    print(f"예측: {name} ({code})")
    print("="*50)

    stock_df = fetch_stock_data(code, years=3)
    investor_df = fetch_investor_data(code, days=90)
    headlines = fetch_naver_news(code, name, max_articles=5)
    sentiment = analyze_sentiment(name, headlines)
    df = build_features(stock_df, market_data, investor_df, sentiment["score"])
    latest = df.iloc[-1]
    result = predict(code, latest)
    price_range = estimate_price_range(df)
    indicators = {k: round(float(latest.get(k, 0)), 4)
                  for k in ["rsi_14", "macd_hist", "volume_ratio"]}
    comment = generate_analyst_comment(name, result, indicators, sentiment)

    direction_arrow = "▲" if result["direction"] == "상승" else "▼"
    print(f"내일 방향: {direction_arrow} {result['direction']}  ({result['probability']*100:.1f}%)")
    print(f"투자의견 : {result['investment_opinion']}")
    print(f"현재 종가: {int(stock_df['close'].iloc[-1]):,}원")
    print(f"\n[상승 시나리오] {price_range['bull']['low']:,} ~ {price_range['bull']['high']:,}원")
    print(f"[하락 시나리오] {price_range['bear']['low']:,} ~ {price_range['bear']['high']:,}원")
    print(f"\n뉴스 감성: {sentiment['score']:+.2f} – {sentiment.get('summary','')}")
    print(f"\n{comment}")
