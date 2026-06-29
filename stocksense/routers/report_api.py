from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from datetime import datetime

router = APIRouter(prefix="/api", tags=["report"])


def _get_ticker_name(code: str, cfg: dict) -> str:
    for t in cfg.get("tickers", []):
        if t["code"] == code:
            return t["name"]
    return code


@router.get("/report/{ticker_code}")
def get_report(ticker_code: str, generate: bool = False):
    """
    저장된 최신 PDF 리포트 다운로드.
    generate=true 쿼리 파라미터로 즉시 생성 가능.
    """
    import yaml
    from dotenv import load_dotenv
    load_dotenv()

    cfg_path = Path(__file__).parent.parent / "config" / "config.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    ticker_name = _get_ticker_name(ticker_code, cfg)
    report_dir = Path(__file__).parent.parent / "reports"

    if generate:
        from services.data_collector import fetch_stock_data, fetch_market_data
        from services.krx_collector import fetch_investor_data
        from services.news_crawler import fetch_naver_news
        from services.sentiment_analyzer import analyze_sentiment, generate_analyst_comment
        from services.feature_engine import build_features
        from services.direction_predictor import predict, models_exist
        from services.price_range_estimator import estimate_price_range
        from services.report_generator import generate_pdf

        if not models_exist(ticker_code):
            raise HTTPException(status_code=404, detail="모델 없음")
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
            price_range = estimate_price_range(df)
            from services.model_trainer import backtest
            bt_records = backtest(ticker_code, df)
            pdf_path = generate_pdf(ticker_code, ticker_name, prediction,
                                    price_range, sentiment, analyst_comment, df,
                                    backtest_records=bt_records)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        today = datetime.now().strftime("%Y%m%d")
        pdf_path = report_dir / f"{ticker_code}_{today}.pdf"
        if not pdf_path.exists():
            # 최신 파일 검색
            files = sorted(report_dir.glob(f"{ticker_code}_*.pdf"), reverse=True)
            if not files:
                raise HTTPException(status_code=404,
                                    detail="리포트 없음. generate=true로 생성하거나 스케줄러 실행 필요.")
            pdf_path = files[0]

    return FileResponse(str(pdf_path), media_type="application/pdf",
                        filename=Path(pdf_path).name)
