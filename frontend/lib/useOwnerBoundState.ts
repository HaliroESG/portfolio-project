"use client"

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

interface OwnerBoundState<Value> {
  ownerUserId: string | null
  value: Value
}

export function useOwnerBoundState<Value>(
  ownerUserId: string | null,
  initialValue: Value,
): [Value, Dispatch<SetStateAction<Value>>] {
  const [state, setState] = useState<OwnerBoundState<Value>>({ ownerUserId, value: initialValue })
  const value = state.ownerUserId === ownerUserId ? state.value : initialValue

  const setValue = useCallback<Dispatch<SetStateAction<Value>>>((nextValue) => {
    setState((current) => {
      const currentValue = current.ownerUserId === ownerUserId ? current.value : initialValue
      return {
        ownerUserId,
        value: typeof nextValue === 'function'
          ? (nextValue as (previous: Value) => Value)(currentValue)
          : nextValue,
      }
    })
  }, [initialValue, ownerUserId])

  return [value, setValue]
}
