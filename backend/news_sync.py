import json
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import feedparser
import requests
from supabase import create_client

print("--- 📰 DÉMARRAGE DE LA SYNCHRONISATION DES ACTUALITÉS ---", flush=True)


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

# === CHARGEMENT DE LA CONFIGURATION D'IMPACT ===
def load_impact_rules():
    """Charge les règles d'impact depuis impact_rules.json."""
    try:
        # Trouve le dossier où se trouve le script (robuste pour GitHub Actions)
        script_dir = Path(__file__).parent.resolve()
        json_path = script_dir / "impact_rules.json"
        
        # Log pour débogage (utile dans GitHub Actions)
        if not json_path.exists():
            print(f"⚠️ Fichier JSON non trouvé à: {json_path}", flush=True)
            print(f"   Répertoire courant: {os.getcwd()}", flush=True)
            print(f"   Répertoire du script: {script_dir}", flush=True)
            print(f"   Liste des fichiers dans le répertoire: {list(script_dir.iterdir())}", flush=True)
        
        with open(json_path, "r", encoding="utf-8") as f:
            rules = json.load(f)
        
        high_count = len(rules.get("high_impact", {}).get("keywords", []))
        medium_count = len(rules.get("medium_impact", {}).get("keywords", []))
        official_count = len(rules.get("official_sources", {}).get("sources", []))
        
        print(f"✅ Rules loaded: {high_count} high-impact keywords, {medium_count} medium-impact keywords, {official_count} official sources", flush=True)
        
        return rules
    except FileNotFoundError as e:
        print(f"❌ ERREUR : Fichier impact_rules.json introuvable: {e}", flush=True)
        print(f"   Chemin recherché: {json_path if 'json_path' in locals() else 'N/A'}", flush=True)
        print("   Utilisation des règles par défaut...", flush=True)
        # Fallback vers une structure minimale
        return {
            "high_impact": {"score_range": [70, 100], "keywords": []},
            "medium_impact": {"score_range": [40, 69], "keywords": []},
            "official_sources": {"score": 95, "sources": []}
        }
    except Exception as e:
        print(f"❌ ERREUR : Impossible de charger impact_rules.json: {e}", flush=True)
        print("   Utilisation des règles par défaut...", flush=True)
        # Fallback vers une structure minimale
        return {
            "high_impact": {"score_range": [70, 100], "keywords": []},
            "medium_impact": {"score_range": [40, 69], "keywords": []},
            "official_sources": {"score": 95, "sources": []}
        }

IMPACT_RULES = load_impact_rules()

# 1. RÉCUPÉRATION DES VARIABLES
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
MARKETAUX_API_KEY = os.environ.get("MARKETAUX_API_KEY")  # Optionnel, fallback si non fourni

# 2. CHECK DE SÉCURITÉ
if not SUPABASE_URL:
    print("❌ ERREUR : SUPABASE_URL manquant", flush=True)
    exit(1)
if not SUPABASE_KEY:
    print("❌ ERREUR : SUPABASE_KEY manquant", flush=True)
    exit(1)

# 3. INITIALISATION SUPABASE
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ Client Supabase connecté.", flush=True)
except Exception as e:
    print(f"❌ Crash Supabase : {e}", flush=True)
    exit(1)

# === CONFIGURATION DES SOURCES RSS ===
# Note: Si l'URL ECB échoue, le script continuera avec Fed uniquement grâce au try/except
RSS_SOURCES = [
    {
        "url": "https://www.federalreserve.gov/feeds/press_all.xml",
        "source": "Federal Reserve",
        "category": "MACRO"
    },
    {
        "url": "https://www.ecb.europa.eu/home/html/rss.en.html",
        "source": "ECB",
        "category": "MACRO"
    }
]

