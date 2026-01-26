import { Asset, MarketRegion, CurrencyPair } from '../types';

// ETF Constituents Mapping - Format: { CodePays: Pourcentage }
// Les totaux doivent idéalement s'approcher de 100
export const ETF_CONSTITUENTS: Record<string, Record<string, number>> = {
  IWDA: { 'US': 70.2, 'JP': 6.1, 'GB': 3.9, 'FR': 3.2, 'DE': 2.5, 'CA': 3.1, 'CH': 2.8, 'AU': 2.1, 'NL': 1.2, 'SE': 1.0 },
  EEM: { 'CN': 26.5, 'IN': 17.2, 'BR': 5.4, 'MX': 2.8, 'ZA': 3.1, 'TW': 15.8, 'KR': 12.2, 'SA': 4.2, 'TH': 2.1, 'ID': 1.9 },
  IEUR: { 'GB': 22.5, 'FR': 18.2, 'DE': 14.8, 'CH': 14.1, 'NL': 7.2, 'SE': 5.1, 'IT': 4.5, 'ES': 3.9, 'DK': 4.5, 'FI': 1.5 },
  SPY: { 'US': 100 },
  VGK: { 'GB': 25.0, 'FR': 18.5, 'DE': 16.0, 'CH': 15.0, 'NL': 8.0 }
};

const generatePerformance = () => ({
  value: Math.random() * 20 - 8, // Entre -8% et +12%
  currencyImpact: Math.random() * 6 - 3 // Entre -3% et +3%
});

export const mockAssets: Asset[] = [
  {
    id: '1',
    name: 'iShares Core MSCI World',
    ticker: 'IWDA',
    price: 88.45,
    currency: 'EUR',
    type: 'ETF',
    constituents: ETF_CONSTITUENTS['IWDA'],
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '2',
    name: 'Vanguard S&P 500',
    ticker: 'VOO',
    price: 412.3,
    currency: 'USD',
    type: 'ETF',
    constituents: ETF_CONSTITUENTS['SPY'],
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '3',
    name: 'iShares MSCI Emerging',
    ticker: 'EEM',
    price: 38.9,
    currency: 'USD',
    type: 'ETF',
    constituents: ETF_CONSTITUENTS['EEM'],
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '4',
    name: 'Apple Inc.',
    ticker: 'AAPL',
    price: 178.35,
    currency: 'USD',
    type: 'STOCK',
    constituents: { 'US': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '5',
    name: 'Novo Nordisk',
    ticker: 'NOVO-B',
    price: 920.5,
    currency: 'DKK',
    type: 'STOCK',
    constituents: { 'DK': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '6',
    name: 'LVMH Moët Hennessy',
    ticker: 'MC',
    price: 715.4,
    currency: 'EUR',
    type: 'STOCK',
    constituents: { 'FR': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '7',
    name: 'Toyota Motor',
    ticker: '7203',
    price: 2850.0,
    currency: 'JPY',
    type: 'STOCK',
    constituents: { 'JP': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '8',
    name: 'Samsung Electronics',
    ticker: '005930',
    price: 72500,
    currency: 'KRW',
    type: 'STOCK',
    constituents: { 'KR': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '9',
    name: 'Nestlé S.A.',
    ticker: 'NESN',
    price: 98.45,
    currency: 'CHF',
    type: 'STOCK',
    constituents: { 'CH': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  },
  {
    id: '10',
    name: 'ASML Holding',
    ticker: 'ASML',
    price: 890.2,
    currency: 'EUR',
    type: 'STOCK',
    constituents: { 'NL': 100 },
    performance: {
      day: generatePerformance(),
      week: generatePerformance(),
      month: generatePerformance(),
      ytd: generatePerformance()
    }
  }
];

export const mockRegions: MarketRegion[] = [
  { id: 'us', name: 'United States', code: 'US', value: 100, performance: 12.4, exposure: 4500000, coordinates: [-95.7129, 37.0902] },
  { id: 'fr', name: 'France', code: 'FR', value: 26.7, performance: 5.2, exposure: 1200000, coordinates: [2.2137, 46.2276] },
  { id: 'jp', name: 'Japan', code: 'JP', value: 33.3, performance: -1.8, exposure: 1500000, coordinates: [138.2529, 36.2048] },
  { id: 'cn', name: 'China', code: 'CN', value: 40.0, performance: 3.5, exposure: 1800000, coordinates: [104.1954, 35.8617] },
  { id: 'gb', name: 'United Kingdom', code: 'GB', value: 20.0, performance: 2.1, exposure: 900000, coordinates: [-3.436, 55.3781] },
  { id: 'de', name: 'Germany', code: 'DE', value: 24.4, performance: 4.8, exposure: 1100000, coordinates: [10.4515, 51.1657] },
  { id: 'in', name: 'India', code: 'IN', value: 13.3, performance: 8.5, exposure: 600000, coordinates: [78.9629, 20.5937] },
  { id: 'br', name: 'Brazil', code: 'BR', value: 8.9, performance: -3.2, exposure: 400000, coordinates: [-51.9253, -14.235] },
  { id: 'au', name: 'Australia', code: 'AU', value: 16.7, performance: 1.5, exposure: 750000, coordinates: [133.7751, -25.2744] },
  { id: 'za', name: 'South Africa', code: 'ZA', value: 4.4, performance: -5.4, exposure: 200000, coordinates: [22.9375, -30.5595] }
];

export const mockCurrencyPairs: CurrencyPair[] = [
  { id: 'USD', symbol: '$', rate_to_eur: 0.9234 },
  { id: 'GBP', symbol: '£', rate_to_eur: 1.1689 },
  { id: 'CHF', symbol: '₣', rate_to_eur: 1.0452 },
  { id: 'JPY', symbol: '¥', rate_to_eur: 0.0062 }
];