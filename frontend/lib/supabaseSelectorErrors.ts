interface SupabaseSelectorError {
  code?: string | null
  message?: string | null
}

export function isSelectorSchemaError(error: SupabaseSelectorError | null): boolean {
  const code = error?.code ?? ''
  const message = (error?.message ?? '').toLowerCase()

  if (code === '42703' || code === 'PGRST204' || code === 'PGRST100') return true

  return message.includes('column') && message.includes('does not exist')
}
