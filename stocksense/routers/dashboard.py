from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path

router = APIRouter(tags=["dashboard"])
templates = Jinja2Templates(directory=str(Path(__file__).parent.parent / "templates"))


@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    import yaml
    cfg_path = Path(__file__).parent.parent / "config" / "config.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    tickers = cfg.get("tickers", [])
    return templates.TemplateResponse("dashboard.html",
                                      {"request": request, "tickers": tickers})
