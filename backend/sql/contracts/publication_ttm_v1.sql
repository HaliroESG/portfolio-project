-- L3 offline contract query ONLY. Not a migration, view replacement or writer.
-- The test harness supplies one JSON array at the marker; no live database.
WITH input_rows AS (
  SELECT value AS raw FROM jsonb_array_elements(/*INPUT_JSON*/)
), rows AS (
  SELECT r.*, dates.period_start, dates.period_end, coalesce(
    raw ?& ARRAY['instrument_key','fiscal_year','period_kind','period_start','period_end','currency','basis','calendar_basis','definition','scope','source_ref','revenue','ebitda','operating_income','net_income','free_cash_flow']
    AND raw - ARRAY['instrument_key','fiscal_year','period_kind','period_start','period_end','currency','basis','calendar_basis','definition','scope','source_ref','revenue','ebitda','operating_income','net_income','free_cash_flow'] = '{}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(raw) e WHERE
      (e.key IN ('revenue','ebitda','operating_income','net_income','free_cash_flow') AND jsonb_typeof(e.value) NOT IN ('number','null'))
      OR (e.key NOT IN ('revenue','ebitda','operating_income','net_income','free_cash_flow','fiscal_year') AND jsonb_typeof(e.value) NOT IN ('string','null')))
    AND jsonb_typeof(raw->'fiscal_year') = 'number'
    AND raw->>'fiscal_year' ~ '^[0-9]{4}$', false) AS input_valid
  FROM input_rows CROSS JOIN LATERAL jsonb_to_record(raw) AS r(
    instrument_key text, fiscal_year integer, period_kind text,
    currency text, basis text,
    calendar_basis text, definition text, scope text, source_ref text,
    revenue double precision, ebitda double precision,
    operating_income double precision, net_income double precision,
    free_cash_flow double precision)
  CROSS JOIN LATERAL (
    -- Never let PostgreSQL's permissive date input qualify noncanonical text.
    -- Build from safe parts, then round-trip to reject impossible civil dates.
    SELECT
      max(parsed) FILTER (WHERE name = 'period_start' AND to_char(parsed, 'YYYY-MM-DD') = value) AS period_start,
      max(parsed) FILTER (WHERE name = 'period_end' AND to_char(parsed, 'YYYY-MM-DD') = value) AS period_end
    FROM (VALUES ('period_start', raw->>'period_start'),
                 ('period_end', raw->>'period_end')) AS parts(name, value)
    CROSS JOIN LATERAL (
      SELECT CASE WHEN length(value) = 10
        AND value ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        AND left(value, 4) <> '0000'
        THEN make_date(left(value, 4)::integer, substring(value, 6, 2)::integer, 1)
          + (right(value, 2)::integer - 1)
      END AS parsed
    ) AS normalized
  ) AS dates
), ordered AS (
  SELECT *, lag(period_end) OVER w AS previous_end,
    lag(fiscal_year * 4 + CASE WHEN period_kind ~ '^Q[1-4]$' THEN right(period_kind, 1)::integer END) OVER w AS previous_slot,
    row_number() OVER w AS position
  FROM rows WINDOW w AS (ORDER BY period_start NULLS FIRST)
), checked AS (
  SELECT *, coalesce(
    input_valid AND instrument_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:=\-]{0,127}$' AND currency ~ '^[A-Z]{3}$'
    AND definition IS NOT NULL AND scope IS NOT NULL AND source_ref IS NOT NULL
    AND source_ref <> '' AND instrument_key <> '' AND definition <> '' AND scope <> ''
    AND definition ~ '^[A-Za-z0-9][A-Za-z0-9_.:=\-]{0,127}$'
    AND scope ~ '^[A-Za-z0-9][A-Za-z0-9_.:=\-]{0,127}$'
    AND source_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:=\-]{0,127}$'
    AND basis = 'DISCRETE' AND period_kind ~ '^Q[1-4]$'
    AND fiscal_year BETWEEN 1900 AND 9999
    AND period_start <= period_end
    AND CASE calendar_basis
      WHEN 'CALENDAR' THEN extract(day FROM period_start) = 1
        AND period_end = (period_start + interval '3 months - 1 day')::date
      WHEN 'WEEK_52_53' THEN period_end - period_start + 1 IN (84, 91, 98)
      ELSE false END
    AND (position = 1 OR (period_start = previous_end + 1
      AND fiscal_year * 4 + CASE WHEN period_kind ~ '^Q[1-4]$' THEN right(period_kind, 1)::integer END = previous_slot + 1)), false) AS valid
  FROM ordered
), totals AS (
  SELECT count(*) = 4 AND coalesce(bool_and(valid), false)
    AND count(DISTINCT instrument_key) = 1 AND count(DISTINCT currency) = 1
    AND count(DISTINCT definition) = 1 AND count(DISTINCT scope) = 1
    AND count(DISTINCT calendar_basis) = 1
    AND (min(calendar_basis) <> 'WEEK_52_53' OR max(period_end) - min(period_start) + 1 IN (364, 371)) AS complete,
    min(currency) AS currency, min(period_start) AS period_start, max(period_end) AS period_end,
    CASE WHEN count(revenue) = 4 AND bool_and(abs(revenue) <= 9007199254740991) AND abs(sum(revenue ORDER BY period_start, period_end)) <= 9007199254740991 THEN sum(revenue ORDER BY period_start, period_end) END AS revenue,
    CASE WHEN count(ebitda) = 4 AND bool_and(abs(ebitda) <= 9007199254740991) AND abs(sum(ebitda ORDER BY period_start, period_end)) <= 9007199254740991 THEN sum(ebitda ORDER BY period_start, period_end) END AS ebitda,
    CASE WHEN count(operating_income) = 4 AND bool_and(abs(operating_income) <= 9007199254740991) AND abs(sum(operating_income ORDER BY period_start, period_end)) <= 9007199254740991 THEN sum(operating_income ORDER BY period_start, period_end) END AS operating_income,
    CASE WHEN count(net_income) = 4 AND bool_and(abs(net_income) <= 9007199254740991) AND abs(sum(net_income ORDER BY period_start, period_end)) <= 9007199254740991 THEN sum(net_income ORDER BY period_start, period_end) END AS net_income,
    CASE WHEN count(free_cash_flow) = 4 AND bool_and(abs(free_cash_flow) <= 9007199254740991) AND abs(sum(free_cash_flow ORDER BY period_start, period_end)) <= 9007199254740991 THEN sum(free_cash_flow ORDER BY period_start, period_end) END AS free_cash_flow
  FROM checked
), masked AS (
  SELECT complete, CASE WHEN complete THEN currency END AS currency,
    CASE WHEN complete THEN period_start END AS period_start,
    CASE WHEN complete THEN period_end END AS period_end,
    CASE WHEN complete THEN revenue END AS revenue,
    CASE WHEN complete THEN ebitda END AS ebitda,
    CASE WHEN complete THEN operating_income END AS operating_income,
    CASE WHEN complete THEN net_income END AS net_income,
    CASE WHEN complete THEN free_cash_flow END AS free_cash_flow
  FROM totals
)
SELECT row_to_json(result) FROM (
  SELECT *, array_remove(ARRAY[
    CASE WHEN NOT complete THEN 'INCOMPARABLE_QUARTERS' END,
    CASE WHEN revenue IS NULL THEN 'REVENUE_UNAVAILABLE' END,
    CASE WHEN ebitda IS NULL THEN 'EBITDA_UNAVAILABLE' END,
    CASE WHEN operating_income IS NULL THEN 'OPERATING_INCOME_UNAVAILABLE' END,
    CASE WHEN net_income IS NULL THEN 'NET_INCOME_UNAVAILABLE' END,
    CASE WHEN free_cash_flow IS NULL THEN 'FREE_CASH_FLOW_UNAVAILABLE' END
  ], NULL) AS reason_codes FROM masked
) result;
