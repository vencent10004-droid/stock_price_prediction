"""전문 애널리스트 스타일 PDF 리포트 생성 (키움증권 형식 참고)"""

import io
import os
import logging
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import matplotlib.gridspec as gridspec
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

REPORT_DIR = Path(__file__).parent.parent / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

# ── 색상 팔레트 ──────────────────────────────────────────────────
BLUE_DARK   = "#003087"
BLUE_MID    = "#1E40AF"
BLUE_LIGHT  = "#DBEAFE"
RED         = "#DC2626"
GREEN       = "#16A34A"
GRAY_DARK   = "#1F2937"
GRAY_MID    = "#6B7280"
GRAY_LIGHT  = "#F3F4F6"
WHITE       = "#FFFFFF"


# 저장소에 동봉한 한글 폰트(OS 무관, 배포 서버에서도 한글 렌더 보장)
# 가변폰트 기본 두께가 얇아 흐리므로, 두께 고정(Regular/Bold) 정적 폰트를 사용
_FONT_DIR = Path(__file__).parent.parent / "assets" / "fonts"
BUNDLED_FONT = str(_FONT_DIR / "NotoSansKR-Regular.ttf")
BUNDLED_FONT_BOLD = str(_FONT_DIR / "NotoSansKR-Bold.ttf")


def _set_font():
    if os.path.exists(BUNDLED_FONT):                 # 동봉 정적 폰트 우선
        fm.fontManager.addfont(BUNDLED_FONT)
        if os.path.exists(BUNDLED_FONT_BOLD):
            fm.fontManager.addfont(BUNDLED_FONT_BOLD)
        name = fm.FontProperties(fname=BUNDLED_FONT).get_name()
        plt.rcParams["font.family"] = name
        plt.rcParams["axes.unicode_minus"] = False
        return name
    candidates = [
        "C:/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/NanumGothic.ttf",
        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            fm.fontManager.addfont(p)
            name = fm.FontProperties(fname=p).get_name()
            plt.rcParams["font.family"] = name
            plt.rcParams["axes.unicode_minus"] = False
            return name
    plt.rcParams["font.family"] = "DejaVu Sans"
    return "DejaVu Sans"


def _register_pdf_font():
    """reportlab 한글 폰트 등록 → (font_name, bold_name)"""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    # 동봉 정적 폰트 우선 (Regular + Bold 분리 등록 → 또렷한 두께)
    if os.path.exists(BUNDLED_FONT):
        try:
            pdfmetrics.registerFont(TTFont("KR", BUNDLED_FONT))
            bold = BUNDLED_FONT_BOLD if os.path.exists(BUNDLED_FONT_BOLD) else BUNDLED_FONT
            pdfmetrics.registerFont(TTFont("KR-Bold", bold))
            return "KR", "KR-Bold"
        except Exception:
            pass
    for path in ["C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/malgunbd.ttf",
                 "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"]:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("KR", path))
                bold_path = path.replace("malgun.ttf", "malgunbd.ttf")
                if os.path.exists(bold_path):
                    pdfmetrics.registerFont(TTFont("KR-Bold", bold_path))
                    return "KR", "KR-Bold"
                return "KR", "KR"
            except Exception:
                pass
    return "Helvetica", "Helvetica-Bold"


# ── 차트 생성 함수들 ─────────────────────────────────────────────

