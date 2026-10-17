import type { PublicationReadReceipt } from '../types'

type Row = Record<string, unknown>
type Page = { data: unknown[] | null; error: unknown; count: number | null }

// A server-side row cap can be smaller than the requested page. Never infer
// exhaustion from a short page. Callers must order by a stable unique key.
export async function readPublicationPages(
  fetchPage: (offset: number, end: number) => PromiseLike<Page>,
  key: string,
  maxPages = 100,
): Promise<{ rows: Row[]; receipt: PublicationReadReceipt }> {
  const rows: Row[] = []
  const seen = new Set<string>()
  const reasons = new Set<string>()
  let offset = 0, expected: number | null = null, pages = 0, exhausted = false
  for (; pages < maxPages;) {
    let response: Page
    try { response = await fetchPage(offset, offset + 999) }
    catch (error) {
      if (pages === 0) throw error
      reasons.add('PAGE_READ_FAILED'); break
    }
    pages++
    if (response.error) {
      if (pages === 1) throw response.error
      reasons.add('PAGE_READ_FAILED'); break
    }
    const count = response.count ?? null
    if (count !== null && (!Number.isInteger(count) || count < 0)) reasons.add('INVALID_COUNT')
    else if (pages === 1) expected = count
    else if (count !== expected) reasons.add('COUNT_CHANGED')
    if (!Array.isArray(response.data)) { reasons.add('INVALID_PAYLOAD'); break }
    const page = response.data
    if (!page.length) {
      exhausted = true
      if (expected !== null && offset !== expected) reasons.add('PREMATURE_END')
      break
    }
    let added = 0
    for (const raw of page) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { reasons.add('INVALID_ROW'); continue }
      const row = raw as Row
      const id = row?.[key]
      if (typeof id !== 'string' || !id) { reasons.add('INVALID_KEY'); continue }
      if (seen.has(id)) { reasons.add('DUPLICATE_KEY'); continue }
      seen.add(id); rows.push(row); added++
    }
    offset += page.length
    if (expected !== null && offset >= expected) {
      exhausted = true
      if (offset !== expected) reasons.add('COUNT_MISMATCH')
      break
    }
    if (!added) { reasons.add('NO_PROGRESS'); break }
  }
  if (!exhausted) reasons.add('INCOMPLETE_READ')
  if (expected !== null && rows.length !== expected) reasons.add('COUNT_MISMATCH')
  return { rows, receipt: { state: reasons.size ? 'PARTIAL' : 'COMPLETE', expected, received: rows.length, pages, reasons: [...reasons] } }
}

export function parsedReceipt(receipt: PublicationReadReceipt, received: number): PublicationReadReceipt {
  return received === receipt.received ? receipt : {
    ...receipt, state: 'PARTIAL', received, reasons: [...receipt.reasons, 'INVALID_ROWS'],
  }
}
