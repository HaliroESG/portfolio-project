export function publicationDate(value: string): Date {
  return new Date(`${value}T12:00:00`)
}

export function publicationDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function publicationMonthGrid(month: Date): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const leading = (first.getDay() + 6) % 7
  const values: Array<Date | null> = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= last.getDate(); day += 1) {
    values.push(new Date(month.getFullYear(), month.getMonth(), day))
  }
  while (values.length % 7 !== 0) values.push(null)
  return values
}

export function matchesPublicationSearch(values: Array<string | null | undefined>, search: string): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase('fr')
  if (!normalizedSearch) return true
  return values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('fr')
    .includes(normalizedSearch)
}