def _make_price_chart(df: pd.DataFrame, ticker_name: str, prediction: dict) -> bytes:
    """주가 + 볼린저밴드 + 거래량 통합 차트"""
    _set_font()
    recent = df.tail(90)
    fig = plt.figure(figsize=(11, 5.5), facecolor=WHITE)
    gs = gridspec.GridSpec(3, 1, height_ratios=[3, 1, 1], hspace=0.08)

    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax3 = fig.add_subplot(gs[2], sharex=ax1)

    # ── 주가 ──
    ax1.plot(recent.index, recent["close"], color=BLUE_DARK, lw=1.8, zorder=3, label="종가")
    if "bb_upper" in recent.columns:
        ax1.fill_between(recent.index, recent["bb_lower"], recent["bb_upper"],
                         alpha=0.12, color=BLUE_MID, label="볼린저밴드")
        ax1.plot(recent.index, recent["bb_upper"], "--", color=BLUE_MID, lw=0.7, alpha=0.6)
        ax1.plot(recent.index, recent["bb_lower"], "--", color=BLUE_MID, lw=0.7, alpha=0.6)
    if "ma20" in recent.columns:
        ax1.plot(recent.index, recent["ma20"], color="#F59E0B", lw=1.2, label="MA20")
    if "ma60" in recent.columns:
        ax1.plot(recent.index, recent["ma60"], color="#EF4444", lw=1.2, label="MA60")

    direction = prediction.get("direction", "")
    prob = prediction.get("probability", 0) * 100
    color = RED if direction == "상승" else "#2563EB"
    ax1.set_title(f"{ticker_name}  |  내일 예측: {direction} ({prob:.1f}%)",
                  fontsize=12, fontweight="bold", color=GRAY_DARK, pad=8)
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{int(x):,}"))
    ax1.legend(fontsize=7.5, loc="upper left", framealpha=0.9)
    ax1.set_facecolor(GRAY_LIGHT)
    ax1.grid(True, alpha=0.3, lw=0.5)
    ax1.tick_params(labelbottom=False)

    # ── RSI ──
    if "rsi_14" in recent.columns:
        ax2.plot(recent.index, recent["rsi_14"], color="#7C3AED", lw=1.2)
        ax2.axhline(70, color=RED, lw=0.8, ls="--", alpha=0.7)
        ax2.axhline(30, color=GREEN, lw=0.8, ls="--", alpha=0.7)
        ax2.fill_between(recent.index, 30, recent["rsi_14"],
                         where=recent["rsi_14"] < 30, alpha=0.2, color=GREEN)
        ax2.fill_between(recent.index, 70, recent["rsi_14"],
                         where=recent["rsi_14"] > 70, alpha=0.2, color=RED)
        ax2.set_ylim(0, 100)
        ax2.set_ylabel("RSI", fontsize=8)
        ax2.set_facecolor(GRAY_LIGHT)
        ax2.grid(True, alpha=0.3, lw=0.5)
        ax2.tick_params(labelbottom=False)

    # ── 거래량 ──
    colors = [RED if r > 0 else "#3B82F6"
              for r in recent["close"].pct_change().fillna(0)]
    ax3.bar(recent.index, recent["volume"] / 1e6, color=colors, width=0.6, alpha=0.8)
    ax3.set_ylabel("거래량\n(백만)", fontsize=7)
    ax3.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:.0f}M"))
    ax3.set_facecolor(GRAY_LIGHT)
    ax3.grid(True, alpha=0.3, lw=0.5)
    ax3.tick_params(axis="x", rotation=20, labelsize=7)

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def _make_indicator_chart(df: pd.DataFrame) -> bytes:
    """MACD + 수익률 차트"""
    _set_font()
    recent = df.tail(60)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 3.5), facecolor=WHITE)

    # MACD
    if "macd_hist" in recent.columns:
        colors = [RED if v >= 0 else "#3B82F6" for v in recent["macd_hist"]]
        ax1.bar(recent.index, recent["macd_hist"], color=colors, width=0.6, alpha=0.85)
        ax1.axhline(0, color=GRAY_MID, lw=0.8)
        ax1.set_ylabel("MACD Hist", fontsize=8)
        ax1.set_facecolor(GRAY_LIGHT)
        ax1.grid(True, alpha=0.3, lw=0.5)
        ax1.tick_params(labelbottom=False)

    # 수익률
    ret = recent["close"].pct_change().fillna(0) * 100
    colors2 = [RED if v >= 0 else "#3B82F6" for v in ret]
    ax2.bar(recent.index, ret, color=colors2, width=0.6, alpha=0.85)
    ax2.axhline(0, color=GRAY_MID, lw=0.8)
    ax2.set_ylabel("일간 수익률(%)", fontsize=8)
    ax2.set_facecolor(GRAY_LIGHT)
    ax2.grid(True, alpha=0.3, lw=0.5)
    ax2.tick_params(axis="x", rotation=20, labelsize=7)

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def _make_backtest_chart(backtest_records: list) -> bytes:
    """백테스트 누적 정확도 추이"""
    _set_font()
    if len(backtest_records) < 5:
        return b""
    dates = [r["date"] for r in backtest_records]
    correct = [1 if r["correct"] else 0 for r in backtest_records]
    cumacc = [sum(correct[:i+1]) / (i+1) * 100 for i in range(len(correct))]

    fig, ax = plt.subplots(figsize=(11, 2.8), facecolor=WHITE)
    ax.plot(range(len(cumacc)), cumacc, color=BLUE_DARK, lw=1.8)
    ax.axhline(50, color=GRAY_MID, ls="--", lw=1, label="랜덤(50%)")
    ax.fill_between(range(len(cumacc)), 50, cumacc,
                    where=[v >= 50 for v in cumacc], alpha=0.15, color=GREEN)
    ax.fill_between(range(len(cumacc)), 50, cumacc,
                    where=[v < 50 for v in cumacc], alpha=0.15, color=RED)
    ax.set_ylim(30, 80)
    ax.set_ylabel("누적 정확도(%)", fontsize=8)
    ax.set_title("백테스트 누적 예측 정확도", fontsize=9, color=GRAY_DARK)
    ax.legend(fontsize=8)
    ax.set_facecolor(GRAY_LIGHT)
    ax.grid(True, alpha=0.3, lw=0.5)
    ax.tick_params(axis="x", labelsize=7)

    step = max(1, len(dates) // 8)
    ax.set_xticks(range(0, len(dates), step))
    ax.set_xticklabels([dates[i] for i in range(0, len(dates), step)], rotation=20)

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


# ── PDF 생성 메인 ─────────────────────────────────────────────────

def generate_pdf(
    ticker_code: str,
    ticker_name: str,
    prediction: dict,
    price_range: dict,
    sentiment: dict,
    analyst_comment: str,
    df: pd.DataFrame,
    backtest_records: list = None,
) -> str:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm, mm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table,
            TableStyle, Image, HRFlowable, KeepTogether
        )
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    except ImportError:
        logger.error("reportlab 미설치")
        return ""

    font_name, font_bold = _register_pdf_font()
    today_str = datetime.now().strftime("%Y. %m. %d")
    today_file = datetime.now().strftime("%Y%m%d")
    filename = REPORT_DIR / f"{ticker_code}_{today_file}.pdf"

    W, H = A4
    doc = SimpleDocTemplate(
        str(filename), pagesize=A4,
        leftMargin=1.5*cm, rightMargin=1.5*cm,
        topMargin=1.8*cm, bottomMargin=1.5*cm
    )

    # ── 스타일 ──
    def sty(name, parent="Normal", **kw):
        base = getSampleStyleSheet()[parent]
        kw.setdefault("fontName", font_name)
        return ParagraphStyle(name, parent=base, **kw)

    S = {
        "h1":    sty("h1", "Normal", fontSize=16, fontName=font_bold, textColor=colors.HexColor(BLUE_DARK), leading=20),
        "h2":    sty("h2", "Normal", fontSize=11, fontName=font_bold, textColor=colors.HexColor(BLUE_DARK), spaceBefore=8, spaceAfter=4),
        "h3":    sty("h3", "Normal", fontSize=9.5, fontName=font_bold, textColor=colors.HexColor(GRAY_DARK), spaceBefore=4),
        "body":  sty("body", "Normal", fontSize=8.5, leading=13, textColor=colors.HexColor(GRAY_DARK)),
        "small": sty("small", "Normal", fontSize=7, textColor=colors.HexColor(GRAY_MID)),
        "right": sty("right", "Normal", fontSize=8, alignment=TA_RIGHT, textColor=colors.HexColor(GRAY_MID)),
        "center":sty("center", "Normal", fontSize=8.5, alignment=TA_CENTER),
        "tag":   sty("tag", "Normal", fontSize=7.5, alignment=TA_CENTER, textColor=colors.white),
    }

    story = []

    direction  = prediction.get("direction", "N/A")
    prob       = prediction.get("probability", 0)
    opinion    = prediction.get("investment_opinion", "중립")
    close_price= int(df["close"].iloc[-1]) if len(df) > 0 else 0
    bull       = price_range.get("bull", {})
    bear       = price_range.get("bear", {})
    pivot      = price_range.get("pivot", 0)
    atr        = price_range.get("atr", 0)
    sent_score = sentiment.get("score", 0)

    op_colors = {
        "강력매수": "#7F1D1D", "매수": "#92400E",
        "중립": "#374151",   "매도": "#1E3A5F"
    }
    op_bg = op_colors.get(opinion, "#374151")

    # ══════════════════════════════════════════════
    # PAGE 1: 커버 + 요약
    # ══════════════════════════════════════════════

    # ── 헤더 배너 ──
    header_data = [[
        Paragraph(f"<b>{ticker_name}</b>", sty("hd", "Normal", fontSize=18, fontName=font_bold, textColor=colors.white)),
        Paragraph(f"({ticker_code})", sty("hd2", "Normal", fontSize=10, textColor=colors.HexColor("#93C5FD"))),
        Paragraph(f"AI 리서치 리포트  {today_str}", sty("hd3", "Normal", fontSize=8.5, textColor=colors.HexColor("#BFDBFE"), alignment=TA_RIGHT)),
    ]]
    ht = Table(header_data, colWidths=[8*cm, 4*cm, 6.2*cm])
    ht.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(BLUE_DARK)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 12),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    story.append(ht)
    story.append(Spacer(1, 0.35*cm))

    # ── 투자의견 + 목표주가 배너 ──
    target_price = bull.get("high", close_price)
    upside = (target_price / close_price - 1) * 100 if close_price else 0

    rating_data = [[
        Paragraph(f"<b>{opinion}</b>", sty("rat", "Normal", fontSize=13, fontName=font_bold,
                                           textColor=colors.white, alignment=TA_CENTER)),
        Paragraph("투자의견", sty("rat2", "Normal", fontSize=7, textColor=colors.HexColor("#CBD5E1"), alignment=TA_CENTER)),
        Paragraph(f"<b>{target_price:,}원</b>",
                  sty("tp", "Normal", fontSize=13, fontName=font_bold, textColor=colors.white, alignment=TA_CENTER)),
        Paragraph("목표주가(상승 목표)", sty("tp2", "Normal", fontSize=7, textColor=colors.HexColor("#CBD5E1"), alignment=TA_CENTER)),
        Paragraph(f"<b>{close_price:,}원</b>",
                  sty("cp", "Normal", fontSize=13, fontName=font_bold, textColor=colors.white, alignment=TA_CENTER)),
        Paragraph(f"현재가  ({datetime.now().strftime('%m/%d')})",
                  sty("cp2", "Normal", fontSize=7, textColor=colors.HexColor("#CBD5E1"), alignment=TA_CENTER)),
        Paragraph(f"<b>{upside:+.1f}%</b>",
                  sty("up", "Normal", fontSize=13, fontName=font_bold,
                      textColor=colors.HexColor("#86EFAC") if upside >= 0 else colors.HexColor("#FCA5A5"),
                      alignment=TA_CENTER)),
        Paragraph("상승 여력", sty("up2", "Normal", fontSize=7, textColor=colors.HexColor("#CBD5E1"), alignment=TA_CENTER)),
    ]]
    rt = Table([rating_data[0][::2], rating_data[0][1::2]],
               colWidths=[3.5*cm, 3.5*cm, 3.5*cm, 3.7*cm])
    rt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(op_bg)),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEAFTER", (0, 0), (2, -1), 0.5, colors.HexColor("#475569")),
    ]))
    story.append(rt)
    story.append(Spacer(1, 0.3*cm))

    # ── 핵심 지표 + 예측 확률 ──
    rsi = round(float(df.iloc[-1].get("rsi_14", 50)), 1) if len(df) > 0 else 50
    vol_ratio = round(float(df.iloc[-1].get("volume_ratio", 1.0)), 2) if len(df) > 0 else 1.0
    macd_h = round(float(df.iloc[-1].get("macd_hist", 0)), 2) if len(df) > 0 else 0

    def _metric_cell(label, val, color_val=None):
        c = colors.HexColor(RED) if (color_val or 0) > 0 else colors.HexColor("#2563EB")
        return [
            Paragraph(label, sty("ml", "Normal", fontSize=7, textColor=colors.HexColor(GRAY_MID), alignment=TA_CENTER)),
            Paragraph(f"<b>{val}</b>", sty("mv", "Normal", fontSize=10.5, fontName=font_bold,
                                           textColor=c if color_val is not None else colors.HexColor(GRAY_DARK),
                                           alignment=TA_CENTER)),
        ]

    dir_color = RED if direction == "상승" else "#2563EB"
    metrics = [
        ["예측 방향", "신뢰도", "RSI(14)", "MACD", "거래량비율", "감성점수"],
        [
            Paragraph(f"<b>{direction}</b>", sty("dir", "Normal", fontSize=11, fontName=font_bold,
                                                  textColor=colors.HexColor(dir_color), alignment=TA_CENTER)),
            Paragraph(f"<b>{prob*100:.1f}%</b>", sty("pr", "Normal", fontSize=11, fontName=font_bold,
                                                       textColor=colors.HexColor(BLUE_DARK), alignment=TA_CENTER)),
            Paragraph(f"<b>{rsi}</b>", sty("r2", "Normal", fontSize=11, fontName=font_bold,
                                            textColor=colors.HexColor(RED if rsi > 70 else GREEN if rsi < 30 else GRAY_DARK),
                                            alignment=TA_CENTER)),
            Paragraph(f"<b>{macd_h:+.2f}</b>", sty("m2", "Normal", fontSize=11, fontName=font_bold,
                                                      textColor=colors.HexColor(RED if macd_h > 0 else "#2563EB"),
                                                      alignment=TA_CENTER)),
            Paragraph(f"<b>{vol_ratio:.2f}x</b>", sty("v2", "Normal", fontSize=11, fontName=font_bold,
                                                         textColor=colors.HexColor(GRAY_DARK), alignment=TA_CENTER)),
            Paragraph(f"<b>{sent_score:+.2f}</b>", sty("s2", "Normal", fontSize=11, fontName=font_bold,
                                                          textColor=colors.HexColor(RED if sent_score > 0 else "#2563EB"),
                                                          alignment=TA_CENTER)),
        ]
    ]
    mt = Table(metrics, colWidths=[3.0*cm]*6)
    mt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BLUE_MID)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), font_name),
        ("FONTSIZE", (0, 0), (-1, 0), 7.5),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor(BLUE_LIGHT)),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(mt)
    story.append(Spacer(1, 0.4*cm))

    # ── 2단 레이아웃: 요약문 + 뉴스감성 ──
    summary_para = Paragraph(analyst_comment.replace("\n", "<br/>"), S["body"])

    sent_label = "긍정" if sent_score > 0.1 else "부정" if sent_score < -0.1 else "중립"
    sent_bar_color = GREEN if sent_score > 0.1 else RED if sent_score < -0.1 else "#94A3B8"
    pos = sentiment.get("positive", 0)
    neu = sentiment.get("neutral", 0)
    neg = sentiment.get("negative", 0)
    sent_summary = sentiment.get("summary", "")
    news_count = sentiment.get("news_count", 0)

    sent_data = [
        [Paragraph("<b>뉴스 감성 분석</b>", sty("sh", "Normal", fontSize=8.5, fontName=font_bold,
                                                  textColor=colors.HexColor(BLUE_DARK)))],
        [Paragraph(f"종합 감성: <b>{sent_score:+.2f}</b> ({sent_label})", S["body"])],
        [Paragraph(f"분석 뉴스: {news_count}건 | 긍정 {pos} / 중립 {neu} / 부정 {neg}", S["small"])],
        [Paragraph(sent_summary or "-", sty("ss2", "Normal", fontSize=8, textColor=colors.HexColor(GRAY_MID), leading=11))],
    ]
    sent_t = Table(sent_data, colWidths=[6.5*cm])
    sent_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BLUE_LIGHT)),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F8FAFC")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#BFDBFE")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ]))

    two_col = Table([[summary_para, sent_t]], colWidths=[11.0*cm, 6.8*cm])
    two_col.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 8),
        ("LEFTPADDING", (1, 0), (1, 0), 0),
    ]))
    story.append(two_col)
    story.append(Spacer(1, 0.4*cm))

    # ── 가격대 예측 테이블 ──
    story.append(Paragraph("가격대 예측 (다음 거래일 기준)", S["h2"]))
    pr_data = [
        ["시나리오", "예상 하단", "예상 상단", "1차 레벨", "2차 레벨", "피봇 포인트"],
        ["▲ 상승 시나리오",
         f"{bull.get('low', 0):,}원",
         f"{bull.get('high', 0):,}원",
         f"저항1: {bull.get('resistance1', 0):,}",
         f"저항2: {bull.get('resistance2', 0):,}",
         f"{pivot:,}원"],
        ["▼ 하락 시나리오",
         f"{bear.get('low', 0):,}원",
         f"{bear.get('high', 0):,}원",
         f"지지1: {bear.get('support1', 0):,}",
         f"지지2: {bear.get('support2', 0):,}",
         f"ATR: {int(atr):,}"],
    ]
    prt = Table(pr_data, colWidths=[3.5*cm, 2.5*cm, 2.5*cm, 3.5*cm, 3.5*cm, 2.7*cm])
    prt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BLUE_MID)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, 1), (-1, -1), font_name),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#FEF2F2")),
        ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#EFF6FF")),
        ("TEXTCOLOR", (0, 1), (0, 1), colors.HexColor(RED)),
        ("TEXTCOLOR", (0, 2), (0, 2), colors.HexColor("#2563EB")),
        ("FONTNAME", (0, 1), (0, 2), font_bold),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (0, -1), 8),
    ]))
    story.append(prt)
    story.append(Spacer(1, 0.5*cm))

    # ── 주가 차트 ──
    story.append(Paragraph("주가 차트 (최근 90일)", S["h2"]))
    try:
        price_png = _make_price_chart(df, ticker_name, prediction)
        story.append(Image(io.BytesIO(price_png), width=18*cm, height=9*cm))
    except Exception as e:
        logger.warning(f"주가 차트 오류: {e}")
    story.append(Spacer(1, 0.4*cm))

    # ── MACD + 수익률 차트 ──
    story.append(Paragraph("기술적 지표 (MACD / 일간 수익률)", S["h2"]))
    try:
        ind_png = _make_indicator_chart(df)
        story.append(Image(io.BytesIO(ind_png), width=18*cm, height=5.5*cm))
    except Exception as e:
        logger.warning(f"지표 차트 오류: {e}")
    story.append(Spacer(1, 0.4*cm))

    # ── 최근 30일 수익률 테이블 ──
    story.append(Paragraph("최근 주가 데이터 (최근 10거래일)", S["h2"]))
    recent10 = df.tail(10).copy()
    ret_col = recent10["close"].pct_change().fillna(0) * 100

    price_rows = [["날짜", "시가", "고가", "저가", "종가", "등락률", "거래량"]]
    for idx, row in recent10.iterrows():
        ret_val = float(ret_col.loc[idx])
        sign = "▲" if ret_val > 0 else "▼" if ret_val < 0 else "-"
        price_rows.append([
            str(idx.date()),
            f"{int(row.get('open', 0)):,}",
            f"{int(row.get('high', 0)):,}",
            f"{int(row.get('low', 0)):,}",
            f"{int(row.get('close', 0)):,}",
            f"{sign} {abs(ret_val):.2f}%",
            f"{int(row.get('volume', 0) / 1e4):.0f}만",
        ])
    pricet = Table(price_rows, colWidths=[3.0*cm, 2.3*cm, 2.3*cm, 2.3*cm, 2.3*cm, 2.5*cm, 2.5*cm])
    style_rows = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BLUE_MID)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("FONTNAME", (0, 1), (-1, -1), font_name),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D1D5DB")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i, row in enumerate(price_rows[1:], 1):
        ret_str = row[5]
        if "▲" in ret_str:
            style_rows.append(("TEXTCOLOR", (5, i), (5, i), colors.HexColor(RED)))
            style_rows.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#FFF5F5")))
        elif "▼" in ret_str:
            style_rows.append(("TEXTCOLOR", (5, i), (5, i), colors.HexColor("#2563EB")))
            style_rows.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#EFF6FF")))
    pricet.setStyle(TableStyle(style_rows))
    story.append(pricet)
    story.append(Spacer(1, 0.5*cm))

    # ── 백테스트 결과 ──
    if backtest_records:
        story.append(Paragraph("AI 모델 백테스트 검증", S["h2"]))
        correct = sum(1 for r in backtest_records if r["correct"])
        total = len(backtest_records)
        acc = correct / total * 100 if total else 0

        bt_summary = [
            ["총 검증 기간", "예측 정확도", "상승 예측 적중", "하락 예측 적중"],
            [
                f"{total}거래일",
                f"{acc:.1f}%",
                f"{sum(1 for r in backtest_records if r['correct'] and r['actual']=='상승')}건",
                f"{sum(1 for r in backtest_records if r['correct'] and r['actual']=='하락')}건",
            ]
        ]
        bts = Table(bt_summary, colWidths=[4.5*cm]*4)
        bts.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BLUE_MID)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), font_bold),
            ("FONTNAME", (0, 1), (-1, 1), font_name),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor(BLUE_LIGHT)),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(bts)
        story.append(Spacer(1, 0.3*cm))

        try:
            bt_png = _make_backtest_chart(backtest_records)
            if bt_png:
                story.append(Image(io.BytesIO(bt_png), width=18*cm, height=4.5*cm))
        except Exception as e:
            logger.warning(f"백테스트 차트 오류: {e}")

        # 최근 20건 테이블
        story.append(Spacer(1, 0.3*cm))
        story.append(Paragraph("최근 예측 기록 (최근 20거래일)", S["h3"]))
        recent_bt = backtest_records[-20:]
        bt_rows = [["날짜", "예측", "실제", "신뢰도", "정오"]]
        for r in reversed(recent_bt):
            bt_rows.append([
                r["date"],
                r["predicted"],
                r["actual"],
                f"{r['prob']*100:.1f}%",
                "✓ 정답" if r["correct"] else "✗ 오답",
            ])
        btt = Table(bt_rows, colWidths=[3.5*cm, 2.5*cm, 2.5*cm, 2.5*cm, 2.5*cm])
        bt_style = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BLUE_MID)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), font_bold),
            ("FONTNAME", (0, 1), (-1, -1), font_name),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("ALIGN", (1, 0), (-1, -1), "CENTER"),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D1D5DB")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        for i, r in enumerate(recent_bt, 1):
            if r["correct"]:
                bt_style.append(("TEXTCOLOR", (4, i), (4, i), colors.HexColor(GREEN)))
                bt_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F0FDF4")))
            else:
                bt_style.append(("TEXTCOLOR", (4, i), (4, i), colors.HexColor(RED)))
                bt_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#FFF5F5")))
        btt.setStyle(TableStyle(bt_style))
        story.append(btt)

    story.append(Spacer(1, 0.8*cm))

    # ── 면책 조항 ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#D1D5DB")))
    story.append(Spacer(1, 0.2*cm))
    disclaimer = (
        "【면책조항】 본 리포트는 머신러닝 AI 모델이 자동 생성한 참고 자료이며, "
        "투자 권유를 목적으로 하지 않습니다. 예측 결과는 과거 데이터 기반이며 "
        "미래 수익을 보장하지 않습니다. 투자 판단 및 손실에 대한 책임은 전적으로 투자자 본인에게 있으며, "
        "본 리포트를 근거로 한 투자 결과에 대해 어떠한 법적 책임도 지지 않습니다. "
        f"생성일시: {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  StockSense AI Research"
    )
    story.append(Paragraph(disclaimer, S["small"]))

    doc.build(story)
    logger.info(f"PDF 저장: {filename}")
    return str(filename)
