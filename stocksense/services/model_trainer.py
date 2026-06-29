"""모델 학습 + 백테스트 + 저장"""

import pandas as pd
import numpy as np
import logging
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, classification_report

from services.feature_engine import FEATURE_COLS
from services.direction_predictor import save_models

logger = logging.getLogger(__name__)


def _build_estimators():
    """규제 강한 모델들로 앙상블 구성 (과적합 방지 → 일반화 우선).

    실험 결과 기존 RF+XGB(깊은 트리)는 노이즈를 외워 테스트 성능이 동전보다
    낮았다. 규제를 강하게 준 트리 + 로지스틱 회귀 앙상블이 일반화가 가장 좋다.
    """
    estimators = []
    estimators.append(("logit", LogisticRegression(C=0.3, max_iter=1000)))
    estimators.append(("rf", RandomForestClassifier(
        n_estimators=400, max_depth=5, min_samples_leaf=30,
        max_features="sqrt", random_state=42, n_jobs=-1)))
    try:
        from xgboost import XGBClassifier
        estimators.append(("xgb", XGBClassifier(
            n_estimators=300, max_depth=3, learning_rate=0.02,
            subsample=0.8, colsample_bytree=0.8, reg_lambda=2.0,
            eval_metric="logloss", random_state=42)))
    except ImportError:
        logger.warning("xgboost 미설치 → logit+rf 만 사용")
    return estimators


def train(ticker_code: str, df: pd.DataFrame, config: dict = None) -> dict:
    """
    df: build_features()로 만든 피처 DataFrame
    반환: {"accuracy": ..., "report": ..., "n_train": ..., "n_test": ...}
    """
    feature_cols = [c for c in FEATURE_COLS if c in df.columns]
    X = df[feature_cols].values
    y = df["target"].values

    # 시계열 분리 (70/15/15) — train으로 학습, test로 평가 (valid는 구성 선택용 여유분)
    n = len(X)
    train_end = int(n * 0.70)
    valid_end = int(n * 0.85)

    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[valid_end:], y[valid_end:]

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    # 규제 앙상블 학습
    estimators = _build_estimators()
    fitted = []
    for name, est in estimators:
        est.fit(X_train_s, y_train)
        fitted.append(est)
    names = [n for n, _ in estimators]

    # 앙상블 확률 = 모델 평균
    probs = np.mean([m.predict_proba(X_test_s)[:, 1] for m in fitted], axis=0)
    y_pred = (probs >= 0.5).astype(int)

    acc = accuracy_score(y_test, y_pred)
    report = classification_report(y_test, y_pred, target_names=["하락", "상승"], zero_division=0)

    logger.info(f"{ticker_code} 학습 완료 | 정확도: {acc:.3f} | 모델:{names} | "
                f"학습:{train_end}행 | 테스트:{len(X_test)}행")
    logger.info(f"\n{report}")

    save_models(ticker_code, fitted, names, scaler, feature_cols)

    return {
        "ticker": ticker_code,
        "accuracy": round(acc, 4),
        "report": report,
        "n_train": train_end,
        "n_test": len(X_test),
        "features": feature_cols,
        "models": names,
    }


def backtest(ticker_code: str, df: pd.DataFrame) -> list[dict]:
    """테스트셋 날짜별 예측 vs 실제 기록 반환"""
    from services.direction_predictor import load_models, models_exist

    if not models_exist(ticker_code):
        return []

    models, names, scaler, features = load_models(ticker_code)
    feature_cols = [c for c in features if c in df.columns]
    X = df[feature_cols].values
    y = df["target"].values
    dates = df.index

    n = len(X)
    valid_end = int(n * 0.85)
    X_test = X[valid_end:]
    y_test = y[valid_end:]
    test_dates = dates[valid_end:]

    X_test_s = scaler.transform(X_test)
    final_prob = np.mean([m.predict_proba(X_test_s)[:, 1] for m in models], axis=0)

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
