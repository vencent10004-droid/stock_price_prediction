"""APScheduler 일별 예측 파이프라인 + 주별 재학습"""

import logging
import yaml
from pathlib import Path

logger = logging.getLogger(__name__)
CONFIG_PATH = Path(__file__).parent.parent / "config" / "config.yaml"


def _load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def run_daily_pipeline():
    """매일 16:30 실행 – 예측 + PDF 생성 + 이메일 발송"""
    from dotenv import load_dotenv
    load_dotenv()

    from services.data_collector import fetch_stock_data, fetch_market_data
    from services.krx_collector import fetch_investor_data
    from services.news_crawler import fetch_naver_news
    from services.sentiment_analyzer import analyze_sentiment, generate_analyst_comment
    from services.feature_engine import build_features
    from services.direction_predictor import predict, models_exist
    from services.price_range_estimator import estimate_price_range
    from services.report_generator import generate_pdf
    from services.email_sender import send_report

    cfg = _load_config()
    tickers = cfg.get("tickers", [])
    market_data = fetch_market_data(years=1)

    for t in tickers:
        code = t["code"]
        name = t["name"]
        logger.info(f"=== {name} ({code}) 파이프라인 시작 ===")
        try:
            stock_df = fetch_stock_data(code, years=3)
            investor_df = fetch_investor_data(code, days=90)
            headlines = fetch_naver_news(code, name, max_articles=10)
            sentiment = analyze_sentiment(name, headlines)

            df = build_features(stock_df, market_data, investor_df, sentiment["score"])
            if not models_exist(code):
                logger.warning(f"{code} 모델 없음 – 예측 건너뜀")
                continue

            latest_features = df.iloc[-1]
            prediction = predict(code, latest_features)

            indicators = {k: round(float(latest_features.get(k, 0)), 4)
                         for k in ["rsi_14", "macd_hist", "volume_ratio"]}
            analyst_comment = generate_analyst_comment(name, prediction, indicators, sentiment)
            price_range = estimate_price_range(df)
            pdf_path = generate_pdf(code, name, prediction, price_range, sentiment, analyst_comment, df)
            send_report(pdf_path, name, prediction, sentiment)

            logger.info(f"{name} 완료: {prediction['direction']} ({prediction['probability']*100:.1f}%)")
        except Exception as e:
            logger.error(f"{name} ({code}) 파이프라인 오류: {e}", exc_info=True)


def run_weekly_retrain():
    """매주 일요일 02:00 실행 – 전 종목 모델 재학습"""
    from dotenv import load_dotenv
    load_dotenv()

    from services.data_collector import fetch_stock_data, fetch_market_data
    from services.krx_collector import fetch_investor_data
    from services.feature_engine import build_features
    from services.model_trainer import train

    cfg = _load_config()
    tickers = cfg.get("tickers", [])
    market_data = fetch_market_data(years=3)
    model_cfg = cfg.get("model", {})

    for t in tickers:
        code = t["code"]
        name = t["name"]
        logger.info(f"=== {name} 재학습 시작 ===")
        try:
            stock_df = fetch_stock_data(code, years=3)
            investor_df = fetch_investor_data(code, days=750)
            df = build_features(stock_df, market_data, investor_df)
            result = train(code, df, model_cfg)
            logger.info(f"{name} 재학습 완료 | 정확도: {result['accuracy']:.4f}")
        except Exception as e:
            logger.error(f"{name} 재학습 오류: {e}", exc_info=True)


def setup_scheduler(app=None):
    """FastAPI lifespan에서 호출 – APScheduler 등록"""
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    cfg = _load_config()
    sched_cfg = cfg.get("schedule", {})

    daily_time = sched_cfg.get("daily_run", "16:30")
    daily_h, daily_m = daily_time.split(":")

    scheduler = BackgroundScheduler(timezone="Asia/Seoul")
    scheduler.add_job(
        run_daily_pipeline,
        CronTrigger(hour=int(daily_h), minute=int(daily_m), timezone="Asia/Seoul"),
        id="daily_pipeline",
        name="일별 예측 파이프라인",
    )
    scheduler.add_job(
        run_weekly_retrain,
        CronTrigger(day_of_week="sun", hour=2, minute=0, timezone="Asia/Seoul"),
        id="weekly_retrain",
        name="주별 모델 재학습",
    )
    scheduler.start()
    logger.info("스케줄러 시작: 매일 %s:%s 예측, 매주 일요일 02:00 재학습", daily_h, daily_m)
    return scheduler
