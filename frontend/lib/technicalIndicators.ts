export type TrendState = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export interface TechnicalSnapshot {
  macdLine: number | null
  macdSignal: number | null
  macdHist: number | null
  rsi14: number | null
  momentum20: number | null
  trendState: TrendState
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || Number.isNaN(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function calculateEMA(values: number[], period: number): Array<number | null> {
  if (period <= 0) return values.map(() => null)
  const result: Array<number | null> = []
  const multiplier = 2 / (period + 1)
  let ema: number | null = null

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!Number.isFinite(value)) {
      result.push(null)
      continue
    }

    if (ema === null) {
      ema = value
    } else {
      ema = (value - ema) * multiplier + ema
    }

    result.push(index >= period - 1 ? ema : null)
  }

  return result
}

export function calculateMACD(
  values: number[],
  shortPeriod = 12,
  longPeriod = 26,
  signalPeriod = 9,
): {
  macdLine: Array<number | null>
  signalLine: Array<number | null>
  histogram: Array<number | null>
} {
  const emaShort = calculateEMA(values, shortPeriod)
  const emaLong = calculateEMA(values, longPeriod)
  const macdLine = values.map((_, index) => {
    const shortValue = emaShort[index]
    const longValue = emaLong[index]
    if (shortValue === null || longValue === null) return null
    return shortValue - longValue
  })

  const macdForSignal = macdLine.map((value) => value ?? 0)
  const rawSignal = calculateEMA(macdForSignal, signalPeriod)
  const signalLine = rawSignal.map((value, index) => {
    if (index < longPeriod + signalPeriod - 2) return null
    return value
  })

  const histogram = macdLine.map((value, index) => {
    const signal = signalLine[index]
    if (value === null || signal === null) return null
    return value - signal
  })

  return { macdLine, signalLine, histogram }
}

export function calculateRSI(values: number[], period = 14): Array<number | null> {
  if (values.length === 0) return []
  if (period <= 1) return values.map(() => null)

  const result: Array<number | null> = values.map(() => null)
  const gains = values.map(() => 0)
  const losses = values.map(() => 0)

  for (let i = 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1]
    gains[i] = change > 0 ? change : 0
    losses[i] = change < 0 ? Math.abs(change) : 0
  }

  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period && i < values.length; i += 1) {
    avgGain += gains[i]
    avgLoss += losses[i]
  }

  if (values.length > period) {
    avgGain /= period
    avgLoss /= period
    const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss
    result[period] = 100 - 100 / (1 + rs)
  }

  for (let i = period + 1; i < values.length; i += 1) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss
    result[i] = 100 - 100 / (1 + rs)
  }

  return result
}

export function calculateMomentum(values: number[], period = 20): Array<number | null> {
  return values.map((value, index) => {
    if (index < period) return null
    const previous = values[index - period]
    if (!Number.isFinite(previous) || previous === 0) return null
    return ((value / previous) - 1) * 100
  })
}

export function resolveTrendState(
  macdLine: number | null,
  macdSignal: number | null,
  rsi14: number | null,
  momentum20: number | null,
  rsiBullThreshold = 60,
): TrendState {
  if (
    macdLine !== null &&
    macdSignal !== null &&
    rsi14 !== null &&
    momentum20 !== null
  ) {
    const bullish = macdLine > macdSignal && rsi14 >= rsiBullThreshold && momentum20 > 0
    if (bullish) return 'BULLISH'

    const bearish = macdLine < macdSignal && rsi14 < 40 && momentum20 < 0
    if (bearish) return 'BEARISH'
  }

  return 'NEUTRAL'
}

export function buildTechnicalSnapshot(
  values: number[],
  rsiBullThreshold = 60,
): TechnicalSnapshot {
  const { macdLine, signalLine, histogram } = calculateMACD(values)
  const rsi = calculateRSI(values)
  const momentum = calculateMomentum(values)

  const lastIndex = values.length - 1
  const macdValue = macdLine[lastIndex] ?? null
  const signalValue = signalLine[lastIndex] ?? null
  const histogramValue = histogram[lastIndex] ?? null
  const rsiValue = rsi[lastIndex] ?? null
  const momentumValue = momentum[lastIndex] ?? null

  return {
    macdLine: round(macdValue),
    macdSignal: round(signalValue),
    macdHist: round(histogramValue),
    rsi14: round(rsiValue, 2),
    momentum20: round(momentumValue, 2),
    trendState: resolveTrendState(macdValue, signalValue, rsiValue, momentumValue, rsiBullThreshold),
  }
}
