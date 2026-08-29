export interface PublicCommandEnvironment {
  commandApiUrl?: string
  familyOfficeEnvironment?: string
  vercelEnvironment?: string
}

export type CommandAvailability =
  | { status: 'ENABLED'; baseUrl: string }
  | { status: 'DISABLED_PRODUCTION' | 'UNCONFIGURED'; httpStatus: 503; message: string }

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function commandAvailability(environment: PublicCommandEnvironment): CommandAvailability {
  const runtimeEnvironments = [
    environment.familyOfficeEnvironment,
    environment.vercelEnvironment,
  ].map(normalized)

  if (runtimeEnvironments.some((value) => value === 'production' || value === 'prod')) {
    return {
      status: 'DISABLED_PRODUCTION',
      httpStatus: 503,
      message: 'Business commands are disabled in Production',
    }
  }

  const baseUrl = environment.commandApiUrl?.trim()
  if (!baseUrl) {
    return {
      status: 'UNCONFIGURED',
      httpStatus: 503,
      message: 'Command API is not configured',
    }
  }

  return { status: 'ENABLED', baseUrl: baseUrl.replace(/\/$/, '') }
}
