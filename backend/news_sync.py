import os
import re
import feedparser
import requests
from datetime import datetime
from supabase import create_client
from urllib.parse import urlparse

print("--- 📰 DÉMARRAGE DE LA SYNCHRONISATION DES ACTUALITÉS ---", flush=True)

# 1. RÉCUPÉRATION DES VARIABLES
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

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
RSS_SOURCES = [
    {
        "url": "https://www.federalreserve.gov/feeds/press.xml",
        "source": "FED",
        "category": "MACRO",
        "force_high_impact": True
    },
    {
        "url": "https://www.ecb.europa.eu/press/shared/rss/press.xml",
        "source": "ECB",
        "category": "MACRO",
        "force_high_impact": True
    }
]

# === MOTS-CLÉS POUR LE SCORING D'IMPACT ===
HIGH_IMPACT_KEYWORDS = [
    "profit warning", "earnings", "merger", "acquisition", "takeover",
    "sec investigation", "rate decision", "interest rate", "federal reserve",
    "ecb decision", "monetary policy", "quantitative easing", "tapering"
]

MEDIUM_IMPACT_KEYWORDS = [
    "upgrade", "downgrade", "dividend", "buyback", "partnership",
    "expansion", "contract", "guidance", "forecast"
]

def calculate_impact_score(title: str, description: str, source: str, force_high: bool = False) -> int:
    """
    Calcule un score d'impact basé sur les mots-clés et la source.
    Returns: 0-100 (HIGH: 70-100, MEDIUM: 40-69, LOW: 0-39)
    """
    if force_high:
        return 85  # Force HIGH pour les sources officielles
    
    text = (title + " " + (description or "")).lower()
    
    # Compter les occurrences de mots-clés HIGH
    high_count = sum(1 for keyword in HIGH_IMPACT_KEYWORDS if keyword in text)
    medium_count = sum(1 for keyword in MEDIUM_IMPACT_KEYWORDS if keyword in text)
    
    # Calcul du score
    base_score = 30  # Score de base
    high_score = high_count * 25  # Chaque mot-clé HIGH ajoute 25 points
    medium_score = medium_count * 10  # Chaque mot-clé MEDIUM ajoute 10 points
    
    total_score = base_score + high_score + medium_score
    
    # Limiter entre 0 et 100
    return min(100, max(0, total_score))

def get_impact_level(score: int) -> str:
    """Détermine le niveau d'impact basé sur le score."""
    if score >= 70:
        return "HIGH"
    elif score >= 40:
        return "MEDIUM"
    else:
        return "LOW"

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
    """Récupère les actualités depuis un flux RSS."""
    news_items = []
    
    try:
        feed = feedparser.parse(rss_config["url"])
        
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
            
            # Calculer le score d'impact
            impact_score = calculate_impact_score(
                title,
                description,
                rss_config["source"],
                rss_config.get("force_high_impact", False)
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
                "impact_score": impact_score,
                "impact_level": get_impact_level(impact_score),
                "published_at": published_date,
                "last_update": datetime.now().isoformat()
            })
        
        print(f"    ✅ {rss_config['source']}: {len(news_items)} articles récupérés", flush=True)
        
    except Exception as e:
        print(f"    ❌ Erreur RSS {rss_config['source']}: {e}", flush=True)
    
    return news_items

def sync_news():
    """Synchronise toutes les actualités depuis les sources RSS."""
    print("--- SYNCHRONISATION DES ACTUALITÉS ---", flush=True)
    
    all_news = []
    
    # Récupérer les actualités depuis chaque source RSS
    for rss_config in RSS_SOURCES:
        news_items = fetch_news_from_rss(rss_config)
        all_news.extend(news_items)
    
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
                
                supabase.table("news_feed").upsert(payload, on_conflict="url").execute()
            
            print(f"    ✅ Batch {i//batch_size + 1}: {len(batch)} articles synchronisés", flush=True)
            
        except Exception as e:
            print(f"    ❌ Erreur upsert batch {i//batch_size + 1}: {e}", flush=True)
    
    print(f"--- ✅ SYNCHRONISATION TERMINÉE: {len(unique_news)} articles ---", flush=True)

if __name__ == "__main__":
    sync_news()
    print("--- ✅ SCRIPT TERMINÉ AVEC SUCCÈS ---", flush=True)
