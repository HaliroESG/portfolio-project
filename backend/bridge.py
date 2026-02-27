import io
import json
import os
import time
import gspread
import yfinance as yf
import pandas as pd
import numpy as np
import requests
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

def fetch_fred_series(series_id):
    """
    Récupère une série FRED publique via l'endpoint CSV (pas de clé requise).
    Retourne un DataFrame trié par date, colonnes: DATE, VALUE.
    """
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    response = requests.get(url, timeout=15)
    response.raise_for_status()

    df = pd.read_csv(io.StringIO(response.text))
    if 'DATE' not in df.columns or series_id not in df.columns:
        return pd.DataFrame(columns=['DATE', 'VALUE'])

    df['DATE'] = pd.to_datetime(df['DATE'], errors='coerce')
    df['VALUE'] = pd.to_numeric(df[series_id], errors='coerce')
    df = df.dropna(subset=['DATE', 'VALUE']).sort_values('DATE').reset_index(drop=True)
    return df[['DATE', 'VALUE']]


def calculate_rsi_series(prices, period=14):
    """
    RSI standard (Wilder smoothing) à partir d'une série de prix.
    """
    delta = prices.diff()
    gains = delta.where(delta > 0, 0.0)
    losses = -delta.where(delta < 0, 0.0)

    avg_gain = gains.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def classify_trend_state(macd_line, macd_signal, rsi_14, momentum_20):
    """
    Classification de tendance:
    - BULLISH: MACD > signal, RSI >= 60, momentum > 0
    - BEARISH: MACD < signal, RSI < 40, momentum < 0
    - NEUTRAL: indicateurs présents mais sans alignement
    - INSUFFICIENT_HISTORY: indicateurs incomplets (historique insuffisant)
    """
    if None in (macd_line, macd_signal, rsi_14, momentum_20):
        return "INSUFFICIENT_HISTORY"

    if macd_line > macd_signal and rsi_14 >= 60 and momentum_20 > 0:
        return "BULLISH"
    if macd_line < macd_signal and rsi_14 < 40 and momentum_20 < 0:
        return "BEARISH"
    return "NEUTRAL"


def parse_numeric(value):
    """
    Parse robuste de champs numériques (quantités, PRU, target, etc.).
    Accepte int/float/string avec virgule, symbole %, devise.
    """
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
        cleaned = (
            value.strip()
            .replace("€", "")
            .replace("$", "")
            .replace("%", "")
            .replace(" ", "")
            .replace(",", ".")
        )
        if cleaned == "":
            return None
        try:
            return float(cleaned)
        except Exception:
            return None

    return None


def normalize_isin(value):
    """
    Normalise un ISIN (12 caractères alphanumériques).
    """
    if value is None:
        return None

    isin = str(value).strip().upper().replace(" ", "")
    if len(isin) != 12:
        return None
    if not isin.isalnum():
        return None
    return isin


def get_cached_ticker_from_isin(isin):
    """
    Lit le mapping ISIN -> ticker depuis Supabase.
    """
    try:
        response = (
            supabase
            .table("instrument_identifier_map")
            .select("ticker")
            .eq("isin", isin)
            .limit(1)
            .execute()
        )
        if response.data and len(response.data) > 0:
            cached_ticker = response.data[0].get("ticker")
            if cached_ticker:
                return str(cached_ticker).strip().upper()
    except Exception as e:
        print(f"      ⚠️ Cache ISIN indisponible pour {isin}: {e}", flush=True)
    return None


def save_isin_mapping(isin, ticker, source="YAHOO_SEARCH", confidence=0.8):
    """
    Sauvegarde le mapping ISIN -> ticker en base.
    """
    try:
        payload = {
            "isin": isin,
            "ticker": ticker,
            "source": source,
            "confidence": confidence,
            "updated_at": datetime.now().isoformat(),
        }
        supabase.table("instrument_identifier_map").upsert(payload, on_conflict="isin").execute()
    except Exception as e:
        print(f"      ⚠️ Impossible de sauvegarder le mapping ISIN {isin}: {e}", flush=True)


