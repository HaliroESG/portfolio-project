import os
import json
import gspread
import yfinance as yf
import pandas as pd
from datetime import datetime
from supabase import create_client
from oauth2client.service_account import ServiceAccountCredentials

print("--- 🔍 DÉMARRAGE DU DIAGNOSTIC ---", flush=True)

# 1. RÉCUPÉRATION DES VARIABLES (Noms standardisés par le YAML)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") # Le YAML envoie le secret ici
GSPREAD_JSON = os.environ.get("GSPREAD_SERVICE_ACCOUNT")

# 2. CHECK DE SÉCURITÉ
if not SUPABASE_URL:
    print("❌ ERREUR : SUPABASE_URL manquant", flush=True)
    exit(1)
if not SUPABASE_KEY:
    print("❌ ERREUR : SUPABASE_KEY manquant (Secret GitHub non transmis)", flush=True)
    exit(1)
if not GSPREAD_JSON:
    print("❌ ERREUR : GSPREAD_SERVICE_ACCOUNT manquant", flush=True)
    exit(1)

# 3. INITIALISATION
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ Client Supabase connecté.", flush=True)
except Exception as e:
    print(f"❌ Crash Supabase : {e}", flush=True)
    exit(1)

# --- CONNEXION GOOGLE SHEETS ---
def get_gspread_client():
    try:
        info = json.loads(GSPREAD_JSON)
        creds = ServiceAccountCredentials.from_json_keyfile_dict(info, [
            'https://spreadsheets.google.com/feeds',
            'https://www.googleapis.com/auth/drive'
        ])
        return gspread.authorize(creds)
    except Exception as e:
        print(f"❌ Erreur Auth Google : {e}", flush=True)
        return None

# --- MOTEUR DE CALCUL FINANCIER (TOTAL RETURN EUR) ---

def update_macro_hub():
    # Liste des indicateurs : Ticker Yahoo -> [Nom, Catégorie]
    indicators = {
        "^VIX": ["Indice de Peur (VIX)", "VOLATILITY"],
        "^TNX": ["Taux US 10Y", "RATES"],
        "GC=F": ["Or (Gold)", "COMMODITY"],
        "EURUSD=X": ["EUR/USD", "FOREX"],
        "BTC-USD": ["Bitcoin", "CRYPTO"]
    }
    
    
    print("--- MISE À JOUR DU HUB MACRO ---", flush=True)
    
    for ticker, info in indicators.items():
            try:
                # On demande un peu plus d'historique pour éviter les erreurs le week-end
                data = yf.download(ticker, period="5d", progress=False)
                
                if not data.empty and len(data) >= 2:
                    # Correction du Warning "FutureWarning: Calling float on a single element Series"
                    current_val = float(data['Close'].iloc[-1].iloc[0]) if isinstance(data['Close'].iloc[-1], pd.Series) else float(data['Close'].iloc[-1])
                    prev_val = float(data['Close'].iloc[-2].iloc[0]) if isinstance(data['Close'].iloc[-2], pd.Series) else float(data['Close'].iloc[-2])
                    
                    change = (current_val / prev_val) - 1
                    
                    payload = {
                        "id": ticker,
                        "name": info[0],
                        "category": info[1],
                        "value": current_val,
                        "change_pct": change,
                        "last_update": datetime.now().isoformat()
                    }
                    supabase.table("macro_indicators").upsert(payload).execute()
                    print(f"    ✅ {info[0]}: {current_val:.2f}", flush=True)
                else:
                    print(f"    ⚠️ Pas assez de données pour {ticker}")
            except Exception as e:
                print(f"    ❌ Erreur macro {ticker}: {e}")


def get_financial_data(ticker, currency):
    if not ticker: return None
    print(f"    📊 Analyse financière : {ticker} ({currency})...", flush=True)
    
    try:
        df_asset = yf.download(ticker, period="2y", progress=False)
        
        if currency == "EUR":
            df_fx = pd.DataFrame(1.0, index=df_asset.index, columns=['Close'])
        else:
            fx_ticker = f"{currency}EUR=X"
            df_fx = yf.download(fx_ticker, period="2y", progress=False)

        if isinstance(df_asset.columns, pd.MultiIndex): df_asset.columns = df_asset.columns.get_level_values(0)
        if isinstance(df_fx.columns, pd.MultiIndex): df_fx.columns = df_fx.columns.get_level_values(0)

        df = df_asset[['Close']].rename(columns={'Close': 'price'})
        df['fx'] = df_fx['Close']
        df = df.ffill() # Correction FutureWarning fillna

        df['val_eur'] = df['price'] * df['fx']

        now_eur = df['val_eur'].iloc[-1]
        prev_eur = df['val_eur'].iloc[-2]
        week_eur = df['val_eur'].iloc[-6]
        month_eur = df['val_eur'].iloc[-22]
        
        ytd_date = f"{datetime.now().year}-01-01"
        start_year_eur = df[df.index < ytd_date]['val_eur'].iloc[-1]
        start_year_local = df[df.index < ytd_date]['price'].iloc[-1]

        calc = lambda current, start: (current / start) - 1

        return {
            "last_price": float(df['price'].iloc[-1]),
            "perf_eur": {
                "day": calc(now_eur, prev_eur),
                "week": calc(now_eur, week_eur),
                "month": calc(now_eur, month_eur),
                "ytd": calc(now_eur, start_year_eur)
            },
            "perf_local": {
                "day": calc(df['price'].iloc[-1], df['price'].iloc[-2]),
                "ytd": calc(df['price'].iloc[-1], start_year_local)
            }
        }
    except Exception as e:
        print(f"    ❌ Erreur calculs pour {ticker}: {e}")
        return None

