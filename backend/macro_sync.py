import yfinance as yf
from supabase import create_client
import os
import pandas as pd
from datetime import datetime

# Utilisation des secrets GitHub
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def sync_macro():
    print("--- Début Synchro Macro ---")
    
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
                else:
                    print(f"⚠️ Données insuffisantes pour {name}")
            except Exception as e:
                print(f"❌ Erreur {name}: {e}")

if __name__ == "__main__":
    sync_macro()