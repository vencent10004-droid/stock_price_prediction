# Model Strategy
# StockSense 주가 방향 예측 — 모델 전략

**작성일:** 2026-06-26 / **최종 업데이트:** 2026-06-29

> 모델은 종목별로 독립 학습되며, 학습 파일은 `models/{종목코드}/` 아래에
> `rf_model.pkl`, `xgb_model.pkl`, `scaler.pkl`, `features.pkl`로 저장된다.
> 실제 학습은 RandomForest + XGBoost 앙상블을 사용한다.

---

## 1. 문제 정의

```
입력 (오늘 데이터) → 모델 → 출력 (내일 방향)

출력:
  - 클래스: 1 (상승) / 0 (하락)
  - 확률:   상승 확률 73%, 하락 확률 27%
```

이진 분류(Binary Classification) 문제

---

## 2. 모델 선택

### MVP: RandomForest Classifier

| 항목 | 내용 |
|------|------|
| **선택 이유** | 과적합 강함, 피처 중요도 해석 가능, 빠른 학습 |
| **라이브러리** | `scikit-learn` |
| **하이퍼파라미터** | `n_estimators=200`, `max_depth=10`, `random_state=42` |
| **출력** | 클래스(0/1) + `predict_proba`로 확률 |

```python
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(
    n_estimators=200,   # 트리 200개
    max_depth=10,       # 과적합 방지
    min_samples_leaf=5, # 잎 노드 최소 샘플 수
    random_state=42
)
```

### 비교 모델 (성능 검증용)

| 모델 | 특징 | 사용 여부 |
|------|------|---------|
| RandomForest | 기본, 해석 용이 | ✅ 메인 모델 |
| XGBoost | 성능 우수, 약간 복잡 | 🔧 비교용 |
| Logistic Regression | 가장 단순, 기준선(Baseline) | 🔧 기준선 |
| LSTM | 시계열 특화, 복잡 | ⬜ v2 |

---

## 3. 학습 전략

### 데이터 분리

```
전체 데이터 (3년 ≈ 750일)
├── 학습셋 (Train): 75% ≈ 560일  ← 모델 학습
├── 검증셋 (Valid): 10% ≈ 75일   ← 하이퍼파라미터 튜닝
└── 테스트셋 (Test): 15% ≈ 115일 ← 최종 성능 평가 (절대 학습에 미사용)

⚠️ 주의: 시계열 데이터이므로 무작위 분리 X
        반드시 시간 순서대로 앞→학습, 뒤→테스트
```

```python
# 시계열 분리 (시간 순서 유지)
train_size = int(len(df) * 0.75)
valid_size = int(len(df) * 0.10)

X_train = X[:train_size]
X_valid = X[train_size:train_size + valid_size]
X_test  = X[train_size + valid_size:]

y_train = y[:train_size]
y_valid = y[train_size:train_size + valid_size]
y_test  = y[train_size + valid_size:]
```

---

## 4. 성능 평가 지표

| 지표 | 설명 | 목표 |
|------|------|------|
| **Accuracy** | 전체 예측 중 맞은 비율 | 55% 이상 |
| **Precision** | 상승 예측 중 실제 상승 비율 | 참고 |
| **Recall** | 실제 상승 중 맞게 예측한 비율 | 참고 |
| **F1-Score** | Precision + Recall 조화평균 | 참고 |

### 기준선(Baseline)
- **랜덤 예측:** 50%
- **항상 상승 예측:** 실제 상승일 비율 (약 50~53%)
- **우리 목표:** 55% 이상 → 의미 있는 예측

---

## 5. 백테스트 전략

### 백테스트란?
과거 데이터로 "만약 이 모델을 실제로 썼다면 어땠을까"를 시뮬레이션

```python
# 백테스트 시뮬레이션
results = []
for i in range(len(X_test)):
    prediction = model.predict([X_test[i]])[0]
    actual = y_test[i]
    results.append({
        "date": test_dates[i],
        "predicted": "상승" if prediction == 1 else "하락",
        "actual": "상승" if actual == 1 else "하락",
        "correct": prediction == actual
    })

accuracy = sum(r["correct"] for r in results) / len(results)
print(f"백테스트 정확도: {accuracy:.1%}")
```

---

## 6. 과적합 방지 전략

| 방법 | 적용 |
|------|------|
| `max_depth` 제한 | 트리 깊이 10으로 제한 |
| `min_samples_leaf` | 잎 노드 최소 5개 샘플 |
| 교차 검증 | `TimeSeriesSplit(n_splits=5)` |
| 테스트셋 분리 | 학습에 절대 미사용 |

---

## 7. 모델 저장 및 로드

```python
import joblib

# 저장 (종목코드별 디렉토리)
joblib.dump(rf_model,  "models/005930/rf_model.pkl")
joblib.dump(xgb_model, "models/005930/xgb_model.pkl")
joblib.dump(scaler,    "models/005930/scaler.pkl")
joblib.dump(feature_names, "models/005930/features.pkl")

# 로드 (예측 시)
rf_model = joblib.load("models/005930/rf_model.pkl")
scaler   = joblib.load("models/005930/scaler.pkl")
```

---

## 8. 예측 결과 출력 형태

```
============================
삼성전자 내일 주가 예측
============================
기준일   : 2026-06-26 (오늘)
예측일   : 2026-06-27 (내일)

📈 예측: 상승
🎯 신뢰도: 68.3%

[오늘 주요 지표]
  종가    : 74,200원
  RSI(14) : 58.2 (중립)
  MACD    : +142 (상승 추세)
  KOSPI   : +0.83%

[모델 정보]
  백테스트 정확도 : 57.4%
  학습 기간       : 2023-06 ~ 2026-01
============================
⚠️ 이 예측은 참고용입니다. 투자 손실 책임은 본인에게 있습니다.
```
