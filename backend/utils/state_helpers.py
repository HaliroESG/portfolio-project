from __future__ import annotations

from datetime import datetime
import numpy as np
import pandas as pd


def classify_trend_state(macd_line, macd_signal, rsi_14, momentum_20):
    if None in (macd_line, macd_signal, rsi_14, momentum_20):
        return "INSUFFICIENT_HISTORY"
    if macd_line > macd_signal and rsi_14 >= 60 and momentum_20 > 0:
        return "BULLISH"
    if macd_line < macd_signal and rsi_14 < 40 and momentum_20 < 0:
        return "BEARISH"
    return "NEUTRAL"


def parse_numeric(value):
    if value is None:
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        try:
            if np.isnan(value):
                return None
        except Exception:
            pass
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace("€", "").replace("$", "").replace("%", "").replace(" ", "").replace(",", ".")
        if cleaned == "":
            return None
        try:
            return float(cleaned)
        except Exception:
            return None
    return None


def calculate_data_status(last_price, last_trade_timestamp=None):
    if last_price is None or last_price == 0:
        return 'LOW_CONFIDENCE'
    if last_trade_timestamp is not None:
        try:
            if isinstance(last_trade_timestamp, str):
                last_trade_dt = pd.to_datetime(last_trade_timestamp).to_pydatetime()
            elif hasattr(last_trade_timestamp, 'to_pydatetime'):
                last_trade_dt = last_trade_timestamp.to_pydatetime()
            elif isinstance(last_trade_timestamp, pd.Timestamp):
                last_trade_dt = last_trade_timestamp.to_pydatetime()
            else:
                last_trade_dt = last_trade_timestamp
            if not isinstance(last_trade_dt, datetime):
                last_trade_dt = pd.to_datetime(last_trade_dt).to_pydatetime()
            if last_trade_dt.year < 2024:
                return 'OK'
            days_diff = (datetime.now() - last_trade_dt).days
            if 7 < days_diff < (10 * 365):
                return 'STALE'
        except Exception:
            return 'OK'
    return 'OK'
