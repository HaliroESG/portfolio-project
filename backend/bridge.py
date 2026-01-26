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

        # 4. Métriques de valorisation (P/E Ratio et Market Cap)
        valuation_metrics = get_valuation_metrics(ticker)

        # 5. Récupérer le timestamp du dernier trade depuis yfinance
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

    # Variables pour calculer le coverage
    total_portfolio_value = 0.0
    covered_value = 0.0  # Valeur des actifs avec status OK ou STALE
    assets_processed = []

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
            # Récupérer les valeurs existantes pour éviter d'écraser des données valides
            existing_data = None
            try:
                existing_response = supabase.table("market_watch").select("pe_ratio, market_cap, data_status").eq("ticker", ticker).execute()
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
            
            # Calculer la valeur de l'actif pour le coverage (en EUR)
            asset_value = mkt.get('last_price', 0)
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
                # Indicateurs techniques
                "ma200_value": mkt.get('ma200_value'),
                "ma200_status": mkt.get('ma200_status'),
                "trend_slope": mkt.get('trend_slope'),
                "volatility_30d": mkt.get('volatility_30d'),
                # Métriques de valorisation (avec préservation des valeurs existantes)
                "pe_ratio": pe_ratio,
                "market_cap": market_cap,
                # Qualité des données
                "data_status": data_status,
                "last_update": datetime.now().isoformat()
            }
            
            try:
                supabase.table("market_watch").upsert(payload, on_conflict='ticker').execute()
                print(f"    ✅ {ticker} synchronisé (Status: {data_status}, P/E: {pe_ratio or 'N/A'}, Market Cap: {market_cap or 'N/A'})", flush=True)
            except Exception as e:
                print(f"    ❌ Erreur Supabase {ticker}: {e}", flush=True)
    
    # Calculer et enregistrer le coverage_pct dans valuation_snapshots
    if total_portfolio_value > 0:
        coverage_pct = (covered_value / total_portfolio_value) * 100
        print(f"--- 📊 COVERAGE DU PORTEFEUILLE ---", flush=True)
        print(f"    Valeur totale: {total_portfolio_value:,.2f} EUR", flush=True)
        print(f"    Valeur couverte (OK/STALE): {covered_value:,.2f} EUR", flush=True)
        print(f"    Coverage: {coverage_pct:.2f}%", flush=True)
        
        try:
            snapshot_payload = {
                "snapshot_date": datetime.now().date().isoformat(),
                "total_value_eur": total_portfolio_value,
                "covered_value_eur": covered_value,
                "coverage_pct": coverage_pct,
                "assets_count": len(assets_processed),
                "created_at": datetime.now().isoformat()
            }
            supabase.table("valuation_snapshots").insert(snapshot_payload).execute()
            print(f"    ✅ Snapshot enregistré dans valuation_snapshots", flush=True)
        except Exception as e:
            print(f"    ⚠️ Erreur enregistrement snapshot: {e}", flush=True)
    else:
        print(f"    ⚠️ Aucune valeur de portefeuille à calculer", flush=True)

if __name__ == "__main__":
    print("--- 🚀 DÉMARRAGE DU PIPELINE FINANCIER ---", flush=True)
    
    # 1. Mise à jour des taux de change (EUR, USD, CHF...)
    update_currencies()
    
    # 2. Mise à jour des indicateurs Macro (VIX, Gold, Taux...)
    update_macro_hub()
    
    # 3. Synchronisation des actifs du portefeuille (Stocks, ETFs...)
    run_sync()
    
    print("--- ✅ SCRIPT TERMINÉ AVEC SUCCÈS ---", flush=True)