# === FONCTION DE CALCUL D'IMPACT BASÉE SUR JSON ===
def calculate_impact(title: str, description: str, source: str) -> dict:
    """
    Calcule l'impact d'une news basé sur les règles JSON.
    Returns: {
        "impact_level": "HIGH" | "MEDIUM" | "LOW",
        "impact_score": int (0-100),
        "impact_explanation": str
    }
    """
    text = (title + " " + (description or "")).lower()
    source_normalized = source.upper()
    
    # 1. Vérifier si la source est officielle
    official_sources = [s.upper() for s in IMPACT_RULES.get("official_sources", {}).get("sources", [])]
    if source_normalized in official_sources:
        official_score = IMPACT_RULES.get("official_sources", {}).get("score", 95)
        return {
            "impact_level": "HIGH",
            "impact_score": official_score,
            "impact_explanation": f"Source officielle: {source}"
        }
    
    # 2. Parcourir les keywords HIGH IMPACT
    high_keywords = IMPACT_RULES.get("high_impact", {}).get("keywords", [])
    for keyword in high_keywords:
        if keyword.lower() in text:
            score_range = IMPACT_RULES.get("high_impact", {}).get("score_range", [70, 100])
            score = random.randint(score_range[0], score_range[1])
            return {
                "impact_level": "HIGH",
                "impact_score": score,
                "impact_explanation": f"Détection mot-clé: {keyword}"
            }
    
    # 3. Parcourir les keywords MEDIUM IMPACT
    medium_keywords = IMPACT_RULES.get("medium_impact", {}).get("keywords", [])
    for keyword in medium_keywords:
        if keyword.lower() in text:
            score_range = IMPACT_RULES.get("medium_impact", {}).get("score_range", [40, 69])
            score = random.randint(score_range[0], score_range[1])
            return {
                "impact_level": "MEDIUM",
                "impact_score": score,
                "impact_explanation": f"Détection mot-clé: {keyword}"
            }
    
    # 4. Aucun match -> LOW IMPACT (pour ne pas polluer le Ticker Tape)
    return {
        "impact_level": "LOW",
        "impact_score": 10,
        "impact_explanation": "Aucun mot-clé détecté"
    }

def extract_ticker_from_text(text: str) -> str | None:
    """
    Extrait un ticker potentiel du texte (format: TICKER ou $TICKER).
    Retourne None si aucun ticker n'est trouvé.
    """
    # Pattern pour trouver des tickers (3-5 lettres majuscules, optionnellement précédé de $)
    pattern = r'\$?([A-Z]{3,5})\b'
    matches = re.findall(pattern, text.upper())
    
    if matches:
        # Retourner le premier match qui semble être un ticker
        return matches[0]
    return None

def fetch_news_from_rss(rss_config: dict) -> list:
    """
    Récupère les actualités depuis un flux RSS.
    Retourne TOUJOURS une liste (jamais None) pour éviter les erreurs d'itération.
    """
    news_items = []
    
    try:
        # Ajouter User-Agent pour éviter les erreurs 403 (Fed/ECB)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        # Utiliser requests.get() avec headers avant de parser avec feedparser
        response = requests.get(rss_config["url"], headers=headers, timeout=10)
        response.raise_for_status()
        feed = feedparser.parse(response.content)
        
        if feed.bozo and feed.bozo_exception:
            print(f"    ⚠️ Erreur parsing RSS {rss_config['source']}: {feed.bozo_exception}", flush=True)
            return news_items
        
        for entry in feed.entries[:20]:  # Limiter à 20 articles par source
            title = entry.get("title", "")
            description = entry.get("description", "") or entry.get("summary", "")
            link = entry.get("link", "")
            published = entry.get("published_parsed")
            
            if not link:
                continue
            
            # Calculer l'impact basé sur les règles JSON
            impact_result = calculate_impact(
                title,
                description,
                rss_config["source"]
            )
            
            # Extraire le ticker si possible
            ticker = extract_ticker_from_text(title + " " + description)
            
            # Formater la date
            published_date = None
            if published:
                try:
                    published_date = datetime(*published[:6]).isoformat()
                except:
                    published_date = datetime.now().isoformat()
            else:
                published_date = datetime.now().isoformat()
            
            news_items.append({
                "url": link,
                "title": title,
                "description": description[:500] if description else None,  # Limiter à 500 caractères
                "source": rss_config["source"],
                "category": rss_config["category"],
                "ticker": ticker,
                "impact_score": impact_result["impact_score"],
                "impact_level": impact_result["impact_level"],
                "impact_explanation": impact_result["impact_explanation"],
                "published_at": published_date,
                "last_update": datetime.now().isoformat()
            })
        
        print(f"    ✅ {rss_config['source']}: {len(news_items)} articles récupérés", flush=True)
        
    except Exception as e:
        print(f"    ❌ Erreur RSS {rss_config['source']}: {e}", flush=True)
        # Retourner une liste vide au lieu de None en cas d'erreur
        return []
    
    # S'assurer qu'on retourne toujours une liste (jamais None)
    return news_items if news_items else []

