import type { DisplayPricePoint } from './priceHistory'
import type { RegressionScaleMode } from '../types'

export const REGRESSION_MIN_POINTS = 30
export const MA200_WINDOW = 200

export interface RegressionChartPoint {
  date: string
  price: number
  regression: number
  plus1: number | null
  plus2: number | null
  minus1: number | null
  minus2: number | null
  ma200: number | null
}

export interface RegressionChartModel {
  points: RegressionChartPoint[]
  scaleMode: RegressionScaleMode
  sigma: number
  latestZScore: number | null
  annualizedSlopePct: number | null
  firstDate: string
  lastDate: string
  latestPrice: number
  latestRegression: number
}

function dateToMs(value: string): number | null {
  const parsed = new Date(value)
  const time = parsed.getTime()
  return Number.isFinite(time) ? time : null
}

function toModelValue(price: number, scaleMode: RegressionScaleMode): number {
  return scaleMode === 'LOG' ? Math.log(price) : price
}

function fromModelValue(value: number, scaleMode: RegressionScaleMode): number | null {
  const price = scaleMode === 'LOG' ? Math.exp(value) : value
  return Number.isFinite(price) && price > 0 ? price : null
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function computeMovingAverage(
  points: DisplayPricePoint[],
  windowSize = MA200_WINDOW,
): Array<number | null> {
  const result: Array<number | null> = []
  let rollingSum = 0

  points.forEach((point, index) => {
    rollingSum += point.price
    if (index >= windowSize) {
      rollingSum -= points[index - windowSize].price
    }
    result.push(index >= windowSize - 1 ? rollingSum / windowSize : null)
  })

  return result
}

export function computeRegressionChartModel(
  inputPoints: DisplayPricePoint[],
  scaleMode: RegressionScaleMode,
): RegressionChartModel | null {
  const points = inputPoints
    .map((point) => {
      const time = dateToMs(point.date)
      if (time === null || point.price <= 0 || !Number.isFinite(point.price)) return null
      return { ...point, time }
    })
    .filter((point): point is DisplayPricePoint & { time: number } => point !== null)

  if (points.length < REGRESSION_MIN_POINTS) return null

  const firstTime = points[0].time
  const xs = points.map((point) => (point.time - firstTime) / 86_400_000)
  const ys = points.map((point) => toModelValue(point.price, scaleMode))
  const xMean = average(xs)
  const yMean = average(ys)
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0)
  if (denominator <= 0) return null

  const numerator = xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index] - yMean), 0)
  const slope = numerator / denominator
  const intercept = yMean - slope * xMean
  const predictedYs = xs.map((x) => intercept + slope * x)
  const residuals = ys.map((y, index) => y - predictedYs[index])
  const sigma = Math.sqrt(residuals.reduce((sum, residual) => sum + residual ** 2, 0) / Math.max(points.length - 2, 1))
  const ma200 = computeMovingAverage(points)

  const chartPoints = points.map((point, index): RegressionChartPoint | null => {
    const predicted = predictedYs[index]
    const regression = fromModelValue(predicted, scaleMode)
    if (regression === null) return null
    return {
      date: point.date,
      price: point.price,
      regression,
      plus1: fromModelValue(predicted + sigma, scaleMode),
      plus2: fromModelValue(predicted + sigma * 2, scaleMode),
      minus1: fromModelValue(predicted - sigma, scaleMode),
      minus2: fromModelValue(predicted - sigma * 2, scaleMode),
      ma200: ma200[index],
    }
  }).filter((point): point is RegressionChartPoint => point !== null)

  if (chartPoints.length < REGRESSION_MIN_POINTS) return null

  const latestIndex = points.length - 1
  const latestRegression = chartPoints[chartPoints.length - 1].regression
  const latestZScore = sigma > 0 ? residuals[latestIndex] / sigma : null
  const annualizedSlopePct =
    scaleMode === 'LOG'
      ? (Math.exp(slope * 365.25) - 1) * 100
      : latestRegression > 0
        ? ((slope * 365.25) / latestRegression) * 100
        : null

  return {
    points: chartPoints,
    scaleMode,
    sigma,
    latestZScore: latestZScore !== null && Number.isFinite(latestZScore) ? latestZScore : null,
    annualizedSlopePct: Number.isFinite(annualizedSlopePct) ? annualizedSlopePct : null,
    firstDate: chartPoints[0].date,
    lastDate: chartPoints[chartPoints.length - 1].date,
    latestPrice: chartPoints[chartPoints.length - 1].price,
    latestRegression,
  }
}