def update_currencies():
    currencies = {"USD": "$", "CHF": "CHF", "GBP": "£", "JPY": "¥"}
    print("--- MISE À JOUR DES DEVISES ---", flush=True)
    
    for code, symbol in currencies.items():
        ticker = f"{code}EUR=X"
        try:
            data = yf.download(ticker, period="2d", progress=False)
            if not data.empty:
                # Correction FutureWarning float()
                val = data['Close'].iloc[-1]
                rate = float(val.iloc[0]) if hasattr(val, '__len__') else float(val)
                
                payload = {
                    "id": code,
                    "symbol": symbol,
                    "rate_to_eur": rate,
                    "last_update": datetime.now().isoformat()
                }
                supabase.table("currencies").upsert(payload).execute()
                print(f"    ✅ {code}: {rate} EUR", flush=True)
        except Exception as e:
            print(f"    ❌ Erreur devise {code}: {e}", flush=True)

def run_sync():
    client = get_gspread_client()
    if not client: return

    sheet_name = os.environ.get("GSHEET_NAME")
    try:
        sh = client.open(sheet_name).sheet1
        assets = sh.get_all_records()
        print(f"✅ Feuille connectée. {len(assets)} lignes trouvées.", flush=True)
    except Exception as e:
        print(f"❌ Erreur ouverture GSheet: {e}", flush=True)
        return

    for asset in assets:
        data_clean = {k.strip().lower(): v for k, v in asset.items()}
        ticker_key = next((k for k in data_clean.keys() if 'ticker' in k), None)
        name_key = next((k for k in data_clean.keys() if 'nom' in k or 'name' in k), 'nom')
        currency_key = next((k for k in data_clean.keys() if 'devise' in k or 'curr' in k), 'devise')
        geo_key = next((k for k in data_clean.keys() if 'poids' in k or 'geo' in k), None)
        
        if not ticker_key: continue
        ticker = data_clean[ticker_key]
        currency = data_clean.get(currency_key, "EUR").strip().upper()
        if not ticker: continue

        geo_coverage = {}
        if geo_key:
            raw_geo = data_clean[geo_key]
            if isinstance(raw_geo, str) and "{" in raw_geo:
                try:
                    geo_coverage = json.loads(raw_geo.replace("'", '"'))
                except: pass

        mkt = get_financial_data(ticker, currency)
        if mkt:
            payload = {
                "ticker": ticker,
                "name": data_clean.get(name_key, ticker),
                "last_price": mkt['last_price'],
                "currency": currency,
                "perf_day_local": mkt['perf_local']['day'],
                "perf_day_eur": mkt['perf_eur']['day'],
                "perf_week_local": mkt['perf_eur']['week'],
                "perf_month_local": mkt['perf_eur']['month'],
                "perf_ytd_local": mkt['perf_local']['ytd'],
                "perf_ytd_eur": mkt['perf_eur']['ytd'],
                "geo_coverage": geo_coverage,
                "last_update": datetime.now().isoformat()
            }
            
            try:
                supabase.table("market_watch").upsert(payload, on_conflict='ticker').execute()
                print(f"    ✅ {ticker} synchronisé", flush=True)
            except Exception as e:
                print(f"    ❌ Erreur Supabase {ticker}: {e}", flush=True)

if __name__ == "__main__":
    print("--- 🚀 DÉMARRAGE DU PIPELINE FINANCIER ---", flush=True)
    
    # 1. Mise à jour des taux de change (EUR, USD, CHF...)
    update_currencies()
    
    # 2. Mise à jour des indicateurs Macro (VIX, Gold, Taux...)
    update_macro_hub()
    
    # 3. Synchronisation des actifs du portefeuille (Stocks, ETFs...)
    run_sync()
    
    print("--- ✅ SCRIPT TERMINÉ AVEC SUCCÈS ---", flush=True)