def fetch_news_from_marketaux(tickers: list[str]) -> list:
    """
    Récupère les actualités depuis l'API Marketaux pour une liste de tickers (batching).
    Limite à 10 tickers par requête pour respecter les limites API.
    Retourne TOUJOURS une liste (jamais None) pour éviter les erreurs d'itération.
    """
    news_items = []
    
    if not MARKETAUX_API_KEY:
        print(f"    ⚠️ MARKETAUX_API_KEY non configurée, skip pour {len(tickers)} tickers", flush=True)
        return []  # Retourner explicitement une liste vide
    
    if not tickers:
        return []  # Retourner explicitement une liste vide
    
    try:
        # API Marketaux: https://marketaux.com/documentation
        # Supporte plusieurs tickers séparés par des virgules
        url = "https://api.marketaux.com/v1/news/all"
        
        # Joindre les tickers avec des virgules (max 10 par requête)
        symbols_str = ",".join(tickers[:10])  # Limiter à 10 tickers
        
        params = {
            "symbols": symbols_str,
            "api_token": MARKETAUX_API_KEY,
            "limit": 50,  # Augmenter la limite car on a plusieurs tickers
            "filter_entities": True,
            "language": "en"  # Filtrer les résultats en anglais
        }
        
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        if "data" in data and data["data"]:
            for article in data["data"]:
                title = article.get("title", "")
                description = article.get("description", "")
                url_link = article.get("url", "")
                published = article.get("published_at", "")
                entities = article.get("entities", [])  # Liste d'entités liées à l'article
                
                if not url_link:
                    continue
                
                # Extraire le ticker depuis le champ entities (au lieu d'utiliser l'argument)
                # Les entities contiennent des objets avec des symboles de tickers
                extracted_ticker = None
                if entities and len(entities) > 0:
                    # Prendre le premier symbole trouvé dans les entities
                    first_entity = entities[0]
                    if isinstance(first_entity, dict) and "symbol" in first_entity:
                        extracted_ticker = first_entity["symbol"]
                    elif isinstance(first_entity, str):
                        extracted_ticker = first_entity
                
                # Fallback : si aucun ticker trouvé dans entities, utiliser le premier ticker de la requête
                if not extracted_ticker and tickers:
                    extracted_ticker = tickers[0]
                
                # Calculer l'impact basé sur les règles JSON
                impact_result = calculate_impact(
                    title,
                    description,
                    "MARKETAUX"
                )
                
                # Formater la date
                published_date = published if published else datetime.now().isoformat()
                
                news_items.append({
                    "url": url_link,
                    "title": title,
                    "description": description[:500] if description else None,
                    "source": "MARKETAUX",
                    "category": "EQUITY",  # News liées aux tickers = EQUITY
                    "ticker": extracted_ticker,  # Ticker extrait depuis entities
                    "impact_score": impact_result["impact_score"],
                    "impact_level": impact_result["impact_level"],
                    "impact_explanation": impact_result["impact_explanation"],
                    "published_at": published_date,
                    "last_update": datetime.now().isoformat()
                })
        
        print(f"    ✅ Marketaux (batch de {len(tickers[:10])} tickers): {len(news_items)} articles récupérés", flush=True)
        
        # Retourner explicitement la liste (jamais None)
        return news_items if news_items else []
        
    except requests.exceptions.HTTPError as e:
        if e.response and e.response.status_code == 402:
            print(f"    ⚠️ Quota Marketaux atteint pour aujourd'hui, passage à la suite.", flush=True)
            # Retourner une liste vide pour continuer le script sans crash
            # Le script continuera vers les étapes de nettoyage
            return []
        else:
            print(f"    ⚠️ Erreur HTTP Marketaux pour {len(tickers)} tickers: {e}", flush=True)
            # Continuer même en cas d'erreur HTTP
            return []
    except Exception as e:
        print(f"    ⚠️ Erreur Marketaux pour {len(tickers)} tickers: {e}", flush=True)
        # Continuer même en cas d'erreur
        return []

def cleanup_old_news() -> int:
    """Supprime les news de plus de 7 jours."""
    try:
        cutoff_date = (datetime.now() - timedelta(days=7)).isoformat()
        
        # Supprimer les news plus anciennes que 7 jours
        result = supabase.table("news_feed").delete().lt("published_at", cutoff_date).execute()
        
        if result.data:
            print(f"    🗑️ {len(result.data)} articles supprimés (>7 jours)", flush=True)
            return len(result.data)
        else:
            print(f"    ✅ Aucun article à supprimer", flush=True)
            return 0
    except Exception as e:
        print(f"    ⚠️ Erreur nettoyage: {e}", flush=True)
        return 0

