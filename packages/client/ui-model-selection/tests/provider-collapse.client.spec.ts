// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  COLLAPSED_PROVIDERS_STORAGE_KEY, defaultCollapsedProviders, persistCollapsedProviders, readCollapsedProviders,
} from '../src/client/provider-collapse.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('readCollapsedProviders', () => {
  it('returns null when nothing is stored', () => {
    expect(readCollapsedProviders(memoryStorage())).toBeNull()
  })

  it('reads a stored id array', () => {
    const storage = memoryStorage({ [COLLAPSED_PROVIDERS_STORAGE_KEY]: '["alpha","gamma"]' })
    expect(readCollapsedProviders(storage)).toEqual(['alpha', 'gamma'])
  })

  it.each(['not json', '{"alpha":1}', '["alpha",2]', 'null'])('rejects the invalid stored value %s', (raw) => {
    const storage = memoryStorage({ [COLLAPSED_PROVIDERS_STORAGE_KEY]: raw })
    expect(readCollapsedProviders(storage)).toBeNull()
  })

  it('falls back to the first-open policy when storage throws', () => {
    const storage = { getItem: () => { throw new Error('denied') } }
    expect(readCollapsedProviders(storage)).toBeNull()
  })
})

describe('persistCollapsedProviders', () => {
  it('writes the ids as JSON', () => {
    const storage = memoryStorage()
    persistCollapsedProviders(['alpha', 'gamma'], storage)
    expect(storage.values.get(COLLAPSED_PROVIDERS_STORAGE_KEY)).toBe('["alpha","gamma"]')
  })

  it('stays silent when storage throws', () => {
    const storage = { setItem: vi.fn(() => { throw new Error('denied') }) }
    expect(() => { persistCollapsedProviders(['alpha'], storage) }).not.toThrow()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })
})

describe('defaultCollapsedProviders', () => {
  const groups = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }]

  it('collapses every other section when three or more routes are loaded', () => {
    expect(defaultCollapsedProviders(groups, 'beta')).toEqual(['alpha', 'gamma'])
  })

  it('keeps two routes fully open', () => {
    expect(defaultCollapsedProviders(groups.slice(0, 2), 'alpha')).toEqual([])
  })

  it('keeps everything open without a current route', () => {
    expect(defaultCollapsedProviders(groups, undefined)).toEqual([])
  })

  it('keeps everything open when the current route is not in the catalog', () => {
    expect(defaultCollapsedProviders(groups, 'missing')).toEqual([])
  })
})
