from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history/{ticker_code}")
def get_history(ticker_code: str):
    """백테스트 결과(테스트셋 예측 vs 실제) 반환"""
    import yaml
    from pathlib import Path
    from dotenv import load_dotenv
    load_dotenv()

    cfg_path = Path(__file__).parent.parent / "config" / "config.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    from services.data_collector import fetch_stock_data, fetch_market_data
    from services.krx_collector import fetch_investor_data
    from services.feature_engine import build_features, flow_signal_map
    from services.model_trainer import backtest
    from services.direction_predictor import models_exist

    if not models_exist(ticker_code):
        raise HTTPException(status_code=404, detail="모델 없음")

    try:
        stock_df = fetch_stock_data(ticker_code, years=3)
        market_data = fetch_market_data(years=3)
        investor_df = fetch_investor_data(ticker_code, days=750)
        df = build_features(stock_df, market_data, investor_df, ticker_code=ticker_code)
        results = backtest(ticker_code, df)
        # 신호일(선물+ AND 콜+) 표시
        sig_map = flow_signal_map()
        for r in results:
            r["signal"] = sig_map.get(r["date"], False)
        # 정확도는 정답이 확정된 행(오늘 제외)만으로 계산
        evaluated = [r for r in results if not r.get("pending")]
        correct = sum(1 for r in evaluated if r["correct"])
        accuracy = correct / len(evaluated) if evaluated else 0

        return {
            "ticker_code": ticker_code,
            "total": len(evaluated),
            "correct": correct,
            "accuracy": round(accuracy, 4),
            "records": results[-30:],  # 최근 30일만 (오늘 예측대기 행 포함)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
