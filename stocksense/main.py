"""StockSense FastAPI 앱 진입점"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

from routers import dashboard, predict_api, report_api, history_api

_scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    from scheduler.jobs import setup_scheduler
    _scheduler = setup_scheduler()
    yield
    if _scheduler:
        _scheduler.shutdown()


app = FastAPI(
    title="StockSense",
    description="AI 기반 한국 주식 예측 시스템",
    version="1.0.0",
    lifespan=lifespan,
)

static_dir = Path(__file__).parent / "static"
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(dashboard.router)
app.include_router(predict_api.router)
app.include_router(report_api.router)
app.include_router(history_api.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
