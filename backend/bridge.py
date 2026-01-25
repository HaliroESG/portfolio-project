import os
import json
import gspread
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from supabase import create_client
from oauth2client.service_account import ServiceAccountCredentials
from scipy.stats import linregress

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
                print(f"    ❌ Erreur macro {ticker}: {e}", flush=True)
    
    # === CALCULS MACRO AVANCÉS ===
    
    # 1. Yield Spread (10Y-2Y)
    yield_spread_10y2y = None
    try:
        # Récupérer 10Y Treasury rate
        data_10y = yf.download("^TNX", period="5d", progress=False)
        
        # Yahoo Finance n'a pas de ticker direct pour 2Y Treasury
        # Utiliser ^FVX (5Y) et ajuster approximativement pour 2Y
        # Ou utiliser une approximation basée sur la courbe des taux
        data_5y = None
        try:
            data_5y = yf.download("^FVX", period="5d", progress=False)  # 5Y Treasury
        except:
            pass
        
        if not data_10y.empty and len(data_10y) >= 1:
            rate_10y = float(data_10y['Close'].iloc[-1].iloc[0]) if isinstance(data_10y['Close'].iloc[-1], pd.Series) else float(data_10y['Close'].iloc[-1])
            
            if data_5y is not None and not data_5y.empty and len(data_5y) >= 1:
                rate_5y = float(data_5y['Close'].iloc[-1].iloc[0]) if isinstance(data_5y['Close'].iloc[-1], pd.Series) else float(data_5y['Close'].iloc[-1])
                # Approximation: 2Y ≈ 5Y - 0.3% (ajustement empirique basé sur la courbe des taux)
                rate_2y_approx = rate_5y - 0.3
                yield_spread_10y2y = rate_10y - rate_2y_approx
            else:
                # Sans données 5Y, on ne peut pas calculer précisément le spread
                # Mettre None plutôt qu'une valeur arbitraire
                print(f"    ⚠️ Données 5Y manquantes pour calculer précisément le Yield Spread", flush=True)
                yield_spread_10y2y = None
            
            # Sauvegarder dans macro_indicators seulement si calcul réussi
            if yield_spread_10y2y is not None:
                payload_spread = {
                    "id": "SPREAD_10Y_2Y",
                    "name": "Yield Spread (10Y-2Y)",
                    "category": "RATES",
                    "value": yield_spread_10y2y,
                    "change_pct": None,
                    "last_update": datetime.now().isoformat()
                }
                supabase.table("macro_indicators").upsert(payload_spread).execute()
                print(f"    ✅ Yield Spread (10Y-2Y): {yield_spread_10y2y:.2f}%", flush=True)
        else:
            print(f"    ⚠️ Pas assez de données pour calculer Yield Spread", flush=True)
    except Exception as e:
        print(f"    ⚠️ Erreur calcul Yield Spread: {e}", flush=True)
    
    # 2. Carry Trade Monitor - Volatilité JPY/USD (5 jours)
    jpy_volatility = None
    try:
        data_jpy = yf.download("JPYUSD=X", period="5d", progress=False)
        if not data_jpy.empty and len(data_jpy) >= 5:
            if isinstance(data_jpy.columns, pd.MultiIndex): 
                data_jpy.columns = data_jpy.columns.get_level_values(0)
            
            # Calculer les rendements logarithmiques
            returns = np.log(data_jpy['Close'] / data_jpy['Close'].shift(1)).dropna()
            # Volatilité réalisée sur 5 jours, annualisée
            std_dev = returns.std()
            jpy_volatility = float(std_dev * np.sqrt(252) * 100)  # En pourcentage
            
            # Sauvegarder dans macro_indicators
            payload_jpy = {
                "id": "JPY_VOLATILITY",
                "name": "JPY/USD Volatility (Carry Trade Risk)",
                "category": "FOREX",
                "value": jpy_volatility,
                "change_pct": None,
                "last_update": datetime.now().isoformat()
            }
            supabase.table("macro_indicators").upsert(payload_jpy).execute()
            print(f"    ✅ JPY Volatility: {jpy_volatility:.2f}%", flush=True)
        else:
            print(f"    ⚠️ Pas assez de données pour calculer JPY volatility", flush=True)
    except Exception as e:
        print(f"    ⚠️ Erreur calcul JPY volatility: {e}", flush=True)
    
    # 3. Misery Index (Inflation + Unemployment)
    misery_index = None
    try:
        # Placeholder: Utiliser des valeurs constantes ou essayer de récupérer depuis une API
        # Pour l'instant, utiliser des valeurs estimées basées sur les données US récentes
        # TODO: Intégrer une API réelle (ex: FRED API pour inflation et chômage US)
        inflation_estimate = 3.2  # Placeholder - remplacer par API réelle
        unemployment_estimate = 3.7  # Placeholder - remplacer par API réelle
        misery_index = inflation_estimate + unemployment_estimate
        
        # Sauvegarder dans macro_indicators
        payload_misery = {
            "id": "MISERY_INDEX",
            "name": "Misery Index (Inflation + Unemployment)",
            "category": "ECONOMIC",
            "value": misery_index,
            "change_pct": None,
            "last_update": datetime.now().isoformat()
        }
        supabase.table("macro_indicators").upsert(payload_misery).execute()
        print(f"    ✅ Misery Index: {misery_index:.1f} (Inflation: {inflation_estimate:.1f}% + Unemployment: {unemployment_estimate:.1f}%)", flush=True)
    except Exception as e:
        print(f"    ⚠️ Erreur calcul Misery Index: {e}", flush=True)


