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


def _build_estimators(scale_pos_weight: float = 1.0):
    """규제 강한 모델들로 앙상블 구성 (과적합 방지 → 일반화 우선).

    실험 결과 기존 RF+XGB(깊은 트리)는 노이즈를 외워 테스트 성능이 동전보다
    낮았다. 규제를 강하게 준 트리 + 로지스틱 회귀 앙상블이 일반화가 가장 좋다.

    class_weight='balanced' / scale_pos_weight 로 학습기 하락편향(상승<50%)을
    보정해 예측 확률이 한쪽(매도)으로 쏠리는 현상을 줄인다.
    """
    estimators = []
    estimators.append(("logit", LogisticRegression(
        C=0.3, max_iter=1000, class_weight="balanced")))
    estimators.append(("rf", RandomForestClassifier(
        n_estimators=400, max_depth=5, min_samples_leaf=30,
        max_features="sqrt", random_state=42, n_jobs=-1,
        class_weight="balanced")))
    try:
        from xgboost import XGBClassifier
        estimators.append(("xgb", XGBClassifier(
            n_estimators=300, max_depth=3, learning_rate=0.02,
            subsample=0.8, colsample_bytree=0.8, reg_lambda=2.0,
            scale_pos_weight=scale_pos_weight,
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
    df = df[df["target"].notna()]           # 정답 미정(마지막) 행 제외
    X = df[feature_cols].values
    y = df["target"].astype(int).values

    # 시계열 분리 (70/15/15) — train으로 학습, test로 평가 (valid는 구성 선택용 여유분)
    n = len(X)
    train_end = int(n * 0.70)
    valid_end = int(n * 0.85)

    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[valid_end:], y[valid_end:]

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    # 규제 앙상블 학습 (학습기 하락편향 보정: scale_pos_weight = 하락수/상승수)
    pos = int(y_train.sum()); neg = len(y_train) - pos
    spw = neg / pos if pos > 0 else 1.0
    estimators = _build_estimators(scale_pos_weight=spw)
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
    """날짜별 예측 vs 실제 기록 반환 (한 행 = 하루, 모든 값이 그날 기준).

    - 실제  : 그날 실제 등락 (당일 종가 vs 전일 종가) → 종가 화살표와 일치
    - 예측  : 그날 등락에 대한 예측 (전일 피처로 산출한 값)
    - 오늘  : 종가가 확정되지 않아 실제/정오는 '예측 대기'
    """
    from services.direction_predictor import load_models, models_exist

    if not models_exist(ticker_code):
        return []

    models, names, scaler, features = load_models(ticker_code)
    feature_cols = [c for c in features if c in df.columns]
    X = df[feature_cols].values
    closes = df["close"].values
    dates = df.index

    n = len(X)
    # 전체 행 예측 확률(그날 종가 > 전일 종가일 확률) — 각 행은 전일 피처로 산출됨
    prob_all = np.mean([m.predict_proba(scaler.transform(X))[:, 1] for m in models], axis=0)

    valid_end = max(int(n * 0.85), 1)
    results = []
    for j in range(valid_end, n):
        prev = closes[j - 1]
        chg_amt = int(closes[j] - prev)
        chg_pct = ((closes[j] - prev) / prev * 100) if prev else 0.0
        actual_up = 1 if closes[j] > prev else 0          # 그날 실제 등락(화살표와 동일)
        prob = float(prob_all[j - 1])                      # 전일 피처로 만든 그날 예측
        predicted = 1 if prob >= 0.5 else 0
        pending = (j == n - 1)                             # 오늘: 종가 미확정
        results.append({
            "date": str(dates[j].date()),
            "predicted": "상승" if predicted == 1 else "하락",
            "actual": None if pending else ("상승" if actual_up == 1 else "하락"),
            "correct": None if pending else bool(predicted == actual_up),
            "prob": round(prob, 4),
            "close": int(closes[j]),         # 그날 종가(오늘은 현재가)
            "chg_amt": chg_amt,              # 전일 대비 변화 금액(원)
            "chg_pct": round(float(chg_pct), 2),  # 전일 종가 대비 변화율(%)
            "pending": bool(pending),        # True = 오늘
        })
    return results
