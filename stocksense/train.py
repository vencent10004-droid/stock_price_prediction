"""수동 학습 CLI: python train.py [ticker_code]"""

import sys
import logging
import yaml
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

from services.data_collector import fetch_stock_data, fetch_market_data
from services.krx_collector import fetch_investor_data
from services.feature_engine import build_features
from services.model_trainer import train

cfg_path = Path(__file__).parent / "config" / "config.yaml"
with open(cfg_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f)

tickers = cfg.get("tickers", [])
model_cfg = cfg.get("model", {})

# 특정 종목만 or 전체
target_codes = sys.argv[1:] if len(sys.argv) > 1 else [t["code"] for t in tickers]
market_data = fetch_market_data(years=5)

for t in tickers:
    if t["code"] not in target_codes:
        continue
    code = t["code"]
    name = t["name"]
    print(f"\n{'='*50}")
    print(f"학습 시작: {name} ({code})")
    print("="*50)
    stock_df = fetch_stock_data(code, years=5)
    investor_df = fetch_investor_data(code, days=750)
    df = build_features(stock_df, market_data, investor_df, ticker_code=code)
    result = train(code, df, model_cfg)
    print(f"정확도: {result['accuracy']*100:.2f}%")
    print(f"학습 샘플: {result['n_train']} | 테스트 샘플: {result['n_test']}")
    print(result["report"])

print("\n모든 학습 완료!")
