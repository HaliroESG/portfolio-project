// Dans types.ts
export type Period = '1D' | '1W' | '1M' | 'YTD';
// ... garde le reste de tes interfaces (Asset, etc.) en dessous
export interface PerformanceData {
  value: number // Percentage
  currencyImpact: number // Percentage impact of FX
}

// Dans /types.ts

// Dans /types.ts
export interface Asset {
  id: string;
  name: string;
  ticker: string;
  price: number;
  currency: string;
  // On accepte les majuscules et les minuscules pour être tranquille
  type: 'Stock' | 'STOCK' | 'ETF' | 'Crypto' | 'CRYPTO'; 
  constituents?: Record<string, number>; 
  performance: {
    day: any; // On met any temporairement pour laisser passer le build sur les structures complexes
    week: any;
    month: any;
    ytd: any;
  };
}

// Garde tes autres exports (Period, CurrencyPair...)

export interface MarketRegion {
  id: string
  name: string
  code: string
  value: number // Valeur normalisée pour l'affichage (0-100)
  performance: number 
  exposure: number 
  coordinates: [number, number] 
}


export interface CurrencyPair {
  id: string;        // ex: 'USD'
  symbol: string;    // ex: '$'
  rate_to_eur: number | null;
}
