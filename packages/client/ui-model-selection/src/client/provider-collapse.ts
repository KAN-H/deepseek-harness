/**
 * Provider-section collapse state for the composer model picker.
 *
 * The picker renders every configured route's models in one scrolling card, so
 * a multi-route profile produces a list whose length scales with providers ×
 * models. Provider headings therefore double as disclosure controls: a
 * collapsed section keeps its heading and hides its models. The user's choice
 * is remembered per device, and a first open with three or more routes starts
 * with every route but the one holding the current selection collapsed — the
 * card opens short instead of long, and expanding another route is one click.
 *
 * The `/model` popup keeps its flat, search-first list: it always shows every
 * group because its own search field is the intended way to narrow it.
 */

/** localStorage key holding the collapsed provider ids as a JSON string array. */
export const COLLAPSED_PROVIDERS_STORAGE_KEY = 'dsh.model-select.collapsed-providers'

/**
 * Read the remembered collapsed provider ids.
 * @param storage - storage-like object (defaults to `window.localStorage`).
 * @returns the stored ids, or null when nothing valid is stored.
 */
export function readCollapsedProviders(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): readonly string[] | null {
  try {
    const raw = storage.getItem(COLLAPSED_PROVIDERS_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(id => typeof id === 'string')) return null
    return parsed
  } catch {
    // Private mode, disabled storage, or a corrupted value: fall back to the
    // first-open policy rather than failing the picker.
    return null
  }
}

/**
 * Persist the collapsed provider ids; storage failures stay silent because the
 * preference is never a precondition for the menu.
 * @param ids - provider ids whose sections are collapsed.
 * @param storage - storage-like object (defaults to `window.localStorage`).
 */
export function persistCollapsedProviders(
  ids: readonly string[],
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(COLLAPSED_PROVIDERS_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage is a preference, never a precondition for the UI.
  }
}

/**
 * The first-open collapse policy, used until the user toggles a section.
 * @param groups - provider groups in picker order.
 * @param currentProvider - id of the provider holding the current selection.
 * @returns ids to collapse: every group but the current one when three or more
 * routes are loaded, otherwise none. With no current route in the catalog
 * (unselected, or the saved route is gone) nothing collapses, so the picker
 * never opens onto only headings.
 */
export function defaultCollapsedProviders(
  groups: readonly { id: string }[],
  currentProvider: string | undefined,
): readonly string[] {
  if (groups.length <= 2 || currentProvider === undefined) return []
  if (!groups.some(group => group.id === currentProvider)) return []
  return groups.filter(group => group.id !== currentProvider).map(group => group.id)
}
