export interface OwnerScopedRow {
  owner_user_id: string
}

export class OwnerIsolationError extends Error {
  readonly code = 'CROSS_OWNER_DATA_REFUSED'
}

export function familyOfficeSWRKey(ownerUserId: string): string {
  if (!ownerUserId) {
    throw new OwnerIsolationError('Authenticated owner identity is unavailable')
  }
  return `family-office-bundle-v2:${ownerUserId}`
}

export function assertOwnerIsolation(
  expectedOwnerUserId: string,
  collections: ReadonlyArray<ReadonlyArray<OwnerScopedRow>>,
): void {
  if (!expectedOwnerUserId) {
    throw new OwnerIsolationError('Authenticated owner identity is unavailable')
  }

  for (const rows of collections) {
    if (rows.some((row) => row.owner_user_id !== expectedOwnerUserId)) {
      throw new OwnerIsolationError('Cross-owner data was refused by the UI boundary')
    }
  }
}