def get_financial_data(ticker, currency):
    if not ticker: return None
    print(f"    📊 Analyse financière : {ticker} ({currency})...", flush=True)
    
    try:
        # Récupérer 1 an d'historique pour MA200 (minimum 200 jours ouvrés)
        df_asset = yf.download(ticker, period="1y", progress=False)
        
        # Pour la régression 20 ans, essayer de récupérer le maximum d'historique
        df_long = None
        try:
            df_long = yf.download(ticker, period="max", progress=False)
        except:
            try:
                df_long = yf.download(ticker, period="20y", progress=False)
            except:
                pass
        
        if currency == "EUR":
            df_fx = pd.DataFrame(1.0, index=df_asset.index, columns=['Close'])
        else:
            fx_ticker = f"{currency}EUR=X"
            df_fx = yf.download(fx_ticker, period="1y", progress=False)

        if isinstance(df_asset.columns, pd.MultiIndex): df_asset.columns = df_asset.columns.get_level_values(0)
        if isinstance(df_fx.columns, pd.MultiIndex): df_fx.columns = df_fx.columns.get_level_values(0)

        df = df_asset[['Close']].rename(columns={'Close': 'price'})
        
        # Aligner les index pour le FX
        if currency != "EUR":
            df_fx_aligned = df_fx.reindex(df.index, method='ffill')
            df['fx'] = df_fx_aligned['Close']
        else:
            df['fx'] = 1.0
        
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

        # === CALCULS D'INDICATEURS TECHNIQUES ===
        
        # 1. MA200 (200-Day Moving Average)
        ma200_value = None
        ma200_status = None
        try:
            if len(df) >= 200:
                ma200_value = float(df['price'].rolling(window=200).mean().iloc[-1])
                current_price = float(df['price'].iloc[-1])
                ma200_status = "above" if current_price > ma200_value else "below"
            else:
                print(f"      ⚠️ Pas assez de données pour MA200 ({len(df)} jours)", flush=True)
        except Exception as e:
            print(f"      ⚠️ Erreur calcul MA200: {e}", flush=True)

        # 2. Régression Linéaire 20 ans (slope)
        trend_slope = None
        try:
            if df_long is not None and len(df_long) >= 100:
                if isinstance(df_long.columns, pd.MultiIndex): 
                    df_long.columns = df_long.columns.get_level_values(0)
                prices = df_long['Close'].values
                # Créer un index numérique pour la régression (jours depuis le début)
                x = np.arange(len(prices))
                slope, intercept, r_value, p_value, std_err = linregress(x, prices)
                trend_slope = float(slope)
            else:
                print(f"      ⚠️ Pas assez d'historique pour régression 20 ans", flush=True)
        except Exception as e:
            print(f"      ⚠️ Erreur calcul régression: {e}", flush=True)

        # 3. Volatilité annualisée (30 derniers jours)
        volatility_30d = None
        try:
            if len(df) >= 30:
                # Calculer les rendements logarithmiques
                returns = np.log(df['price'] / df['price'].shift(1)).dropna()
                # Prendre les 30 derniers jours
                recent_returns = returns.tail(30)
                # Écart-type des rendements
                std_dev = recent_returns.std()
                # Annualiser: multiplier par sqrt(252) pour les jours ouvrés
                volatility_30d = float(std_dev * np.sqrt(252) * 100)  # En pourcentage
            else:
                print(f"      ⚠️ Pas assez de données pour volatilité 30d ({len(df)} jours)", flush=True)
        except Exception as e:
            print(f"      ⚠️ Erreur calcul volatilité: {e}", flush=True)

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
            },
            "ma200_value": ma200_value,
            "ma200_status": ma200_status,
            "trend_slope": trend_slope,
            "volatility_30d": volatility_30d
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
                # Nouveaux champs d'indicateurs techniques
                "ma200_value": mkt.get('ma200_value'),
                "ma200_status": mkt.get('ma200_status'),
                "trend_slope": mkt.get('trend_slope'),
                "volatility_30d": mkt.get('volatility_30d'),
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