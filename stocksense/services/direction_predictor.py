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
    """반환: (models[list], names[list], scaler, features)"""
    path = _model_path(ticker_code)
    scaler = joblib.load(path / "scaler.pkl")
    features = joblib.load(path / "features.pkl")
    ens_path = path / "ensemble.pkl"
    if ens_path.exists():
        data = joblib.load(ens_path)
        return data["models"], data["names"], scaler, features
    # 레거시 호환 (구 rf+xgb 포맷)
    models, names = [joblib.load(path / "rf_model.pkl")], ["rf"]
    try:
        models.append(joblib.load(path / "xgb_model.pkl")); names.append("xgb")
    except Exception:
        pass
    return models, names, scaler, features


def save_models(ticker_code: str, models, names, scaler, features):
    path = _model_path(ticker_code)
    joblib.dump({"models": list(models), "names": list(names)}, path / "ensemble.pkl")
    joblib.dump(scaler, path / "scaler.pkl")
    joblib.dump(features, path / "features.pkl")
    logger.info(f"{ticker_code} 모델 저장 완료: {path} (앙상블: {names})")


def models_exist(ticker_code: str) -> bool:
    path = _model_path(ticker_code)
    has_model = (path / "ensemble.pkl").exists() or (path / "rf_model.pkl").exists()
    return has_model and (path / "scaler.pkl").exists()


def predict(ticker_code: str, feature_row: pd.Series) -> dict:
    """
    저장된 모델로 단일 행 예측.
    반환: {"direction": "상승"/"하락", "probability": 0.73, "investment_opinion": "매수"}
    """
    if not models_exist(ticker_code):
        raise FileNotFoundError(f"모델 없음: {ticker_code}. 먼저 train.py를 실행하세요.")

    models, names, scaler, features = load_models(ticker_code)

    # 피처 정렬 (학습 시 사용한 features 순서 그대로)
    x = feature_row.reindex(features).values.reshape(1, -1).astype(float)
    x_scaled = scaler.transform(x)

    # 앙상블 확률 = 모델 평균
    prob = float(np.mean([m.predict_proba(x_scaled)[0][1] for m in models]))

    direction = "상승" if prob >= 0.5 else "하락"
    opinion = _investment_opinion(prob)

    return {
        "direction": direction,
        "probability": round(float(prob), 4),
        "investment_opinion": opinion,
    }


def _investment_opinion(prob: float) -> str:
    # 0.5 중심 대칭 기준 (매수/매도 동등 조건)
    if prob >= 0.62:
        return "강력매수"
    elif prob >= 0.54:
        return "매수"
    elif prob > 0.46:
        return "중립"
    elif prob > 0.38:
        return "매도"
    else:
        return "강력매도"
