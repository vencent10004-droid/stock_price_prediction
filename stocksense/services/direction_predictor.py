"""RandomForest + XGBoost 앙상블 방향 예측"""

import numpy as np
import pandas as pd
import joblib
import os
import logging
from pathlib import Path

from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent.parent / "models"


def _model_path(ticker_code: str):
    p = MODEL_DIR / ticker_code
    p.mkdir(parents=True, exist_ok=True)
    return p


def load_models(ticker_code: str):
    path = _model_path(ticker_code)
    rf = joblib.load(path / "rf_model.pkl")
    scaler = joblib.load(path / "scaler.pkl")
    features = joblib.load(path / "features.pkl")
    try:
        from xgboost import XGBClassifier
        xgb = joblib.load(path / "xgb_model.pkl")
    except Exception:
        xgb = None
    return rf, xgb, scaler, features


def save_models(ticker_code: str, rf, xgb, scaler, features):
    path = _model_path(ticker_code)
    joblib.dump(rf, path / "rf_model.pkl")
    joblib.dump(scaler, path / "scaler.pkl")
    joblib.dump(features, path / "features.pkl")
    if xgb is not None:
        joblib.dump(xgb, path / "xgb_model.pkl")
    logger.info(f"{ticker_code} 모델 저장 완료: {path}")


def models_exist(ticker_code: str) -> bool:
    path = _model_path(ticker_code)
    return (path / "rf_model.pkl").exists() and (path / "scaler.pkl").exists()


def predict(ticker_code: str, feature_row: pd.Series) -> dict:
    """
    저장된 모델로 단일 행 예측.
    반환: {"direction": "상승"/"하락", "probability": 0.73, "investment_opinion": "매수"}
    """
    if not models_exist(ticker_code):
        raise FileNotFoundError(f"모델 없음: {ticker_code}. 먼저 train.py를 실행하세요.")

    rf, xgb, scaler, features = load_models(ticker_code)

    # 피처 정렬
    available = [f for f in features if f in feature_row.index]
    x = feature_row[available].values.reshape(1, -1)
    x_scaled = scaler.transform(x)

    # RF 확률
    rf_prob = rf.predict_proba(x_scaled)[0][1]

    # XGB 확률 (있으면 앙상블)
    if xgb is not None:
        try:
            xgb_prob = xgb.predict_proba(x_scaled)[0][1]
            prob = (rf_prob * 0.5 + xgb_prob * 0.5)
        except Exception:
            prob = rf_prob
    else:
        prob = rf_prob

    direction = "상승" if prob >= 0.5 else "하락"
    opinion = _investment_opinion(prob)

    return {
        "direction": direction,
        "probability": round(float(prob), 4),
        "investment_opinion": opinion,
    }


def _investment_opinion(prob: float) -> str:
    if prob >= 0.70:
        return "강력매수"
    elif prob >= 0.60:
        return "매수"
    elif prob >= 0.45:
        return "중립"
    else:
        return "매도"
