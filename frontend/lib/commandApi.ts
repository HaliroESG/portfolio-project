import { supabase } from './supabase'
import { commandAvailability } from './commandAvailability'

export class CommandApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function apiUrl(path: string): string {
  const availability = commandAvailability({
    commandApiUrl: process.env.NEXT_PUBLIC_COMMAND_API_URL,
    familyOfficeEnvironment: process.env.NEXT_PUBLIC_FAMILY_OFFICE_ENVIRONMENT,
    vercelEnvironment: process.env.NEXT_PUBLIC_VERCEL_ENV,
  })
  if (availability.status !== 'ENABLED') {
    throw new CommandApiError(availability.message, availability.httpStatus)
  }
  return `${availability.baseUrl}${path}`
}

async function accessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new CommandApiError('Authenticated session required', 401)
  return data.session.access_token
}

export async function command<T>(
  path: string,
  options: {
    method?: 'POST' | 'PATCH'
    body?: unknown
    formData?: FormData
    idempotencyKey?: string
  } = {}
): Promise<T> {
  const url = apiUrl(path)
  const token = await accessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID(),
  }
  if (!options.formData) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers,
    body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) {
    throw new CommandApiError(
      typeof payload.detail === 'string' ? payload.detail : 'Command failed',
      response.status
    )
  }
  return payload as T
}

export async function authenticatedDownload(path: string): Promise<Blob> {
  const url = apiUrl(path)
  const token = await accessToken()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new CommandApiError('Export failed', response.status)
  return response.blob()
}
