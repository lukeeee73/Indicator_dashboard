#!/usr/bin/env python3
"""
FRED API에서 주요 경제 지표를 가져와 data/indicators.json에 저장하는 스크립트.

사용법:
    export FRED_API_KEY="your_api_key"
    python scripts/fetch_fred.py

원칙:
    - 한 지표가 실패해도 다른 지표는 계속 수집한다 (안전 모드)
    - 모든 지표가 실패하면 기존 JSON을 덮어쓰지 않는다
    - 날짜는 모두 UTC 기준, ISO 8601 포맷
    - 수집 이후 analyze 모듈이 각 지표에 "현재 위치(percentile/label)" 와
      성장/인플레 종합 점수(assessment 블록) 를 주입한다.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from analyze import enrich_with_assessment
from valuation import enrich_stocks_with_valuation
from merge_qualitative import merge_into_stocks as merge_qualitative_into_stocks
from competitors import get_watchlist_competitors


# --------------------------------------------------------------------------
# 수집할 FRED 지표 정의
# --------------------------------------------------------------------------
# 새 지표를 추가하려면 아래 딕셔너리에 한 줄 추가하면 된다.
#   - name:      대시보드에 표시할 영문 이름
#   - category:  "growth" (성장 분면) | "inflation" (인플레 분면)
#   - unit:      단위 표기. 프론트엔드가 툴팁에 붙일 때 사용
#   - transform: None        → 원시값 그대로
#                "yoy_pct"   → 월간 시계열의 전년 동월 대비 상승률(%) 로 변환
#                "yoy_pct_daily" → 일간 시계열을 월말 last 로 리샘플 후 YoY(%)
INDICATORS: dict[str, dict] = {
    "T10Y2Y": {
        "name": "10Y-2Y Treasury Spread",
        "category": "growth",
        "unit": "percent",
        "transform": None,
    },
    "T10YIE": {
        "name": "10-Year Breakeven Inflation Rate",
        "category": "inflation",
        "unit": "percent",
        "transform": None,
    },
    "CPIAUCSL": {
        # 원시 CPI 지수값은 절대치라 의미가 약하므로 전년 동월 대비 % 로 변환
        "name": "CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "CPILFESL": {
        # Core CPI (식품·에너지 제외). "끈적한(sticky) 인플레" 의 척도.
        "name": "Core CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "PCEPI": {
        # PCE 물가지수. Fed 가 통화정책 기준으로 보는 지표.
        "name": "PCE YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "INDPRO": {
        # 원시 지수값 대신 YoY 변화율을 본다 — 레짐 비교가 가능해짐.
        "name": "Industrial Production YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "PAYEMS": {
        # 비농업 고용. 성장의 현재 상태.
        "name": "Nonfarm Payrolls YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "USSLIND": {
        # Philly Fed State Leading Index — 향후 6개월 성장률 전망 (level).
        "name": "State Leading Index",
        "category": "growth",
        "unit": "percent",
        "transform": None,
    },
    "DCOILWTICO": {
        # 일간 가격을 월말 last 로 리샘플 후 YoY — 공급측 인플레 압력으로 사용.
        "name": "WTI Crude Oil YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct_daily",
    },

    # ── 인플레 선행 지표 ─────────────────────────────────────────────────
    "T5YIFR": {
        # 5년 후 시작하는 5년간의 기대인플레이션(시장가격 기반, 실시간).
        # T10YIE 가 단기 앵커라면 이건 장기 구조적 인플레 판단 — 둘을 비교하면
        # "일시적 충격 vs 고착화" 를 구분할 수 있다.
        "name": "5Y5Y Forward Inflation Expectation",
        "category": "inflation",
        "unit": "percent",
        "transform": None,
    },
    "PCUOMFGOMFG": {
        # 생산자물가(제조업 전체). 원가 압력이 소비자 가격으로 전가되기 2~3개월 전에 움직임.
        "name": "PPI Manufacturing YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "WPSID61": {
        # WTI 는 에너지만 커버하지만 이 지표는 금속·농업 등 광범위한 원자재를 포함.
        "name": "PPI Raw Materials YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },

    # ── 성장 선행 지표 ──────────────────────────────────────────────────
    "ICSA": {
        # 신규 실업수당 청구건수(주간). 노동시장 스트레스의 가장 빠른 신호.
        # PAYEMS 보다 5~6주 먼저 움직이며, 경기 충격 첫 주에 즉시 급등한다.
        # 일간과 동일하게 월말 last 로 리샘플 후 YoY 변환.
        # 높을수록 성장 악화이므로 analyze.py INVERTED_CODES 에 등록됨.
        "name": "Initial Jobless Claims YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct_daily",
    },
    "UMCSENT": {
        # 미시간대 소비자심리지수(레벨). GDP 의 70% 를 차지하는 소비 의도의 선행 신호.
        # 원시 레벨(50~110)을 그대로 사용 — 높을수록 성장 긍정, 역방향 불필요.
        "name": "Michigan Consumer Sentiment",
        "category": "growth",
        "unit": "index",
        "transform": None,
    },

    # ── 달러 가치 분석 지표 (미국) ──────────────────────────────────────
    # 금리·통화량·재정 건전성을 통해 달러의 상대 가치를 판단하는 데 쓰인다.
    # exclude_assessment=True: 4분면 성장/인플레 점수에는 포함하지 않는다.
    "DGS10": {
        "name": "US 10-Year Treasury Yield",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "exclude_assessment": True,
    },
    "M2SL": {
        "name": "US M2 Money Supply YoY",
        "category": "dollar",
        "unit": "percent",
        "transform": "yoy_pct",
        "exclude_assessment": True,
    },
    "GFDEGDQ188S": {
        # 분기 데이터, 이미 GDP 대비 % — transform 없이 원시값 사용
        "name": "US Federal Debt (% of GDP)",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "exclude_assessment": True,
    },

    # ── 달러 가치 분석 지표 (한국) ──────────────────────────────────────
    "IRLTLT01KRM156N": {
        "name": "Korea 10-Year Government Bond Yield",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "region": "KR",
        "exclude_assessment": True,
    },
    "MYAGM2KRM189S": {
        "name": "Korea M2 Money Supply YoY",
        "category": "dollar",
        "unit": "percent",
        "transform": "yoy_pct",
        "region": "KR",
        "exclude_assessment": True,
    },
    "DEBTTLKRQ052N": {
        # 분기 데이터, IMF/World Bank 경유 — GDP 대비 % 원시값 사용
        "name": "Korea General Government Debt (% of GDP)",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "region": "KR",
        "exclude_assessment": True,
    },

    # ── 한국 지표 (OECD / FRED) ──────────────────────────────────────────
    # exclude_assessment=True: 개별 카드 백분위는 계산하되,
    # 미국 4분면 종합 점수(assessment)에는 포함하지 않는다.
    "KORCPIALLMINMEI": {
        "name": "Korea CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
        "region": "KR",
        "exclude_assessment": True,
    },
    "KORPROINDMISMEI": {
        "name": "Korea Industrial Production YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
        "region": "KR",
        "exclude_assessment": True,
    },
    "LRUNTTTTKOR156S": {
        # 실업률은 역방향 폴라리티 — 높을수록 성장 악화. analyze.py INVERTED_CODES 에 등록됨.
        "name": "Korea Unemployment Rate",
        "category": "growth",
        "unit": "percent",
        "transform": None,
        "region": "KR",
        "exclude_assessment": True,
    },
}


# --------------------------------------------------------------------------
# 비교 자산(Assets) 정의
# --------------------------------------------------------------------------
# INDICATORS 가 "4분면 진단용 지표"라면 ASSETS 는 "지표 움직임을 검증할 가격 계열".
# 프론트엔드의 비교(compare) 기능에서 겹쳐보기/나란히보기의 오버레이 대상이 된다.
#
# 주의:
#   - SP500 / DJIA 같은 지수형 시리즈는 FRED 라이선스상 최근 10년만 받아진다.
#     따라서 자산마다 실제 보유 범위가 다르며, 프론트엔드는 가용 범위만 표시한다.
#   - 각 시계열은 일간(daily) 기준이지만 휴장/주말에는 결측이라 날짜가 안 맞을 수 있다.
#     프론트엔드에서 "가장 최근 과거값으로 align" 해서 겹쳐 그린다.
ASSETS: dict[str, dict] = {
    "GOLDAMGBD228NLBM": {
        "name": "Gold (London PM Fix)",
        "unit": "usd_per_oz",
        "transform": None,
    },
    "DTWEXBGS": {
        "name": "USD Trade-Weighted Broad Index",
        "unit": "index",
        "transform": None,
    },
    "SP500": {
        # FRED 라이선스로 최근 10년만. 전체 타임프레임 선택 시에도 10년치.
        "name": "S&P 500",
        "unit": "index",
        "transform": None,
    },
    "DGS10": {
        "name": "10-Year Treasury Yield",
        "unit": "percent",
        "transform": None,
    },
    "VIXCLS": {
        "name": "VIX Volatility Index",
        "unit": "index",
        "transform": None,
    },
    "DEXKOUS": {
        "name": "USD/KRW Exchange Rate",
        "unit": "krw_per_usd",
        "transform": None,
    },
    "BAMLH0A0HYM2": {
        "name": "US High-Yield Bond Spread",
        "unit": "percent",
        "transform": None,
    },
    "IRLTLT01KRM156N": {
        "name": "Korea 10-Year Government Bond Yield",
        "unit": "percent",
        "transform": None,
    },
}


# --------------------------------------------------------------------------
# 개별 종목 정의
# --------------------------------------------------------------------------
# Yahoo Finance 티커 기준.
#   - name:   카드에 표시할 영문 정식명
#   - sector: valuation.py 의 섹터 P/E 벤치마크 키 (영문, GICS 분류 기반)
#   - group:  대시보드 카드 묶음 헤더 (한국어). app.js STOCK_META 와 동일해야 함.
#
# 새 종목을 추가할 때:
#   1) 여기에 한 줄 추가
#   2) scripts/competitors.py 에 경쟁사 목록 한 줄 추가
#   3) app.js STOCK_META 에 displayName / business / group / color 등 한 줄 추가
#   4) Luke_wiki 의 wiki/news/{TICKER}.md 와 wiki/news/_dashboard.md 갱신
#
# 한국 상장 종목은 Yahoo Finance 의 ".KS" 접미사를 사용한다 (예: 329180.KS).
# 가격은 KRW 단위이므로 app.js STOCK_META 에서 currency: "KRW" 로 표시한다.
STOCKS: dict[str, dict] = {
    # ── 빅테크 / 소프트웨어 ─────────────────────────────────────
    "AAPL":   {"name": "Apple Inc.",                      "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    "MSFT":   {"name": "Microsoft Corporation",           "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    "GOOGL":  {"name": "Alphabet Inc.",                   "sector": "Communication Services", "group": "빅테크 / 소프트웨어"},
    "AMZN":   {"name": "Amazon.com Inc.",                 "sector": "Consumer Discretionary", "group": "빅테크 / 소프트웨어"},
    "META":   {"name": "Meta Platforms Inc.",             "sector": "Communication Services", "group": "빅테크 / 소프트웨어"},
    "ORCL":   {"name": "Oracle Corporation",              "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    "CRM":    {"name": "Salesforce, Inc.",                "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    "ADBE":   {"name": "Adobe Inc.",                      "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    "IBM":    {"name": "International Business Machines", "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    "PLTR":   {"name": "Palantir Technologies Inc.",      "sector": "Technology",             "group": "빅테크 / 소프트웨어"},
    # ── 반도체 ─────────────────────────────────────
    "NVDA":  {"name": "NVIDIA Corporation",        "sector": "Technology", "group": "반도체"},
    "AMD":   {"name": "Advanced Micro Devices",    "sector": "Technology", "group": "반도체"},
    "INTC":  {"name": "Intel Corporation",         "sector": "Technology", "group": "반도체"},
    "QCOM":  {"name": "QUALCOMM Incorporated",     "sector": "Technology", "group": "반도체"},
    "TSM":   {"name": "Taiwan Semiconductor Mfg.", "sector": "Technology", "group": "반도체"},
    "ASML":  {"name": "ASML Holding N.V.",         "sector": "Technology", "group": "반도체"},
    "AMAT":  {"name": "Applied Materials, Inc.",   "sector": "Technology", "group": "반도체"},
    "LRCX":  {"name": "Lam Research Corp.",        "sector": "Technology", "group": "반도체"},
    "AVGO":  {"name": "Broadcom Inc.",             "sector": "Technology", "group": "반도체"},
    "MU":    {"name": "Micron Technology, Inc.",   "sector": "Technology", "group": "반도체"},
    # ── 로보틱스 / 피지컬 AI ─────────────────────────────────────
    "TER":   {"name": "Teradyne, Inc.",     "sector": "Technology", "group": "로보틱스 / 피지컬 AI"},
    "HSAI":  {"name": "Hesai Group",        "sector": "Technology", "group": "로보틱스 / 피지컬 AI"},
    "MP":    {"name": "MP Materials Corp.", "sector": "Materials",  "group": "로보틱스 / 피지컬 AI"},
    # ── 자동차 / 모빌리티 ─────────────────────────────────────
    "TSLA":       {"name": "Tesla Inc.",               "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "TM":         {"name": "Toyota Motor Corporation", "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "F":          {"name": "Ford Motor Company",       "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "GM":         {"name": "General Motors Company",   "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "STLA":       {"name": "Stellantis N.V.",          "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "HMC":        {"name": "Honda Motor Co., Ltd.",    "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "RIVN":       {"name": "Rivian Automotive, Inc.",  "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "NIO":        {"name": "NIO Inc.",                 "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "005380.KS":  {"name": "Hyundai Motor Company",    "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    "000270.KS":  {"name": "Kia Corporation",          "sector": "Consumer Discretionary", "group": "자동차 / 모빌리티"},
    # ── 바이오 / 제약 / 헬스케어 ─────────────────────────────────────
    "LLY":   {"name": "Eli Lilly and Company",    "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "NVO":   {"name": "Novo Nordisk A/S",         "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "JNJ":   {"name": "Johnson & Johnson",        "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "PFE":   {"name": "Pfizer Inc.",              "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "MRK":   {"name": "Merck & Co., Inc.",        "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "ABBV":  {"name": "AbbVie Inc.",              "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "AZN":   {"name": "AstraZeneca PLC",          "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "UNH":   {"name": "UnitedHealth Group",       "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "TMO":   {"name": "Thermo Fisher Scientific", "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    "ABT":   {"name": "Abbott Laboratories",      "sector": "Healthcare", "group": "바이오 / 제약 / 헬스케어"},
    # ── 에너지 / 원자재 ─────────────────────────────────────
    "XOM":   {"name": "Exxon Mobil Corporation",  "sector": "Energy",    "group": "에너지 / 원자재"},
    "CVX":   {"name": "Chevron Corporation",      "sector": "Energy",    "group": "에너지 / 원자재"},
    "COP":   {"name": "ConocoPhillips",           "sector": "Energy",    "group": "에너지 / 원자재"},
    "SHEL":  {"name": "Shell plc",                "sector": "Energy",    "group": "에너지 / 원자재"},
    "OXY":   {"name": "Occidental Petroleum",     "sector": "Energy",    "group": "에너지 / 원자재"},
    "SLB":   {"name": "Schlumberger Limited",     "sector": "Energy",    "group": "에너지 / 원자재"},
    "FCX":   {"name": "Freeport-McMoRan Inc.",    "sector": "Materials", "group": "에너지 / 원자재"},
    "NEM":   {"name": "Newmont Corporation",      "sector": "Materials", "group": "에너지 / 원자재"},
    "LIN":   {"name": "Linde plc",                "sector": "Materials", "group": "에너지 / 원자재"},
    "APD":   {"name": "Air Products & Chemicals", "sector": "Materials", "group": "에너지 / 원자재"},
    # ── 금융 ─────────────────────────────────────
    "JPM":    {"name": "JPMorgan Chase & Co.",              "sector": "Financial Services", "group": "금융"},
    "BAC":    {"name": "Bank of America Corp.",             "sector": "Financial Services", "group": "금융"},
    "WFC":    {"name": "Wells Fargo & Company",             "sector": "Financial Services", "group": "금융"},
    "C":      {"name": "Citigroup Inc.",                    "sector": "Financial Services", "group": "금융"},
    "GS":     {"name": "The Goldman Sachs Group",           "sector": "Financial Services", "group": "금융"},
    "MS":     {"name": "Morgan Stanley",                    "sector": "Financial Services", "group": "금융"},
    "V":      {"name": "Visa Inc.",                         "sector": "Financial Services", "group": "금융"},
    "MA":     {"name": "Mastercard Incorporated",           "sector": "Financial Services", "group": "금융"},
    "AXP":    {"name": "American Express Company",          "sector": "Financial Services", "group": "금융"},
    "BRK-B":  {"name": "Berkshire Hathaway Inc. (Class B)", "sector": "Financial Services", "group": "금융"},
    # ── 소비재 ─────────────────────────────────────
    "WMT":   {"name": "Walmart Inc.",           "sector": "Consumer Staples",       "group": "소비재"},
    "COST":  {"name": "Costco Wholesale",       "sector": "Consumer Staples",       "group": "소비재"},
    "KO":    {"name": "The Coca-Cola Company",  "sector": "Consumer Staples",       "group": "소비재"},
    "PEP":   {"name": "PepsiCo, Inc.",          "sector": "Consumer Staples",       "group": "소비재"},
    "PG":    {"name": "Procter & Gamble Co.",   "sector": "Consumer Staples",       "group": "소비재"},
    "MO":    {"name": "Altria Group, Inc.",     "sector": "Consumer Staples",       "group": "소비재"},
    "MCD":   {"name": "McDonald's Corporation", "sector": "Consumer Discretionary", "group": "소비재"},
    "HD":    {"name": "The Home Depot, Inc.",   "sector": "Consumer Discretionary", "group": "소비재"},
    "NKE":   {"name": "NIKE, Inc.",             "sector": "Consumer Discretionary", "group": "소비재"},
    "SBUX":  {"name": "Starbucks Corporation",  "sector": "Consumer Discretionary", "group": "소비재"},
    # ── 산업재 / 방산 ─────────────────────────────────────
    "CAT":        {"name": "Caterpillar Inc.",          "sector": "Industrials", "group": "산업재 / 방산"},
    "DE":         {"name": "Deere & Company",           "sector": "Industrials", "group": "산업재 / 방산"},
    "BA":         {"name": "The Boeing Company",        "sector": "Industrials", "group": "산업재 / 방산"},
    "LMT":        {"name": "Lockheed Martin Corp.",     "sector": "Industrials", "group": "산업재 / 방산"},
    "RTX":        {"name": "RTX Corporation",           "sector": "Industrials", "group": "산업재 / 방산"},
    "NOC":        {"name": "Northrop Grumman Corp.",    "sector": "Industrials", "group": "산업재 / 방산"},
    "HON":        {"name": "Honeywell International",   "sector": "Industrials", "group": "산업재 / 방산"},
    "GE":         {"name": "GE Aerospace",              "sector": "Industrials", "group": "산업재 / 방산"},
    "UPS":        {"name": "United Parcel Service",     "sector": "Industrials", "group": "산업재 / 방산"},
    "FDX":        {"name": "FedEx Corporation",         "sector": "Industrials", "group": "산업재 / 방산"},
    "AVAV":       {"name": "AeroVironment, Inc.",       "sector": "Industrials", "group": "산업재 / 방산"},
    "KTOS":       {"name": "Kratos Defense & Security", "sector": "Industrials", "group": "산업재 / 방산"},
    "012450.KS":  {"name": "Hanwha Aerospace",          "sector": "Industrials", "group": "산업재 / 방산"},
    "079550.KS":  {"name": "LIG Nex1",                  "sector": "Industrials", "group": "산업재 / 방산"},
    # ── 부동산 (REITs) ─────────────────────────────────────
    "AMT":   {"name": "American Tower Corporation", "sector": "Real Estate", "group": "부동산 (REITs)"},
    "CCI":   {"name": "Crown Castle Inc.",          "sector": "Real Estate", "group": "부동산 (REITs)"},
    "PLD":   {"name": "Prologis, Inc.",             "sector": "Real Estate", "group": "부동산 (REITs)"},
    "EQIX":  {"name": "Equinix, Inc.",              "sector": "Real Estate", "group": "부동산 (REITs)"},
    "DLR":   {"name": "Digital Realty Trust",       "sector": "Real Estate", "group": "부동산 (REITs)"},
    "O":     {"name": "Realty Income Corporation",  "sector": "Real Estate", "group": "부동산 (REITs)"},
    "SPG":   {"name": "Simon Property Group",       "sector": "Real Estate", "group": "부동산 (REITs)"},
    "WELL":  {"name": "Welltower Inc.",             "sector": "Real Estate", "group": "부동산 (REITs)"},
    "PSA":   {"name": "Public Storage",             "sector": "Real Estate", "group": "부동산 (REITs)"},
    "VICI":  {"name": "VICI Properties Inc.",       "sector": "Real Estate", "group": "부동산 (REITs)"},
    # ── 통신 / 미디어 ─────────────────────────────────────
    "VZ":     {"name": "Verizon Communications",  "sector": "Communication Services", "group": "통신 / 미디어"},
    "T":      {"name": "AT&T Inc.",               "sector": "Communication Services", "group": "통신 / 미디어"},
    "TMUS":   {"name": "T-Mobile US, Inc.",       "sector": "Communication Services", "group": "통신 / 미디어"},
    "CMCSA":  {"name": "Comcast Corporation",     "sector": "Communication Services", "group": "통신 / 미디어"},
    "CHTR":   {"name": "Charter Communications",  "sector": "Communication Services", "group": "통신 / 미디어"},
    "NFLX":   {"name": "Netflix, Inc.",           "sector": "Communication Services", "group": "통신 / 미디어"},
    "DIS":    {"name": "The Walt Disney Company", "sector": "Communication Services", "group": "통신 / 미디어"},
    "SPOT":   {"name": "Spotify Technology S.A.", "sector": "Communication Services", "group": "통신 / 미디어"},
    "EA":     {"name": "Electronic Arts Inc.",    "sector": "Communication Services", "group": "통신 / 미디어"},
    "TTWO":   {"name": "Take-Two Interactive",    "sector": "Communication Services", "group": "통신 / 미디어"},
    # ── 유틸리티 / 전력 ─────────────────────────────────────
    "NEE":  {"name": "NextEra Energy, Inc.",    "sector": "Utilities", "group": "유틸리티 / 전력"},
    "SO":   {"name": "The Southern Company",    "sector": "Utilities", "group": "유틸리티 / 전력"},
    "DUK":  {"name": "Duke Energy Corporation", "sector": "Utilities", "group": "유틸리티 / 전력"},
    "AEP":  {"name": "American Electric Power", "sector": "Utilities", "group": "유틸리티 / 전력"},
    "EXC":  {"name": "Exelon Corporation",      "sector": "Utilities", "group": "유틸리티 / 전력"},
    "CEG":  {"name": "Constellation Energy",    "sector": "Utilities", "group": "유틸리티 / 전력"},
    "VST":  {"name": "Vistra Corp.",            "sector": "Utilities", "group": "유틸리티 / 전력"},
    "SRE":  {"name": "Sempra",                  "sector": "Utilities", "group": "유틸리티 / 전력"},
    "ED":   {"name": "Consolidated Edison",     "sector": "Utilities", "group": "유틸리티 / 전력"},
    "D":    {"name": "Dominion Energy, Inc.",   "sector": "Utilities", "group": "유틸리티 / 전력"},
    # ── 조선 (한국) ─────────────────────────────────────
    "329180.KS":  {"name": "HD Hyundai Heavy Industries", "sector": "Industrials", "group": "조선 (한국)"},
    "042660.KS":  {"name": "Hanwha Ocean Co., Ltd.",      "sector": "Industrials", "group": "조선 (한국)"},
    "010140.KS":  {"name": "Samsung Heavy Industries",    "sector": "Industrials", "group": "조선 (한국)"},
    "010620.KS":  {"name": "HD Hyundai Mipo Dockyard",    "sector": "Industrials", "group": "조선 (한국)"},
}
# --------------------------------------------------------------------------
# 시장 지수 정의
# --------------------------------------------------------------------------
# Yahoo Finance 지수 티커는 ^ 로 시작. 파일 저장명은 ^ 제거하고 사용.
INDICES: dict[str, dict] = {
    "^GSPC": {
        "name":        "S&P 500",
        "description": "미국 대형주 500개를 시가총액 가중평균한 지수. 미국 주식시장 전체를 가장 잘 대표한다.",
    },
    "^IXIC": {
        "name":        "NASDAQ Composite",
        "description": "나스닥 거래소 상장 종목 전체로 구성. 테크·성장주 비중이 압도적으로 높아 기술주 흐름의 바로미터.",
    },
    "^DJI": {
        "name":        "Dow Jones Industrial Average",
        "description": "미국 30개 우량 대기업으로 구성된 가장 오래된(1896년~) 주가 지수. 가격 가중 방식이라 고가 종목 영향이 크다.",
    },
    "^RUT": {
        "name":        "Russell 2000",
        "description": "미국 소형주 2,000개로 구성. 내수 경제와 중소기업 동향을 보여주는 지표로 자주 쓰인다.",
    },
}


# --------------------------------------------------------------------------
# 상수
# --------------------------------------------------------------------------
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
INDEX_PATH       = DATA_DIR / "index.json"
INDICATORS_DIR   = DATA_DIR / "indicators"
ASSETS_DIR       = DATA_DIR / "assets"
STOCKS_DIR       = DATA_DIR / "stocks"
INDICES_DIR      = DATA_DIR / "indices"
# 구 단일 번들 경로 — 마이그레이션 및 하위 호환용 fallback 으로만 읽는다.
LEGACY_BUNDLE_PATH = DATA_DIR / "indicators.json"

# FRED에서 가져올 수 있는 최대한의 과거 데이터를 받는다.
# FRED 시계열은 최대 1800년대 후반까지 존재하므로, 충분히 과거의 날짜를 시작점으로 지정한다.
# 실제로는 각 시계열의 최초 관측일 이후 데이터만 반환되므로 문제없다.
FRED_EARLIEST_DATE = "1776-07-04"
REQUEST_TIMEOUT = 60  # 초 (과거 데이터까지 조회하므로 여유 있게)


# --------------------------------------------------------------------------
# FRED 호출
# --------------------------------------------------------------------------
def fetch_series(series_id: str, api_key: str, start_date: str) -> list[dict]:
    """FRED에서 단일 시계열을 가져와 [{'date': 'YYYY-MM-DD', 'value': float}, ...] 로 반환.

    FRED는 결측치를 "." 로 돌려주므로 그런 포인트는 제외한다.
    """
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start_date,
    }
    resp = requests.get(FRED_BASE_URL, params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    payload = resp.json()

    series: list[dict] = []
    for obs in payload.get("observations", []):
        raw_value = obs.get("value")
        if raw_value in (".", None, ""):
            continue  # 결측치 skip
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        series.append({"date": obs["date"], "value": value})
    return series


# --------------------------------------------------------------------------
# 변환 함수들
# --------------------------------------------------------------------------
def _series_to_pandas(series: list[dict]) -> pd.Series:
    """[{date, value}] → DatetimeIndex 기준 pd.Series (오름차순 정렬)."""
    if not series:
        return pd.Series(dtype=float)
    df = pd.DataFrame(series)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")["value"].astype(float).sort_index()


def _pandas_to_series(s: pd.Series) -> list[dict]:
    """pd.Series → [{date: 'YYYY-MM-DD', value: float}] 리스트."""
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 3)}
        for d, v in s.items()
        if pd.notna(v)
    ]


def compute_yoy_pct(series: list[dict]) -> list[dict]:
    """월간 시계열의 전년 동월 대비 상승률(%). 12 기간 전 대비 pct_change."""
    s = _series_to_pandas(series)
    if s.empty:
        return []
    yoy = s.pct_change(periods=12) * 100.0
    return _pandas_to_series(yoy.dropna())


def compute_yoy_pct_daily(series: list[dict]) -> list[dict]:
    """일간 시계열을 월말(last) 로 리샘플 → YoY(%).

    WTI 같은 일간 가격 데이터에 대해서도 월 단위 YoY 를 뽑아, 다른 인플레 지표와
    같은 기준(월간 YoY%) 에서 백분위/레이블 비교가 가능하도록 한다.
    """
    s = _series_to_pandas(series)
    if s.empty:
        return []
    monthly_last = s.resample("ME").last().dropna()
    yoy = monthly_last.pct_change(periods=12) * 100.0
    return _pandas_to_series(yoy.dropna())


TRANSFORMS = {
    "yoy_pct":       compute_yoy_pct,
    "yoy_pct_daily": compute_yoy_pct_daily,
}


# --------------------------------------------------------------------------
# Yahoo Finance 수집 (FRED에 없는 지수)
# --------------------------------------------------------------------------
def fetch_yahoo_monthly(symbol: str) -> list[dict]:
    """Yahoo Finance에서 월별 종가(Close) 시계열을 [{date, value}, ...] 로 반환.

    실패 시 빈 리스트 반환 — 호출부에서 기존값을 유지한다.
    """
    try:
        import yfinance as yf  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("yfinance 가 설치되지 않았습니다. pip install yfinance") from e

    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="max", interval="1mo", auto_adjust=True)
    if hist.empty:
        return []

    series: list[dict] = []
    for idx, row in hist.iterrows():
        date_str = (
            idx.tz_localize(None).strftime("%Y-%m-%d")
            if idx.tzinfo else idx.strftime("%Y-%m-%d")
        )
        try:
            val = float(row["Close"])
        except (TypeError, ValueError, KeyError):
            continue
        if pd.isna(val):
            continue
        series.append({"date": date_str, "value": round(val, 2)})
    return sorted(series, key=lambda x: x["date"])


# --------------------------------------------------------------------------
# Yahoo Finance 개별 종목 수집 (일별 종가, 최근 10년)
# --------------------------------------------------------------------------
def fetch_yahoo_index(symbol: str) -> list[dict]:
    """주가 지수: 최근 20년치 일별 종가 시계열.

    지수는 개별 종목보다 변동이 작고 장기 추세가 중요해서 더 긴 기간을 받는다.
    """
    try:
        import yfinance as yf  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("yfinance 가 설치되지 않았습니다.") from e

    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="20y", interval="1d", auto_adjust=False)
    if hist.empty:
        return []

    series: list[dict] = []
    for idx, row in hist.iterrows():
        date_str = (
            idx.tz_localize(None).strftime("%Y-%m-%d")
            if idx.tzinfo else idx.strftime("%Y-%m-%d")
        )
        try:
            val = float(row["Close"])
        except (TypeError, ValueError, KeyError):
            continue
        if pd.isna(val):
            continue
        series.append({"date": date_str, "value": round(val, 2)})
    return sorted(series, key=lambda x: x["date"])


def fetch_yahoo_stock(symbol: str) -> list[dict]:
    """Yahoo Finance에서 일별 종가 시계열을 [{date, value}, ...] 로 반환.

    최근 10년치 일별 데이터를 가져온다. 실패 시 빈 리스트 반환.
    """
    try:
        import yfinance as yf  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("yfinance 가 설치되지 않았습니다. pip install yfinance") from e

    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="10y", interval="1d", auto_adjust=True)
    if hist.empty:
        return []

    series: list[dict] = []
    for idx, row in hist.iterrows():
        date_str = (
            idx.tz_localize(None).strftime("%Y-%m-%d")
            if idx.tzinfo else idx.strftime("%Y-%m-%d")
        )
        try:
            val = float(row["Close"])
        except (TypeError, ValueError, KeyError):
            continue
        if pd.isna(val):
            continue
        series.append({"date": date_str, "value": round(val, 2)})
    return sorted(series, key=lambda x: x["date"])


# --------------------------------------------------------------------------
# Yahoo Finance 재무/실적 데이터 수집
# --------------------------------------------------------------------------
def _safe_float(val) -> Optional[float]:
    """nan/None/문자열 등 비정상 값을 None 으로 정규화."""
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if pd.isna(f):
        return None
    return f


def _row_value(df: pd.DataFrame, candidates: list[str], col) -> Optional[float]:
    """yfinance 가 회사마다 항목명을 약간씩 다르게 주므로 후보 키들을 순서대로 시도."""
    for key in candidates:
        if key in df.index:
            return _safe_float(df.at[key, col])
    return None


def fetch_yahoo_financials(symbol: str, max_quarters: int = 20) -> dict:
    """Yahoo Finance에서 핵심 재무 지표(snapshot) + 분기 손익 추세를 수집.

    반환 구조:
        {
            "snapshot": {market_cap, pe_ratio, eps_ttm, ...},  # 현재 시점 단일값
            "quarterly": [
                {date, revenue, operating_income, net_income, eps},
                ...  # 최근 max_quarters 개 (시간 오름차순)
            ]
        }
    실패 시 빈 구조 반환.
    """
    try:
        import yfinance as yf  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("yfinance 가 설치되지 않았습니다.") from e

    ticker = yf.Ticker(symbol)
    info = ticker.info or {}

    snapshot = {
        "market_cap":       _safe_float(info.get("marketCap")),
        "pe_ratio":         _safe_float(info.get("trailingPE")),
        "forward_pe":       _safe_float(info.get("forwardPE")),
        "eps_ttm":          _safe_float(info.get("trailingEps")),
        "dividend_yield":   _safe_float(info.get("dividendYield")),
        "profit_margin":    _safe_float(info.get("profitMargins")),
        "operating_margin": _safe_float(info.get("operatingMargins")),
        "price_to_book":    _safe_float(info.get("priceToBook")),
        "return_on_equity": _safe_float(info.get("returnOnEquity")),
    }

    # 분기 손익계산서 — 회사마다 항목명이 약간 다름
    quarterly: list[dict] = []
    qis = ticker.quarterly_income_stmt
    if qis is not None and not qis.empty:
        # 컬럼은 분기 종료일(Timestamp)
        sorted_cols = sorted(qis.columns)
        for col in sorted_cols[-max_quarters:]:
            date_str = pd.Timestamp(col).strftime("%Y-%m-%d")
            quarterly.append({
                "date":             date_str,
                "revenue":          _row_value(qis, ["Total Revenue"], col),
                "operating_income": _row_value(qis, ["Operating Income", "Operating Income Loss"], col),
                "net_income":       _row_value(qis, ["Net Income", "Net Income Common Stockholders"], col),
                "eps":              _row_value(qis, ["Diluted EPS", "Basic EPS"], col),
            })

    return {"snapshot": snapshot, "quarterly": quarterly}


# --------------------------------------------------------------------------
# 기존 JSON 입출력
# --------------------------------------------------------------------------
def _read_json(path: Path) -> Optional[dict]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def load_split_store() -> dict:
    """data/index.json + data/indicators/*.json + data/assets/*.json 을 읽어
    fetch_fred 내부에서 쓰던 단일 dict 형태로 복원한다.

    분할 파일이 없으면 레거시 data/indicators.json 으로 폴백.
    둘 다 없으면 빈 구조 반환.
    """
    empty = {"last_updated": None, "indicators": {}, "assets": {}, "stocks": {}, "indices": {}}

    if INDEX_PATH.exists():
        idx = _read_json(INDEX_PATH) or {}
        indicators: dict[str, dict] = {}
        for code in [entry["code"] for entry in idx.get("indicators", []) if "code" in entry]:
            payload = _read_json(INDICATORS_DIR / f"{code}.json")
            if payload is not None:
                indicators[code] = payload
        assets: dict[str, dict] = {}
        for code in [entry["code"] for entry in idx.get("assets", []) if "code" in entry]:
            payload = _read_json(ASSETS_DIR / f"{code}.json")
            if payload is not None:
                assets[code] = payload
        stocks: dict[str, dict] = {}
        for code in [entry["code"] for entry in idx.get("stocks", []) if "code" in entry]:
            payload = _read_json(STOCKS_DIR / f"{code}.json")
            if payload is not None:
                stocks[code] = payload
        indices: dict[str, dict] = {}
        for code in [entry["code"] for entry in idx.get("indices", []) if "code" in entry]:
            payload = _read_json(INDICES_DIR / f"{code}.json")
            if payload is not None:
                indices[code] = payload
        return {
            "last_updated": idx.get("last_updated"),
            "indicators": indicators,
            "assets": assets,
            "stocks": stocks,
            "indices": indices,
        }

    if LEGACY_BUNDLE_PATH.exists():
        legacy = _read_json(LEGACY_BUNDLE_PATH)
        if legacy is not None:
            legacy.setdefault("assets", {})
            return legacy

    return empty


def collect_group(group: dict, api_key: str, label: str) -> tuple[dict, int]:
    """INDICATORS/ASSETS 를 한 번에 수집하는 공용 루프.

    반환:
        (수집된 시리즈 dict, 성공 카운트)
    실패한 시리즈는 결과 dict 에 포함하지 않는다 — 호출부에서 기존값을 유지하도록.
    """
    collected: dict[str, dict] = {}
    success = 0
    for code, meta in group.items():
        print(f"Fetching {label} {code}...", end=" ", flush=True)
        try:
            raw = fetch_series(code, api_key, FRED_EARLIEST_DATE)
            transform = meta.get("transform")
            if transform:
                fn = TRANSFORMS.get(transform)
                if fn is None:
                    raise ValueError(f"unknown transform: {transform}")
                series = fn(raw)
            else:
                series = raw
            entry = {
                "name": meta["name"],
                "unit": meta["unit"],
                "series": series,
            }
            if "category" in meta:
                entry["category"] = meta["category"]
            if "region" in meta:
                entry["region"] = meta["region"]
            if meta.get("exclude_assessment"):
                entry["exclude_assessment"] = True
            collected[code] = entry
            print(f"OK ({len(series)} points)")
            success += 1
        except requests.RequestException as e:
            print(f"FAILED (network: {e})")
        except Exception as e:  # noqa: BLE001  # 어떤 이유로든 다른 시리즈는 계속 가야 함
            print(f"FAILED (unexpected: {e})")
    return collected, success


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")  # 파일 끝 개행 (POSIX 관례)


def _clean_stale_files(directory: Path, keep_codes: set[str]) -> None:
    """지정 디렉토리에서 keep_codes 에 없는 <code>.json 을 삭제한다 — 제거된 지표/자산 정리."""
    if not directory.exists():
        return
    for path in directory.glob("*.json"):
        if path.stem not in keep_codes:
            path.unlink(missing_ok=True)


def save_split_store(output: dict) -> None:
    """{last_updated, indicators, assets, assessment, assessment_kr} 를 분할 저장.

    - data/index.json: last_updated + 각 지표·자산의 메타데이터(코드/이름/분류/단위/current 등) + assessment
    - data/indicators/<code>.json: 각 지표의 전체 payload (series 포함)
    - data/assets/<code>.json:     각 자산의 전체 payload (series 포함)

    유저가 개별 파일을 직접 편집 가능한 형태로 유지하기 위한 구조.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    INDICATORS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    STOCKS_DIR.mkdir(parents=True, exist_ok=True)
    INDICES_DIR.mkdir(parents=True, exist_ok=True)

    indicators = output.get("indicators", {}) or {}
    assets     = output.get("assets", {}) or {}
    stocks     = output.get("stocks", {}) or {}
    indices    = output.get("indices", {}) or {}

    indicator_index_entries: list[dict] = []
    for code, payload in indicators.items():
        save_json(INDICATORS_DIR / f"{code}.json", payload)
        entry = {
            "code": code,
            "name":      payload.get("name"),
            "unit":      payload.get("unit"),
            "category":  payload.get("category"),
        }
        if "region" in payload:
            entry["region"] = payload["region"]
        if payload.get("exclude_assessment"):
            entry["exclude_assessment"] = True
        if "current" in payload:
            entry["current"] = payload["current"]
        indicator_index_entries.append(entry)

    asset_index_entries: list[dict] = []
    for code, payload in assets.items():
        save_json(ASSETS_DIR / f"{code}.json", payload)
        asset_index_entries.append({
            "code": code,
            "name": payload.get("name"),
            "unit": payload.get("unit"),
        })

    stock_index_entries: list[dict] = []
    watchlist_set = set(stocks.keys())
    for code, payload in stocks.items():
        save_json(STOCKS_DIR / f"{code}.json", payload)
        entry = {
            "code":   code,
            "name":   payload.get("name"),
            "sector": payload.get("sector"),
            "group":  payload.get("group"),
            "competitors_in_watchlist": get_watchlist_competitors(code, watchlist_set),
        }
        # valuation 블록이 있으면 요약 필드만 인덱스에 노출 (목록 카드용)
        val = payload.get("valuation")
        if val:
            summary = {
                "as_of":         val.get("as_of"),
                "current_price": val.get("current_price"),
                "fair_value":    val.get("fair_value"),
                "valuation_gap": val.get("valuation_gap"),
                "signal":        val.get("signal"),
            }
            qual = val.get("qualitative")
            if qual:
                summary["narrative_score"] = qual.get("narrative_score")
                summary["qualitative_as_of"] = qual.get("as_of")
            entry["valuation_summary"] = summary
        stock_index_entries.append(entry)

    # 시장 지수 — ^ 접두사가 파일명에 부적합하므로 제거해서 저장하되 code 에는 보존.
    index_index_entries: list[dict] = []
    for code, payload in indices.items():
        safe_name = code.lstrip("^") or code
        save_json(INDICES_DIR / f"{safe_name}.json", payload)
        index_index_entries.append({
            "code":     code,
            "filename": safe_name,
            "name":     payload.get("name"),
        })

    index_doc = {
        "last_updated":   output.get("last_updated"),
        "indicators":     indicator_index_entries,
        "assets":         asset_index_entries,
        "stocks":         stock_index_entries,
        "indices":        index_index_entries,
        "assessment":     output.get("assessment"),
        "assessment_kr":  output.get("assessment_kr"),
    }
    save_json(INDEX_PATH, index_doc)

    # 수집 대상에서 빠진 코드의 잔여 파일 정리
    _clean_stale_files(INDICATORS_DIR, set(indicators.keys()))
    _clean_stale_files(ASSETS_DIR,     set(assets.keys()))
    _clean_stale_files(STOCKS_DIR,     set(stocks.keys()))
    _clean_stale_files(INDICES_DIR,    {c.lstrip("^") or c for c in indices.keys()})

    # 레거시 단일 번들은 더 이상 쓰지 않으니 정리
    if LEGACY_BUNDLE_PATH.exists():
        LEGACY_BUNDLE_PATH.unlink(missing_ok=True)


# --------------------------------------------------------------------------
# 메인 파이프라인
# --------------------------------------------------------------------------
def main() -> int:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        print("ERROR: FRED_API_KEY 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        return 1

    now_utc = datetime.now(timezone.utc)

    # 실패한 시리즈는 기존 데이터 유지 (없어지지 않도록)
    existing = load_split_store()
    merged_indicators: dict[str, dict] = dict(existing.get("indicators", {}))
    merged_assets: dict[str, dict] = dict(existing.get("assets", {}))
    merged_stocks: dict[str, dict] = dict(existing.get("stocks", {}))
    merged_indices: dict[str, dict] = dict(existing.get("indices", {}))

    new_indicators, ok_ind = collect_group(INDICATORS, api_key, "indicator")
    new_assets,    ok_ast  = collect_group(ASSETS,    api_key, "asset")

    # KOSPI YoY — Yahoo Finance 경유 (FRED 미제공)
    print("Fetching indicator KOSPI_YOY (Yahoo Finance ^KS11)...", end=" ", flush=True)
    try:
        raw_kospi = fetch_yahoo_monthly("^KS11")
        if raw_kospi:
            kospi_yoy = compute_yoy_pct(raw_kospi)
            new_indicators["KOSPI_YOY"] = {
                "name": "KOSPI YoY",
                "unit": "percent",
                "category": "growth",
                "region": "KR",
                "exclude_assessment": True,
                "series": kospi_yoy,
            }
            print(f"OK ({len(kospi_yoy)} points)")
            ok_ind += 1
        else:
            print("FAILED (empty series)")
    except Exception as e:  # noqa: BLE001
        print(f"FAILED (unexpected: {e})")

    # KOSPI 원시 가격 — 비교 자산으로도 추가
    print("Fetching asset KOSPI (Yahoo Finance ^KS11)...", end=" ", flush=True)
    try:
        raw_kospi_price = fetch_yahoo_monthly("^KS11")
        if raw_kospi_price:
            new_assets["KOSPI"] = {
                "name": "KOSPI",
                "unit": "index",
                "series": raw_kospi_price,
            }
            print(f"OK ({len(raw_kospi_price)} points)")
            ok_ast += 1
        else:
            print("FAILED (empty series)")
    except Exception as e:  # noqa: BLE001
        print(f"FAILED (unexpected: {e})")

    # 개별 종목 — Yahoo Finance 경유 (가격 + 재무/실적)
    new_stocks: dict[str, dict] = {}
    ok_stk = 0
    for ticker, meta in STOCKS.items():
        print(f"Fetching stock {ticker} price (Yahoo Finance)...", end=" ", flush=True)
        try:
            series = fetch_yahoo_stock(ticker)
            if not series:
                print("FAILED (empty series)")
                continue
            print(f"OK ({len(series)} points)")
        except Exception as e:  # noqa: BLE001
            print(f"FAILED (unexpected: {e})")
            continue

        # 재무 데이터는 실패해도 가격만이라도 저장
        financials = {"snapshot": {}, "quarterly": []}
        print(f"  Fetching {ticker} financials...", end=" ", flush=True)
        try:
            financials = fetch_yahoo_financials(ticker)
            print(f"OK ({len(financials['quarterly'])} quarters)")
        except Exception as e:  # noqa: BLE001
            print(f"FAILED (unexpected: {e})")

        new_stocks[ticker] = {
            "name":       meta["name"],
            "sector":     meta["sector"],
            "group":      meta.get("group"),
            "series":     series,
            "financials": financials,
        }
        ok_stk += 1

    # 시장 지수 — Yahoo Finance 경유
    new_indices: dict[str, dict] = {}
    ok_idx = 0
    for symbol, meta in INDICES.items():
        print(f"Fetching index {symbol} (Yahoo Finance)...", end=" ", flush=True)
        try:
            series = fetch_yahoo_index(symbol)
            if series:
                new_indices[symbol] = {
                    "name":        meta["name"],
                    "description": meta["description"],
                    "series":      series,
                }
                print(f"OK ({len(series)} points)")
                ok_idx += 1
            else:
                print("FAILED (empty series)")
        except Exception as e:  # noqa: BLE001
            print(f"FAILED (unexpected: {e})")

    merged_indicators.update(new_indicators)
    merged_assets.update(new_assets)
    merged_stocks.update(new_stocks)
    merged_indices.update(new_indices)

    success_count = ok_ind + ok_ast + ok_stk + ok_idx
    total_count   = len(INDICATORS) + len(ASSETS) + 2 + len(STOCKS) + len(INDICES)  # +2: KOSPI_YOY, KOSPI asset

    if success_count == 0:
        # 전부 실패하면 기존 파일을 건드리지 않는다 (데이터 보존)
        print(
            "ERROR: 모든 시리즈 수집 실패. 기존 JSON을 덮어쓰지 않습니다.",
            file=sys.stderr,
        )
        return 2

    output = {
        "last_updated": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indicators": merged_indicators,
        "assets": merged_assets,
        "stocks": merged_stocks,
        "indices": merged_indices,
    }

    # 각 지표에 "current" (percentile/label) 를 주입하고, 성장/인플레 종합
    # 점수와 분면 판정(assessment) 을 최상위에 추가한다.
    print("\nAnalyzing (percentile / labels / quadrant)...", flush=True)
    enrich_with_assessment(output)

    # 개별 종목에 valuation (fair value, gap, signal) 블록 주입
    print("Computing stock valuation gaps...", flush=True)
    enrich_stocks_with_valuation(output.get("stocks", {}) or {})

    # data/news/ 의 정성 분석을 valuation.qualitative 로 병합 (Routine 결과)
    print("Merging qualitative analysis from data/news/...", flush=True)
    merge_qualitative_into_stocks(output.get("stocks", {}) or {})

    save_split_store(output)

    print(
        f"\nDone. {success_count}/{total_count} series updated "
        f"(indicators: {ok_ind}/{len(INDICATORS) + 1}, "
        f"assets: {ok_ast}/{len(ASSETS) + 1}) "
        f"-> {DATA_DIR.relative_to(REPO_ROOT)}/ (index.json + indicators/*.json + assets/*.json + stocks/*.json)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