def sync_news() -> dict:
    """Synchronise toutes les actualités depuis les sources RSS et Marketaux."""
    print("--- SYNCHRONISATION DES ACTUALITÉS ---", flush=True)
    
    all_news = []
    rss_count = 0
    marketaux_count = 0
    
    # 1. Récupérer les actualités depuis les sources RSS (Macro)
    print("--- SOURCES RSS (MACRO) ---", flush=True)
    for rss_config in RSS_SOURCES:
        try:
            news_items = fetch_news_from_rss(rss_config)
            # Vérifier que news_items n'est pas None et est une liste avant d'étendre
            if news_items and isinstance(news_items, list):
                all_news.extend(news_items)
                rss_count += len(news_items)
            else:
                print(f"    ⚠️ Aucune news récupérée depuis {rss_config['source']}", flush=True)
        except Exception as e:
            print(f"    ⚠️ Erreur lors de la récupération RSS {rss_config['source']}: {e}", flush=True)
            # Continuer avec les autres sources même si une échoue
            continue
    
    # 2. Récupérer les tickers depuis market_watch et fetch depuis Marketaux (OPTIMISÉ: 10 tickers max)
    print("--- SOURCE MARKETAUX (TICKERS) ---", flush=True)
    try:
        # Récupérer tous les tickers uniques depuis market_watch
        response = supabase.table("market_watch").select("ticker").execute()
        
        if response.data:
            tickers = list(set([item["ticker"] for item in response.data if item.get("ticker")]))
            print(f"    📊 {len(tickers)} tickers trouvés dans market_watch", flush=True)
            
            # Optimisation quota : Limiter à 10 tickers seulement pour éviter l'erreur 402
            limited_tickers = tickers[:10]
            print(f"    📦 Traitement de {len(limited_tickers)} tickers (limite quota): {', '.join(limited_tickers)}", flush=True)
            
            # Un seul appel batch pour les 10 tickers
            news_items = fetch_news_from_marketaux(limited_tickers)
            # Vérifier que news_items n'est pas None et n'est pas vide avant d'étendre
            if news_items and isinstance(news_items, list):
                all_news.extend(news_items)
                marketaux_count += len(news_items)
            else:
                print(f"    ⚠️ Aucune news récupérée pour le batch de {len(limited_tickers)} tickers", flush=True)
            
            if len(tickers) > 10:
                print(f"    ℹ️ {len(tickers) - 10} tickers ignorés pour respecter le quota API", flush=True)
        else:
            print("    ⚠️ Aucun ticker trouvé dans market_watch", flush=True)
            
    except Exception as e:
        print(f"    ⚠️ Erreur récupération tickers: {e}", flush=True)
        # Continuer même si la récupération des tickers échoue
    
    # Dédupliquer par URL et upsert dans Supabase
    seen_urls = set()
    unique_news = []
    
    for news in all_news:
        url = news["url"]
        if url not in seen_urls:
            seen_urls.add(url)
            unique_news.append(news)
    
    print(f"--- UPSERT DE {len(unique_news)} ARTICLES UNIQUES ---", flush=True)
    
    # Upsert par batch pour optimiser
    batch_size = 10
    for i in range(0, len(unique_news), batch_size):
        batch = unique_news[i:i + batch_size]
        
        try:
            # Upsert avec URL comme clé unique
            for news_item in batch:
                payload = {
                    "url": news_item["url"],
                    "title": news_item["title"],
                    "description": news_item["description"],
                    "source": news_item["source"],
                    "category": news_item["category"],
                    "ticker": news_item["ticker"],
                    "impact_score": news_item["impact_score"],
                    "impact_level": news_item["impact_level"],
                    "published_at": news_item["published_at"],
                    "last_update": news_item["last_update"]
                }
                
                # Ajouter impact_explanation si disponible (optionnel pour compatibilité)
                if "impact_explanation" in news_item:
                    payload["impact_explanation"] = news_item["impact_explanation"]
                
                supabase.table("news_feed").upsert(payload, on_conflict="url").execute()
            
            print(f"    ✅ Batch {i//batch_size + 1}: {len(batch)} articles synchronisés", flush=True)
            
        except Exception as e:
            print(f"    ❌ Erreur upsert batch {i//batch_size + 1}: {e}", flush=True)
    
    # 3. Nettoyage : Supprimer les news de plus de 7 jours
    print("--- NETTOYAGE DES ANCIENNES NEWS ---", flush=True)
    deleted_count = cleanup_old_news()
    
    print(f"--- ✅ SYNCHRONISATION TERMINÉE: {len(unique_news)} articles ---", flush=True)
    return {
        "rss_count": rss_count,
        "marketaux_count": marketaux_count,
        "unique_count": len(unique_news),
        "deleted_count": deleted_count,
    }

if __name__ == "__main__":
    job_name = "news_sync"
    started = time.time()
    run_id = start_etl_run(job_name)
    try:
        stats = sync_news()
        finish_etl_run(run_id, "SUCCESS", time.time() - started, stats=stats)
        print("--- ✅ SCRIPT TERMINÉ AVEC SUCCÈS ---", flush=True)
    except Exception as e:
        finish_etl_run(run_id, "FAILED", time.time() - started, error=str(e))
        raise
