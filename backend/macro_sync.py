import os
import time
from datetime import datetime

import pandas as pd
import yfinance as yf
from supabase import create_client

from etl_stats import build_etl_stats

# Utilisation des secrets GitHub
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def start_etl_run(job_name: str) -> str | None:
    try:
        response = (
            supabase
            .table("etl_runs")
            .insert({
                "job_name": job_name,
                "status": "RUNNING",
                "started_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            })
            .execute()
        )
        if response.data and len(response.data) > 0:
            return response.data[0].get("id")
    except Exception as e:
        print(f"⚠️ Impossible de démarrer etl_runs: {e}")
    return None


def finish_etl_run(run_id: str | None, status: str, duration_sec: float, stats: dict | None = None, error: str | None = None) -> None:
    if not run_id:
        return
    try:
        payload = {
            "status": status,
            "finished_at": datetime.now().isoformat(),
            "duration_sec": round(duration_sec, 2),
            "updated_at": datetime.now().isoformat(),
        }
        if stats is not None:
            payload["stats"] = stats
        if error:
            payload["error"] = error
        supabase.table("etl_runs").update(payload).eq("id", run_id).execute()
    except Exception as e:
        print(f"⚠️ Impossible de clôturer etl_runs: {e}")

def sync_macro():
    print("--- Début Synchro Macro ---")
    updated = 0
    failed = 0

    # Configuration des tickers
    daily_tickers = {
        "^VIX": "VIX Index",
        "^MOVE": "MOVE Index",
        "^TNX": "US 10Y Yield",
        "DX-Y.NYB": "DXY Dollar Index"
    }

    for ticker, name in daily_tickers.items():
            try:
                # On prend 5 jours pour être sûr d'avoir des données même après un jour férié
                df = yf.download(ticker, period="5d", progress=False)
                
                if not df.empty and len(df) >= 2:
                    # Gestion propre des types pour éviter les Warnings
                    last_close = df['Close'].iloc[-1]
                    prev_close = df['Close'].iloc[-2]
                    
                    current = float(last_close.iloc[0]) if hasattr(last_close, 'iloc') else float(last_close)
                    prev = float(prev_close.iloc[0]) if hasattr(prev_close, 'iloc') else float(prev_close)
                    
                    change = (current / prev) - 1
                    
                    supabase.table("macro_indicators").update({
                        "value": current,
                        "change_pct": change,
                        "last_update": datetime.now().isoformat()
                    }).eq("id", ticker).execute()
                    print(f"✅ {name} à jour : {current:.2f}")
                    updated += 1
                else:
                    print(f"⚠️ Données insuffisantes pour {name}")
                    failed += 1
            except Exception as e:
                print(f"❌ Erreur {name}: {e}")
                failed += 1
    return {"updated": updated, "failed": failed}

if __name__ == "__main__":
    job_name = "macro_sync"
    started = time.time()
    run_id = start_etl_run(job_name)
    try:
        stats = sync_macro()
        normalized_stats = build_etl_stats(
            job_name,
            stats,
            items_total=(stats.get("updated", 0) + stats.get("failed", 0)),
            items_success=stats.get("updated"),
            items_failed=stats.get("failed"),
        )
        finish_etl_run(run_id, "SUCCESS", time.time() - started, stats=normalized_stats)
    except Exception as e:
        finish_etl_run(run_id, "FAILED", time.time() - started, error=str(e))
        raise
