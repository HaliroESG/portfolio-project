import { supabase } from './supabase'

export class CommandApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_COMMAND_API_URL
  if (!base) throw new CommandApiError('Command API is not configured', 503)
  return `${base.replace(/\/$/, '')}${path}`
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
  const token = await accessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID(),
  }
  if (!options.formData) headers['Content-Type'] = 'application/json'
  const response = await fetch(apiUrl(path), {
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
  const token = await accessToken()
  const response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new CommandApiError('Export failed', response.status)
  return response.blob()
}
