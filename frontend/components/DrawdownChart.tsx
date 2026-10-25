import type { LineSeries } from './BacktestChart'
import { FullscreenChartButton } from './FullscreenChart'
import { FinancialKpiNotice } from './FinancialKpiNotice'

interface DrawdownChartProps {
  dates: string[]
  series: LineSeries[]
  title?: string
}

// Retain the metric's place and selected scope. Plotting legacy values or nulls
// converted to zero would falsely show a financially qualified drawdown curve.
export function DrawdownChart({ dates, series, title = 'Drawdown' }: DrawdownChartProps) {
  const context = { start_date: dates[0], end_date: dates[dates.length - 1], portfolio_key: series.map(item => item.label).join(' / ') }
  const renderChartSvg = (heightClass: string) => (
    <svg viewBox="0 0 720 200" className={`w-full ${heightClass}`} role="img" aria-label="Drawdown non qualifié : aucune courbe calculée affichée">
      <text x="24" y="100" className="fill-current text-sm">Drawdown non qualifié — calcul et historique à qualifier</text>
    </svg>
  )
  return (
    <section className="rounded-3xl border-2 border-slate-200 bg-white p-6 dark:border-white/5 dark:bg-[#0D1117]/50">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black">{title}</h3><FullscreenChartButton title={title}><FinancialKpiNotice family="BACKTEST" context={context} />{renderChartSvg('h-auto')}</FullscreenChartButton></div>
      <FinancialKpiNotice family="BACKTEST" context={context} />
      <p className="mt-3 text-xs text-slate-500">La courbe reprendra après qualification des flux, des prix et des conversions historiques.</p>
    </section>
  )
}
