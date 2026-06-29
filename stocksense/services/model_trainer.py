"""모델 학습 + 백테스트 + 저장"""

import pandas as pd
import numpy as np
import logging
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import TimeSeriesSplit

from services.feature_engine import FEATURE_COLS
from services.direction_predictor import save_models

logger = logging.getLogger(__name__)


def train(ticker_code: str, df: pd.DataFrame, config: dict = None) -> dict:
    """
    df: build_features()로 만든 피처 DataFrame
    반환: {"accuracy": 0.574, "report": "...", "n_train": 560, "n_test": 115}
    """
    cfg = config or {}
    n_estimators = cfg.get("rf_n_estimators", 200)
    max_depth = cfg.get("rf_max_depth", 10)
    min_samples_leaf = cfg.get("rf_min_samples_leaf", 5)

    # 사용 가능한 피처만 선택
    feature_cols = [c for c in FEATURE_COLS if c in df.columns]
    X = df[feature_cols].values
    y = df["target"].values

    # 시계열 분리 (75/10/15)
    n = len(X)
    train_end = int(n * 0.75)
    valid_end = train_end + int(n * 0.10)

    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[valid_end:], y[valid_end:]

    # 스케일링
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    # RandomForest
    rf = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        min_samples_leaf=min_samples_leaf,
        random_state=42,
        n_jobs=-1,
    )
    rf.fit(X_train_s, y_train)

    # XGBoost (선택적)
    xgb_model = None
    try:
        from xgboost import XGBClassifier
        xgb_model = XGBClassifier(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            use_label_encoder=False,
            eval_metric="logloss",
            random_state=42,
        )
        xgb_model.fit(X_train_s, y_train)
        logger.info("XGBoost 학습 완료")
    except ImportError:
        logger.warning("xgboost 미설치 → RF만 사용")

    # 앙상블 예측
    rf_prob = rf.predict_proba(X_test_s)[:, 1]
    if xgb_model:
        xgb_prob = xgb_model.predict_proba(X_test_s)[:, 1]
        final_prob = (rf_prob + xgb_prob) / 2
    else:
        final_prob = rf_prob
    y_pred = (final_prob >= 0.5).astype(int)

    acc = accuracy_score(y_test, y_pred)
    report = classification_report(y_test, y_pred, target_names=["하락", "상승"])

    logger.info(f"{ticker_code} 학습 완료 | 정확도: {acc:.3f} | 학습:{train_end}행 | 테스트:{len(X_test)}행")
    logger.info(f"\n{report}")

    save_models(ticker_code, rf, xgb_model, scaler, feature_cols)

    return {
        "ticker": ticker_code,
        "accuracy": round(acc, 4),
        "report": report,
        "n_train": train_end,
        "n_test": len(X_test),
        "features": feature_cols,
    }


def backtest(ticker_code: str, df: pd.DataFrame) -> list[dict]:
    """테스트셋 날짜별 예측 vs 실제 기록 반환"""
    from services.direction_predictor import load_models, models_exist

    if not models_exist(ticker_code):
        return []

    rf, xgb, scaler, features = load_models(ticker_code)
    feature_cols = [c for c in features if c in df.columns]
    X = df[feature_cols].values
    y = df["target"].values
    dates = df.index

    n = len(X)
    valid_end = int(n * 0.75) + int(n * 0.10)
    X_test = X[valid_end:]
    y_test = y[valid_end:]
    test_dates = dates[valid_end:]

    X_test_s = scaler.transform(X_test)
    rf_prob = rf.predict_proba(X_test_s)[:, 1]
    if xgb:
        xgb_prob = xgb.predict_proba(X_test_s)[:, 1]
        final_prob = (rf_prob + xgb_prob) / 2
    else:
        final_prob = rf_prob

    results = []
    for i, (d, prob, actual) in enumerate(zip(test_dates, final_prob, y_test)):
        predicted = 1 if prob >= 0.5 else 0
        results.append({
            "date": str(d.date()),
            "predicted": "상승" if predicted == 1 else "하락",
            "actual": "상승" if actual == 1 else "하락",
            "correct": bool(predicted == actual),
            "prob": round(float(prob), 4),
        })
    return results