def resolve_ticker_from_isin(isin):
    """
    Résout un ticker exploitable Yahoo à partir d'un ISIN.
    Étapes:
    1) cache Supabase
    2) Yahoo finance search endpoint
    """
    if not isin:
        return None

    cached = get_cached_ticker_from_isin(isin)
    if cached:
        return cached

    search_url = "https://query1.finance.yahoo.com/v1/finance/search"
    try:
        response = requests.get(
            search_url,
            params={"q": isin, "quotesCount": 10, "newsCount": 0},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        quotes = payload.get("quotes", []) if isinstance(payload, dict) else []

        for quote in quotes:
            symbol = quote.get("symbol")
            quote_type = (quote.get("quoteType") or "").upper()
            if not symbol:
                continue
            if quote_type in ["EQUITY", "ETF", "MUTUALFUND", "INDEX"]:
                resolved = str(symbol).strip().upper()
                save_isin_mapping(isin, resolved, source="YAHOO_SEARCH", confidence=0.7)
                return resolved

        # fallback: prendre le premier symbole si rien de mieux
        if len(quotes) > 0 and quotes[0].get("symbol"):
            resolved = str(quotes[0].get("symbol")).strip().upper()
            save_isin_mapping(isin, resolved, source="YAHOO_SEARCH_FALLBACK", confidence=0.5)
            return resolved
    except Exception as e:
        print(f"      ⚠️ Résolution ISIN échouée ({isin}): {e}", flush=True)

    return None

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
        # Source FRED publique (CSV, sans clé)
        # Inflation YoY via CPIAUCSL, chômage via UNRATE
        cpi_df = fetch_fred_series("CPIAUCSL")
        unrate_df = fetch_fred_series("UNRATE")

        inflation_estimate = None
        unemployment_estimate = None

        if len(cpi_df) >= 13:
            latest_cpi = float(cpi_df.iloc[-1]['VALUE'])
            cpi_12m_ago = float(cpi_df.iloc[-13]['VALUE'])
            if cpi_12m_ago > 0:
                inflation_estimate = ((latest_cpi / cpi_12m_ago) - 1) * 100

        if len(unrate_df) >= 1:
            unemployment_estimate = float(unrate_df.iloc[-1]['VALUE'])

        if inflation_estimate is not None and unemployment_estimate is not None:
            misery_index = inflation_estimate + unemployment_estimate
        else:
            # Fallback conservateur si FRED indisponible/incomplet
            inflation_estimate = inflation_estimate if inflation_estimate is not None else 3.2
            unemployment_estimate = unemployment_estimate if unemployment_estimate is not None else 3.7
            misery_index = inflation_estimate + unemployment_estimate
            print("    ⚠️ Misery Index calculé en mode dégradé (données partielles FRED)", flush=True)
        
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


def calculate_data_status(last_price, last_trade_timestamp=None):
    """
    Calcule le statut de qualité des données basé sur le prix et le timestamp.
    
    Args:
        last_price: Prix actuel (peut être None, 0, ou un nombre)
        last_trade_timestamp: Timestamp du dernier trade (datetime ou None)
    
    Returns:
        'LOW_CONFIDENCE' si prix manquant/0/None
        'STALE' si dernier trade > 5 jours ouvrés mais < 10 ans (date vraiment ancienne)
        'OK' sinon
    """
    # Vérifier si le prix est valide
    if last_price is None or last_price == 0:
        return 'LOW_CONFIDENCE'
    
    # Vérifier si le timestamp est trop ancien (> 5 jours ouvrés mais < 10 ans)
    if last_trade_timestamp is not None:
        try:
            # Convertir en datetime si c'est une string ou un Timestamp pandas
            if isinstance(last_trade_timestamp, str):
                last_trade_dt = pd.to_datetime(last_trade_timestamp).to_pydatetime()
            elif hasattr(last_trade_timestamp, 'to_pydatetime'):
                # Timestamp pandas
                last_trade_dt = last_trade_timestamp.to_pydatetime()
            elif isinstance(last_trade_timestamp, pd.Timestamp):
                last_trade_dt = last_trade_timestamp.to_pydatetime()
            else:
                last_trade_dt = last_trade_timestamp
            
            # S'assurer que c'est un datetime Python
            if not isinstance(last_trade_dt, datetime):
                last_trade_dt = pd.to_datetime(last_trade_dt).to_pydatetime()
            
            # Vérifier si le timestamp est invalide (année < 2024 = probablement epoch 0 ou 1970)
            if last_trade_dt.year < 2024:
                # Timestamp invalide détecté, mais si on a un prix valide, on considère comme OK
                # (le timestamp sera corrigé dans get_financial_data)
                return 'OK'
            
            # Calculer la différence en jours calendaires
            # 5 jours ouvrés ≈ 7 jours calendaires (en comptant le week-end)
            days_diff = (datetime.now() - last_trade_dt).days
            
            # STALE seulement si > 5 jours mais < 10 ans (date vraiment ancienne mais pas invalide)
            if 7 < days_diff < (10 * 365):
                return 'STALE'
        except Exception as e:
            # Si erreur de parsing, on ne considère pas comme STALE si on a un prix valide
            # (le timestamp sera corrigé dans get_financial_data)
            print(f"      ⚠️ Erreur parsing timestamp: {e}", flush=True)
            # Si prix valide, on retourne OK (le timestamp sera corrigé)
            return 'OK'
    
    return 'OK'

def get_valuation_metrics(ticker):
    """
    Récupère les métriques de valorisation (P/E Ratio et Market Cap) avec fallbacks.
    Returns: dict avec 'pe_ratio' et 'market_cap' (peuvent être None)
    """
    pe_ratio = None
    market_cap = None
    
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # === P/E RATIO avec fallbacks ===
        # 1. Essayer trailingPE (P/E basé sur les bénéfices passés)
        if 'trailingPE' in info and info['trailingPE'] is not None:
            trailing_pe = float(info['trailingPE'])
            if trailing_pe > 0:  # Éviter les valeurs négatives ou nulles
                pe_ratio = trailing_pe
                print(f"      ✓ P/E (trailingPE): {pe_ratio:.2f}", flush=True)
        
        # 2. Fallback: forwardPE (P/E basé sur les bénéfices estimés)
        if pe_ratio is None and 'forwardPE' in info and info['forwardPE'] is not None:
            forward_pe = float(info['forwardPE'])
            if forward_pe > 0:
                pe_ratio = forward_pe
                print(f"      ✓ P/E (forwardPE): {pe_ratio:.2f}", flush=True)
        
        # 3. Fallback: Calculer depuis earningsPerShare et currentPrice
        if pe_ratio is None:
            if 'trailingEps' in info and 'currentPrice' in info:
                eps = info.get('trailingEps')
                price = info.get('currentPrice')
                if eps and price and float(eps) > 0 and float(price) > 0:
                    pe_ratio = float(price) / float(eps)
                    print(f"      ✓ P/E (calculé: price/eps): {pe_ratio:.2f}", flush=True)
            elif 'forwardEps' in info and 'currentPrice' in info:
                eps = info.get('forwardEps')
                price = info.get('currentPrice')
                if eps and price and float(eps) > 0 and float(price) > 0:
                    pe_ratio = float(price) / float(eps)
                    print(f"      ✓ P/E (calculé: price/forwardEps): {pe_ratio:.2f}", flush=True)
        
        # === MARKET CAP avec fallbacks ===
        # 1. Essayer marketCap (capitalisation boursière directe)
        if 'marketCap' in info and info['marketCap'] is not None:
            mc = float(info['marketCap'])
            if mc > 0:  # Éviter les valeurs nulles
                market_cap = mc
                print(f"      ✓ Market Cap (marketCap): {market_cap:,.0f}", flush=True)
        
        # 2. Fallback: enterpriseValue (valeur d'entreprise, proche de market cap)
        if market_cap is None and 'enterpriseValue' in info and info['enterpriseValue'] is not None:
            ev = float(info['enterpriseValue'])
            if ev > 0:
                market_cap = ev
                print(f"      ✓ Market Cap (enterpriseValue): {market_cap:,.0f}", flush=True)
        
        # 3. Fallback: Calculer depuis regularMarketPrice * sharesOutstanding
        if market_cap is None:
            price = None
            shares = None
            
            # Essayer plusieurs clés pour le prix
            for price_key in ['regularMarketPrice', 'currentPrice', 'previousClose']:
                if price_key in info and info[price_key] is not None:
                    price_val = float(info[price_key])
                    if price_val > 0:
                        price = price_val
                        break
            
            # Essayer plusieurs clés pour les actions en circulation
            for shares_key in ['sharesOutstanding', 'impliedSharesOutstanding', 'floatShares']:
                if shares_key in info and info[shares_key] is not None:
                    shares_val = float(info[shares_key])
                    if shares_val > 0:
                        shares = shares_val
                        break
            
            if price and shares and price > 0 and shares > 0:
                market_cap = price * shares
                print(f"      ✓ Market Cap (calculé: price * shares): {market_cap:,.0f}", flush=True)
        
        if pe_ratio is None:
            print(f"      ⚠️ P/E Ratio non disponible pour {ticker}", flush=True)
        if market_cap is None:
            print(f"      ⚠️ Market Cap non disponible pour {ticker}", flush=True)
            
    except Exception as e:
        print(f"      ⚠️ Erreur récupération métriques valorisation pour {ticker}: {e}", flush=True)
    
    return {
        "pe_ratio": pe_ratio,
        "market_cap": market_cap
    }

def get_financial_data(ticker, currency):
    if not ticker: return None
    print(f"    📊 Analyse financière : {ticker} ({currency})...", flush=True)
    
    try:
        # Récupérer 1 an d'historique pour MA200 (minimum 200 jours ouvrés)
        df_asset = yf.download(ticker, period="1y", progress=False)
        # Backfill si l'historique est trop court (<220 points) : on relance en 5y
        if df_asset is None or len(df_asset) < 220:
            df_asset = yf.download(ticker, period="5y", progress=False)
        if df_asset is None or df_asset.empty:
            print(f"      ⚠️ Historique indisponible pour {ticker}, skip indicateurs", flush=True)
            return None
        
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

        # Si l'historique reste trop court, retourner un paquet minimal avec état INSUFFICIENT_HISTORY
        if len(df) < 30:
            print(f"      ⚠️ Historique trop court ({len(df)} points) pour calculs complets, marquage INSUFFICIENT_HISTORY", flush=True)
            last_price_safe = float(df['price'].iloc[-1]) if len(df) > 0 else 0.0
            return {
                "last_price": last_price_safe,
                "perf_local": {"day": 0.0, "week": 0.0, "month": 0.0, "ytd": 0.0},
                "perf_eur": {"day": 0.0, "week": 0.0, "month": 0.0, "ytd": 0.0},
                "ma200_value": None,
                "ma200_status": None,
                "trend_slope": None,
                "volatility_30d": None,
                "rsi_14": None,
                "macd_line": None,
                "macd_signal": None,
                "macd_hist": None,
                "momentum_20": None,
                "trend_state": "INSUFFICIENT_HISTORY",
                "trend_changed": False,
                "pe_ratio": None,
                "market_cap": None,
                "data_status": "LOW_CONFIDENCE",
            }

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

        # 4. MACD (12,26,9)
        macd_line = None
        macd_signal = None
        macd_hist = None
        try:
            if len(df) >= 35:
                ema_12 = df['price'].ewm(span=12, adjust=False).mean()
                ema_26 = df['price'].ewm(span=26, adjust=False).mean()
                macd_series = ema_12 - ema_26
                signal_series = macd_series.ewm(span=9, adjust=False).mean()
                hist_series = macd_series - signal_series

                macd_line = float(macd_series.iloc[-1])
                macd_signal = float(signal_series.iloc[-1])
                macd_hist = float(hist_series.iloc[-1])
            else:
                print(f"      ⚠️ Pas assez de données pour MACD ({len(df)} jours)", flush=True)
        except Exception as e:
            print(f"      ⚠️ Erreur calcul MACD: {e}", flush=True)

        # 5. RSI 14
        rsi_14 = None
        try:
            if len(df) >= 15:
                rsi_series = calculate_rsi_series(df['price'], period=14)
                if pd.notna(rsi_series.iloc[-1]):
                    rsi_14 = float(rsi_series.iloc[-1])
            else:
                print(f"      ⚠️ Pas assez de données pour RSI ({len(df)} jours)", flush=True)
        except Exception as e:
            print(f"      ⚠️ Erreur calcul RSI: {e}", flush=True)

        # 6. Momentum 20 jours (%)
        momentum_20 = None
        try:
            if len(df) >= 21:
                previous_price = df['price'].iloc[-21]
                current_price = df['price'].iloc[-1]
                if previous_price and previous_price != 0:
                    momentum_20 = float(((current_price / previous_price) - 1) * 100)
            else:
                print(f"      ⚠️ Pas assez de données pour Momentum20 ({len(df)} jours)", flush=True)
        except Exception as e:
            print(f"      ⚠️ Erreur calcul Momentum20: {e}", flush=True)

        # 7. État de tendance
        trend_state = classify_trend_state(macd_line, macd_signal, rsi_14, momentum_20)

        # 8. Métriques de valorisation (P/E Ratio et Market Cap)
        valuation_metrics = get_valuation_metrics(ticker)

        # 9. Récupérer le timestamp du dernier trade depuis yfinance
        last_trade_timestamp = None
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            # Essayer plusieurs clés pour le timestamp du dernier trade
            for ts_key in ['regularMarketTime', 'lastTradeDate', 'quoteTime']:
                if ts_key in info and info[ts_key] is not None:
                    try:
                        parsed_ts = pd.to_datetime(info[ts_key])
                        # Convertir en datetime Python pour vérification
                        if hasattr(parsed_ts, 'to_pydatetime'):
                            parsed_dt = parsed_ts.to_pydatetime()
                        else:
                            parsed_dt = parsed_ts
                        
                        # Vérifier si le timestamp est valide (année >= 2024)
                        if parsed_dt.year >= 2024:
                            last_trade_timestamp = parsed_ts
                            break
                        else:
                            # Timestamp invalide (année < 2024, probablement epoch 0 ou 1970)
                            print(f"      ⚠️ Timestamp invalide détecté ({parsed_dt.year}) pour {ticker}, sera corrigé", flush=True)
                    except:
                        continue
        except Exception as e:
            print(f"      ⚠️ Impossible de récupérer le timestamp du dernier trade: {e}", flush=True)

        # Utiliser le dernier index du DataFrame comme fallback pour le timestamp
        if last_trade_timestamp is None:
            try:
                df_timestamp = df.index[-1].to_pydatetime()
                # Vérifier que le timestamp du DataFrame est valide
                if df_timestamp.year >= 2024:
                    last_trade_timestamp = df.index[-1]
                else:
                    # Timestamp du DataFrame aussi invalide, utiliser maintenant
                    print(f"      ⚠️ Timestamp du DataFrame invalide ({df_timestamp.year}) pour {ticker}, utilisation de datetime.now()", flush=True)
                    last_trade_timestamp = datetime.now()
            except:
                last_trade_timestamp = datetime.now()

        # 6. Validation finale : Si timestamp invalide mais prix valide, forcer timestamp à maintenant
        last_price = float(df['price'].iloc[-1])
        if last_price > 0:
            # Vérifier si le timestamp final est invalide
            try:
                if hasattr(last_trade_timestamp, 'to_pydatetime'):
                    ts_dt = last_trade_timestamp.to_pydatetime()
                elif isinstance(last_trade_timestamp, pd.Timestamp):
                    ts_dt = last_trade_timestamp.to_pydatetime()
                elif isinstance(last_trade_timestamp, datetime):
                    ts_dt = last_trade_timestamp
                else:
                    ts_dt = pd.to_datetime(last_trade_timestamp).to_pydatetime()
                
                # Si timestamp invalide (année < 2024) mais prix valide, forcer à maintenant
                if ts_dt.year < 2024:
                    print(f"      ℹ️ Timestamp invalide ({ts_dt.year}) mais prix valide ({last_price}), correction à datetime.now()", flush=True)
                    last_trade_timestamp = datetime.now()
            except:
                # En cas d'erreur, si prix valide, utiliser maintenant
                if last_price > 0:
                    last_trade_timestamp = datetime.now()

        # 7. Calculer le data_status avec le timestamp corrigé
        data_status = calculate_data_status(last_price, last_trade_timestamp)
        
        if data_status != 'OK':
            print(f"      ⚠️ Data Status: {data_status} (prix: {last_price}, timestamp: {last_trade_timestamp})", flush=True)

        return {
            "last_price": last_price,
            "last_trade_timestamp": last_trade_timestamp.isoformat() if isinstance(last_trade_timestamp, datetime) else str(last_trade_timestamp),
            "data_status": data_status,
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
            "volatility_30d": volatility_30d,
            "macd_line": macd_line,
            "macd_signal": macd_signal,
            "macd_hist": macd_hist,
            "rsi_14": rsi_14,
            "momentum_20": momentum_20,
            "trend_state": trend_state,
            "pe_ratio": valuation_metrics.get('pe_ratio'),
            "market_cap": valuation_metrics.get('market_cap')
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

def run_sync() -> dict:
    client = get_gspread_client()
    if not client:
        return {"assets_total": 0, "unresolved_isins": 0}

    sheet_name = os.environ.get("GSHEET_NAME")
    try:
        sh = client.open(sheet_name).sheet1
        assets = sh.get_all_records()
        print(f"✅ Feuille connectée. {len(assets)} lignes trouvées.", flush=True)
    except Exception as e:
        print(f"❌ Erreur ouverture GSheet: {e}", flush=True)
        return {"assets_total": 0, "unresolved_isins": 0}

    # Portfolio par défaut (fallback si la feuille ne fournit pas portfolio_id)
    default_portfolio_id = None
    try:
        portfolios_response = supabase.table("portfolios").select("id").limit(1).execute()
        if portfolios_response.data and len(portfolios_response.data) > 0:
            default_portfolio_id = portfolios_response.data[0].get("id")
            print(f"ℹ️ Portfolio par défaut: {default_portfolio_id}", flush=True)
    except Exception as e:
        print(f"⚠️ Impossible de récupérer le portfolio par défaut: {e}", flush=True)

    # Variables pour calculer le coverage
    total_portfolio_value = 0.0
    covered_value = 0.0  # Valeur des actifs avec status OK ou STALE
    assets_processed = []
    unresolved_isins = []

    for asset in assets:
        data_clean = {k.strip().lower(): v for k, v in asset.items()}
        keys = list(data_clean.keys())

        ticker_key = next((k for k in keys if 'ticker' in k), None)
        isin_key = next((k for k in keys if 'isin' in k), None)
        name_key = next((k for k in keys if 'nom' in k or 'name' in k), None)
        currency_key = next((k for k in keys if 'devise' in k or 'curr' in k or 'currency' in k), None)
        portfolio_key = next((k for k in keys if 'portfolio_id' in k or k == 'portfolio' or 'portfolio' in k), None)
        type_key = next((k for k in keys if k == 'type' or 'instrument' in k or 'categorie' in k or 'catégorie' in k), None)
        asset_class_key = next((k for k in keys if 'asset_class' in k or 'classe' in k), None)
        quantity_buy_key = next((k for k in keys if ('quantity_buy' in k or 'qty_buy' in k or 'achat' in k or 'buy' in k)), None)
        quantity_current_key = next((
            k for k in keys
            if (
                'quantity_current' in k or
                'qty_current' in k or
                ('quantity' in k and 'buy' not in k and 'achat' not in k) or
                ('quantite' in k and 'achat' not in k) or
                'holding' in k or
                'position' in k
            )
        ), None)
        pru_key = next((k for k in keys if 'pru' in k or 'average_cost' in k or 'avg_cost' in k), None)
        target_key = next((
            k for k in keys
            if (
                'target' in k or
                'cible' in k or
                'allocation' in k or
                ('weight' in k and 'geo' not in k and 'country' not in k and 'pays' not in k)
            )
            and 'geo' not in k and 'country' not in k and 'pays' not in k
        ), None)
        geo_key = next((
            k for k in keys
            if ('geo' in k or 'pays' in k or ('poids' in k and 'target' not in k and 'cible' not in k))
        ), None)

        raw_ticker = data_clean.get(ticker_key) if ticker_key else None
        ticker = str(raw_ticker).strip().upper() if raw_ticker is not None else ""

        isin = normalize_isin(data_clean.get(isin_key)) if isin_key else None
        if ticker == "" and isin is not None:
            print(f"    🔎 Résolution ticker via ISIN {isin}...", flush=True)
            resolved_ticker = resolve_ticker_from_isin(isin)
            if resolved_ticker:
                ticker = resolved_ticker
                print(f"      ✅ ISIN {isin} -> {ticker}", flush=True)
            else:
                unresolved_isins.append(isin)
                print(f"      ⚠️ ISIN {isin} non résolu, ligne ignorée", flush=True)
                continue

        if ticker == "":
            continue

        raw_currency = data_clean.get(currency_key, "EUR") if currency_key else "EUR"
        currency = str(raw_currency).strip().upper() if raw_currency is not None else "EUR"
        if currency == "":
            currency = "EUR"

        raw_portfolio = data_clean.get(portfolio_key) if portfolio_key else None
        row_portfolio_id = str(raw_portfolio).strip() if raw_portfolio not in [None, ""] else default_portfolio_id
        if row_portfolio_id == "":
            row_portfolio_id = default_portfolio_id

        quantity_buy = parse_numeric(data_clean.get(quantity_buy_key)) if quantity_buy_key else None
        quantity_current = parse_numeric(data_clean.get(quantity_current_key)) if quantity_current_key else None
        if quantity_current is None:
            quantity_current = parse_numeric(data_clean.get("quantity"))
        if quantity_current is None or quantity_current <= 0:
            quantity_current = 1.0

        if quantity_buy is None or quantity_buy <= 0:
            quantity_buy = quantity_current

        pru = parse_numeric(data_clean.get(pru_key)) if pru_key else None
        if pru is not None and pru <= 0:
            pru = None

        target_weight_pct = parse_numeric(data_clean.get(target_key)) if target_key else None
        if target_weight_pct is not None:
            if 0 < target_weight_pct <= 1:
                target_weight_pct = target_weight_pct * 100
            if target_weight_pct < 0:
                target_weight_pct = None

        geo_coverage = {}
        if geo_key:
            raw_geo = data_clean[geo_key]
            if isinstance(raw_geo, dict):
                for country_code, weight in raw_geo.items():
                    parsed_weight = parse_numeric(weight)
                    if parsed_weight is not None and parsed_weight > 0:
                        geo_coverage[str(country_code).upper()] = parsed_weight
            elif isinstance(raw_geo, str) and "{" in raw_geo:
                try:
                    parsed_geo = json.loads(raw_geo.replace("'", '"'))
                    if isinstance(parsed_geo, dict):
                        for country_code, weight in parsed_geo.items():
                            parsed_weight = parse_numeric(weight)
                            if parsed_weight is not None and parsed_weight > 0:
                                geo_coverage[str(country_code).upper()] = parsed_weight
                except Exception:
                    pass

        mkt = get_financial_data(ticker, currency)
        if mkt:
            if isin is not None:
                save_isin_mapping(isin, ticker, source="SHEET_OR_RESOLVER", confidence=0.9)

            # Récupérer les valeurs existantes pour éviter d'écraser des données valides
            existing_data = None
            try:
                existing_response = supabase.table("market_watch").select("pe_ratio, market_cap, data_status, trend_state").eq("ticker", ticker).execute()
                if existing_response.data and len(existing_response.data) > 0:
                    existing_data = existing_response.data[0]
            except Exception as e:
                print(f"      ⚠️ Impossible de récupérer les données existantes pour {ticker}: {e}", flush=True)
            
            # Préserver les valeurs existantes si les nouvelles sont None/0
            pe_ratio = mkt.get('pe_ratio')
            market_cap = mkt.get('market_cap')
            
            # Si la nouvelle valeur est None/0 et qu'une valeur valide existe déjà, la conserver
            if (pe_ratio is None or pe_ratio == 0) and existing_data:
                existing_pe = existing_data.get('pe_ratio')
                if existing_pe is not None and existing_pe != 0:
                    pe_ratio = existing_pe
                    print(f"      ℹ️ Conservation P/E existant: {pe_ratio:.2f}", flush=True)
            
            if (market_cap is None or market_cap == 0) and existing_data:
                existing_mc = existing_data.get('market_cap')
                if existing_mc is not None and existing_mc != 0:
                    market_cap = existing_mc
                    print(f"      ℹ️ Conservation Market Cap existant: {market_cap:,.0f}", flush=True)
            
            # Récupérer le data_status calculé (ou conserver l'existant si nouveau est LOW_CONFIDENCE et existant est OK/STALE)
            data_status = mkt.get('data_status', 'LOW_CONFIDENCE')
            if data_status == 'LOW_CONFIDENCE' and existing_data:
                existing_status = existing_data.get('data_status')
                # Ne pas dégrader un statut OK/STALE vers LOW_CONFIDENCE si on a déjà des données
                if existing_status in ['OK', 'STALE']:
                    data_status = existing_status
                    print(f"      ℹ️ Conservation data_status existant: {data_status}", flush=True)

            # Détecter les changements de tendance
            previous_trend_state = existing_data.get('trend_state') if existing_data else None
            current_trend_state = mkt.get('trend_state')
            trend_changed = (
                previous_trend_state is not None and
                current_trend_state is not None and
                previous_trend_state not in ('UNKNOWN', 'INSUFFICIENT_HISTORY') and
                current_trend_state not in ('UNKNOWN', 'INSUFFICIENT_HISTORY') and
                previous_trend_state != current_trend_state
            )

            # Type / classe depuis la feuille (si présents)
            raw_type = data_clean.get(type_key) if type_key else None
            asset_type = str(raw_type).strip().upper() if raw_type not in [None, ""] else None
            raw_asset_class = data_clean.get(asset_class_key) if asset_class_key else None
            asset_class = str(raw_asset_class).strip() if raw_asset_class not in [None, ""] else None

            # Calculer la valeur de la position pour le coverage (en EUR)
            asset_value = mkt.get('last_price', 0) * quantity_current
            # Convertir en EUR si nécessaire (approximation simple)
            if currency != "EUR":
                try:
                    fx_response = supabase.table("currencies").select("rate_to_eur").eq("id", currency).execute()
                    if fx_response.data and len(fx_response.data) > 0:
                        fx_rate = fx_response.data[0].get('rate_to_eur', 1.0)
                        asset_value_eur = asset_value * fx_rate
                    else:
                        asset_value_eur = asset_value  # Fallback: assumer 1:1
                except:
                    asset_value_eur = asset_value
            else:
                asset_value_eur = asset_value

            total_portfolio_value += asset_value_eur
            # Seuls les actifs avec status OK ou STALE comptent dans le coverage
            if data_status in ['OK', 'STALE']:
                covered_value += asset_value_eur
            
            assets_processed.append({
                'ticker': ticker,
                'value': asset_value_eur,
                'status': data_status
            })

            asset_name_raw = data_clean.get(name_key, ticker) if name_key else ticker
            asset_name = str(asset_name_raw).strip() if asset_name_raw is not None else ticker
            if asset_name == "":
                asset_name = ticker

            payload = {
                "ticker": ticker,
                "name": asset_name,
                "last_price": mkt['last_price'],
                "currency": currency,
                "quantity": quantity_current,
                "quantity_buy": quantity_buy,
                "pru": pru,
                "target_weight_pct": target_weight_pct,
                "perf_day_local": mkt['perf_local']['day'],
                "perf_day_eur": mkt['perf_eur']['day'],
                "perf_week_local": mkt['perf_eur']['week'],
                "perf_month_local": mkt['perf_eur']['month'],
                "perf_ytd_local": mkt['perf_local']['ytd'],
                "perf_ytd_eur": mkt['perf_eur']['ytd'],
                "geo_coverage": geo_coverage,
                # Indicateurs techniques
                "ma200_value": mkt.get('ma200_value'),
                "ma200_status": mkt.get('ma200_status'),
                "trend_slope": mkt.get('trend_slope'),
                "volatility_30d": mkt.get('volatility_30d'),
                "macd_line": mkt.get('macd_line'),
                "macd_signal": mkt.get('macd_signal'),
                "macd_hist": mkt.get('macd_hist'),
                "rsi_14": mkt.get('rsi_14'),
                "momentum_20": mkt.get('momentum_20'),
                "trend_state": current_trend_state,
                "trend_changed": trend_changed,
                # Métriques de valorisation (avec préservation des valeurs existantes)
                "pe_ratio": pe_ratio,
                "market_cap": market_cap,
                # Qualité des données
                "data_status": data_status,
                "last_update": datetime.now().isoformat()
            }

            if row_portfolio_id is not None:
                payload["portfolio_id"] = row_portfolio_id
            if asset_type is not None:
                payload["type"] = asset_type
            if asset_class is not None:
                payload["asset_class"] = asset_class
            
            try:
                supabase.table("market_watch").upsert(payload, on_conflict='ticker').execute()
                print(f"    ✅ {ticker} synchronisé (Status: {data_status}, P/E: {pe_ratio or 'N/A'}, Market Cap: {market_cap or 'N/A'})", flush=True)
            except Exception as e:
                print(f"    ⚠️ Erreur Supabase {ticker} (payload complet): {e}", flush=True)
                # Fallback compatibilité schéma: retry sans les nouvelles colonnes phase 2
                try:
                    fallback_payload = {k: v for k, v in payload.items() if k not in [
                        "macd_line",
                        "macd_signal",
                        "macd_hist",
                        "rsi_14",
                        "momentum_20",
                        "trend_state",
                        "trend_changed",
                        "quantity_buy",
                        "pru",
                        "target_weight_pct",
                        "portfolio_id",
                    ]}
                    supabase.table("market_watch").upsert(fallback_payload, on_conflict='ticker').execute()
                    print(f"    ✅ {ticker} synchronisé en mode compatibilité schéma", flush=True)
                except Exception as fallback_error:
                    print(f"    ❌ Erreur Supabase {ticker} (fallback): {fallback_error}", flush=True)

            # Upsert des positions détaillées (multi-portefeuille)
            if row_portfolio_id is not None:
                position_payload = {
                    "portfolio_id": row_portfolio_id,
                    "ticker": ticker,
                    "name": asset_name,
                    "instrument_type": asset_type if asset_type is not None else "STOCK",
                    "currency": currency,
                    "quantity_buy": quantity_buy,
                    "quantity_current": quantity_current,
                    "pru": pru,
                    "target_weight_pct": target_weight_pct,
                    "geo_coverage": geo_coverage,
                    "updated_at": datetime.now().isoformat(),
                }
                try:
                    supabase.table("portfolio_positions").upsert(position_payload, on_conflict='portfolio_id,ticker').execute()
                except Exception as position_error:
                    print(f"    ⚠️ Positions non synchronisées pour {ticker} (table absente ou schéma incomplet): {position_error}", flush=True)
    
    unresolved_unique = []
    if len(unresolved_isins) > 0:
        unresolved_unique = sorted(list(set(unresolved_isins)))
        print(f"--- ⚠️ ISIN NON RÉSOLUS ({len(unresolved_unique)}) ---", flush=True)
        for unresolved in unresolved_unique:
            print(f"    - {unresolved}", flush=True)

    # Calculer et enregistrer le coverage_pct dans valuation_snapshots
    coverage_pct = None
    if total_portfolio_value > 0:
        coverage_pct = (covered_value / total_portfolio_value) * 100
        print(f"--- 📊 COVERAGE DU PORTEFEUILLE ---", flush=True)
        print(f"    Valeur totale: {total_portfolio_value:,.2f} EUR", flush=True)
        print(f"    Valeur couverte (OK/STALE): {covered_value:,.2f} EUR", flush=True)
        print(f"    Coverage: {coverage_pct:.2f}%", flush=True)
        
        # Récupérer le premier portfolio_id disponible depuis la table portfolios
        portfolio_id = default_portfolio_id
        if portfolio_id is None:
            try:
                portfolios_response = supabase.table("portfolios").select("id").limit(1).execute()
                if portfolios_response.data and len(portfolios_response.data) > 0:
                    portfolio_id = portfolios_response.data[0].get("id")
                    print(f"    ℹ️ Portfolio ID récupéré: {portfolio_id}", flush=True)
                else:
                    print(f"    ⚠️ Aucun portfolio trouvé dans la table portfolios, snapshot ignoré", flush=True)
            except Exception as e:
                print(f"    ⚠️ Erreur lors de la récupération du portfolio_id: {e}", flush=True)
                print(f"    ⚠️ Snapshot ignoré pour éviter un crash", flush=True)
        
        # Insérer le snapshot seulement si un portfolio_id a été trouvé
        if portfolio_id:
            try:
                snapshot_payload = {
                    "portfolio_id": portfolio_id,
                    "snapshot_date": datetime.now().date().isoformat(),
                    "total_value_eur": total_portfolio_value,
                    "covered_value_eur": covered_value,
                    "coverage_pct": coverage_pct,
                    "assets_count": len(assets_processed),
                    "created_at": datetime.now().isoformat()
                }
                supabase.table("valuation_snapshots").insert(snapshot_payload).execute()
                print(f"    ✅ Snapshot enregistré dans valuation_snapshots (portfolio_id: {portfolio_id})", flush=True)
            except Exception as e:
                print(f"    ⚠️ Erreur enregistrement snapshot: {e}", flush=True)
        else:
            print(f"    ⚠️ Snapshot non enregistré (portfolio_id manquant)", flush=True)
    else:
        print(f"    ⚠️ Aucune valeur de portefeuille à calculer", flush=True)

    status_counts = {"OK": 0, "STALE": 0, "LOW_CONFIDENCE": 0, "PARTIAL": 0}
    for asset in assets_processed:
        status = asset.get("status")
        if status in status_counts:
            status_counts[status] += 1

    return {
        "assets_total": len(assets_processed),
        "coverage_pct": coverage_pct,
        "status_ok": status_counts["OK"],
        "status_stale": status_counts["STALE"],
        "status_low_confidence": status_counts["LOW_CONFIDENCE"],
        "status_partial": status_counts["PARTIAL"],
        "unresolved_isins": len(unresolved_unique),
    }

# --- ETL RUN LOGGING ---
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
        print(f"⚠️ Impossible de démarrer etl_runs: {e}", flush=True)
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
        print(f"⚠️ Impossible de clôturer etl_runs: {e}", flush=True)

if __name__ == "__main__":
    print("--- 🚀 DÉMARRAGE DU PIPELINE FINANCIER ---", flush=True)
    job_name = "bridge_sync"
    started = time.time()
    run_id = start_etl_run(job_name)
    try:
        # 1. Mise à jour des taux de change (EUR, USD, CHF...)
        update_currencies()

        # 2. Mise à jour des indicateurs Macro (VIX, Gold, Taux...)
        update_macro_hub()

        # 3. Synchronisation des actifs du portefeuille (Stocks, ETFs...)
        stats = run_sync()

        finish_etl_run(run_id, "SUCCESS", time.time() - started, stats=stats)
        print("--- ✅ SCRIPT TERMINÉ AVEC SUCCÈS ---", flush=True)
    except Exception as e:
        finish_etl_run(run_id, "FAILED", time.time() - started, error=str(e))
        raise
