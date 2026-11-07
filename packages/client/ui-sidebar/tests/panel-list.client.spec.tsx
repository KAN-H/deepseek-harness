// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
/** Global panel dock (dropdown) and DOM focus through the production slot renderer. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderSlots, PropsRuntime, SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'sidebar-panel-test': 'alpha'
  }
}

const ALPHA = 'sidebar-test-alpha' as MainPanelId
const BETA = 'sidebar-test-beta' as MainPanelId
const runtimes = new Set<SlotTestRuntime>()

beforeEach(() => {
  // The dock remembers its expansion per device; each test starts collapsed.
  window.localStorage.clear()
})

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

async function bench(collapsed = false) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const layout = {
    panelInfo: runtime.panelInfo,
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    selectPanel: vi.fn((activePanelId: MainPanelId | null) => { runtime.panelInfo.set({ activePanelId }) }),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  } satisfies ILayout
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
      ctx.provide('layout', layout)
      ctx.provide('uiWorkspace', { startSession: vi.fn() } as never)
      ctx.provide('locale', locale)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn }), 'panel test: common locale')
      ctx.effect(() => locale.register('sidebar-panel-test', {
        zh: { alpha: '甲面板' }, en: { alpha: 'Alpha panel' },
      }), 'panel test: panel locale')
      ctx.slots.installLocale(locale)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'conversation' }, () => (
        <p>Conversation content</p>
      )))
    },
  })
  function Frame({ usePanelInfo, renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'sidebar' | 'main'>) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    return (
      <>
        <aside>{renderSlot('sidebar', { collapsed, width: collapsed ? 56 : 300 })}</aside>
        <main>{renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })}</main>
      </>
    )
  }
  await runtime.root.declare({
    sidebar: { kind: 'single', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  }, Frame)
  const sidebar = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, locale, layout, sidebar, view }
}

interface TestPanel {
  id: MainPanelId
  heading: string
  order?: number
  label?: SlotLabel
}

async function mountPanel(runtime: SlotTestRuntime, { heading, ...metadata }: TestPanel) {
  function Icon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
    return (
      <span data-testid={`${metadata.id}-icon`} data-active={active}>
        <IconGlobeOutlineRegular size={size} />
      </span>
    )
  }
  function Body() {
    return (
      <section>
        <h1>{heading}</h1>
        <input aria-label={`${heading} input`} />
        <button type="button">{heading} action</button>
      </section>
    )
  }
  return runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: metadata.id }, Body))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', ...metadata }, Icon))
    },
  })
}

async function mountPanels(runtime: SlotTestRuntime, locale: LocaleRuntime, betaOrder = 10) {
  const t = locale.bind('sidebar-panel-test')
  const alpha = await mountPanel(runtime, { id: ALPHA, heading: 'Alpha content', label: () => t('alpha'), order: 20 })
  const beta = await mountPanel(runtime, { id: BETA, heading: 'Beta content', label: 'Beta panel', order: betaOrder })
  return { alpha, beta }
}

/** The dock trigger carries the current panel (or the generic "Panels" label). */
function trigger(view: ReturnType<SlotTestRuntime['renderRoot']>): HTMLElement {
  return view.getByRole('button', { name: 'Panel menu' })
}

/** Open the dropdown and return its rows (portalled in rail mode, in-nav when wide). */
async function openMenu(view: ReturnType<SlotTestRuntime['renderRoot']>): Promise<HTMLElement[]> {
  fireEvent.click(trigger(view))
  const menu = await view.findByRole('menu')
  return within(menu).getAllByRole('menuitem')
}

describe('sidebar global panels', () => {
  it('adds late registrations behind one dock row, and removing them leaves no panel DOM', async () => {
    const { runtime, locale, view } = await bench()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(view.queryByRole('navigation')).toBeNull()
    expect(view.container.querySelector('[data-slot="sidebar.panellist"]')).toBeNull()
    expect(view.getByText('Conversation content')).toBeTruthy()

    const { alpha, beta } = await mountPanels(runtime, locale)
    const navigation = await view.findByRole('navigation', { name: 'Global panels' })
    // Collapsed default: the column spends one row on the dock, not one per plugin.
    expect(within(navigation).getAllByRole('button')).toHaveLength(1)
    expect(view.queryByRole('menu')).toBeNull()

    let rows = await openMenu(view)
    expect(rows.map(row => row.textContent)).toEqual(['Beta panel', 'Alpha panel'])
    fireEvent.click(rows.find(row => row.textContent === 'Alpha panel')!)
    expect(view.getByRole('heading', { name: 'Alpha content' })).toBeTruthy()
    await waitFor(() => { expect(view.queryByRole('menu')).toBeNull() })

    await alpha.dispose()
    await waitFor(() => {
      expect(view.queryByRole('heading', { name: 'Alpha content' })).toBeNull()
    })
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['conversation', BETA])
    rows = await openMenu(view)
    expect(rows.map(row => row.textContent)).toEqual(['Beta panel'])
    fireEvent.click(rows[0]!)
    expect(view.getByRole('heading', { name: 'Beta content' })).toBeTruthy()

    await beta.dispose()
    await waitFor(() => { expect(view.queryByRole('navigation')).toBeNull() })
    expect(view.queryByRole('heading', { name: 'Beta content' })).toBeNull()
    expect(view.container.querySelector('[data-slot="sidebar.panellist"]')).toBeNull()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['conversation'])
  })

  it.each([false, true])('opens a menu with ordered 16px rows in wide and rail mode (collapsed=%s)', async (collapsed) => {
    const { runtime, locale, view } = await bench(collapsed)
    await mountPanels(runtime, locale)
    const navigation = await view.findByRole('navigation', { name: 'Global panels' })
    // Neither mode spends a row per panel while the menu is closed.
    expect(within(navigation).getAllByRole('button')).toHaveLength(1)
    expect(trigger(view).textContent).toBe(collapsed ? '' : 'Panels')
    expect(trigger(view).getAttribute('aria-expanded')).toBe('false')

    const rows = await openMenu(view)
    expect(rows.map(row => row.textContent)).toEqual(['Beta panel', 'Alpha panel'])
    expect(trigger(view).getAttribute('aria-expanded')).toBe('true')
    for (const [id, label] of [[BETA, 'Beta panel'], [ALPHA, 'Alpha panel']] as const) {
      const row = rows.find(candidate => candidate.textContent === label)!
      expect(row.querySelectorAll('svg')).toHaveLength(1)
      const icon = within(row).getByTestId(`${id}-icon`)
      expect(icon.getAttribute('data-active')).toBe('false')
      expect(icon.querySelector('svg')?.getAttribute('width')).toBe('16')
      expect(icon.querySelector('svg')?.getAttribute('height')).toBe('16')
      act(() => { row.focus() })
      expect(document.activeElement).toBe(row)
    }
  })

  it('keeps registration order when panel rows have equal order', async () => {
    const { runtime, locale, view } = await bench()
    await mountPanels(runtime, locale, 20)
    const rows = await openMenu(view)
    expect(rows.map(row => row.textContent)).toEqual(['Alpha panel', 'Beta panel'])
  })

  it('selects registered main content, closes the menu, and keeps a repeated selection active', async () => {
    const { runtime, locale, layout, view } = await bench()
    await mountPanels(runtime, locale)
    let rows = await openMenu(view)
    fireEvent.click(rows.find(row => row.textContent === 'Alpha panel')!)
    expect(layout.selectPanel).toHaveBeenLastCalledWith(ALPHA)
    expect(runtime.panelInfo.getSnapshot()).toEqual({ activePanelId: ALPHA })
    expect(view.getByRole('heading', { name: 'Alpha content' })).toBeTruthy()
    await waitFor(() => {
      expect(view.queryByRole('menu')).toBeNull()
      expect(trigger(view).textContent).toBe('Alpha panel')
    })
    expect(within(trigger(view)).getByTestId(`${ALPHA}-icon`).getAttribute('data-active')).toBe('true')

    // Re-selecting the active panel is still a selection, and the dock row tracks it.
    rows = await openMenu(view)
    fireEvent.click(rows.find(row => row.textContent === 'Alpha panel')!)
    expect(layout.selectPanel).toHaveBeenLastCalledWith(ALPHA)
    expect(view.getByRole('heading', { name: 'Alpha content' })).toBeTruthy()

    rows = await openMenu(view)
    fireEvent.click(rows.find(row => row.textContent === 'Beta panel')!)
    expect(layout.selectPanel).toHaveBeenLastCalledWith(BETA)
    expect(runtime.panelInfo.getSnapshot()).toEqual({ activePanelId: BETA })
    await waitFor(() => { expect(trigger(view).textContent).toBe('Beta panel') })
    expect(view.queryByRole('heading', { name: 'Alpha content' })).toBeNull()
    expect(view.getByRole('heading', { name: 'Beta content' })).toBeTruthy()
  })

  it('refreshes locale labels without re-registering icons or changing plain labels', async () => {
    const { runtime, locale, view } = await bench()
    await mountPanels(runtime, locale)
    const entries = runtime.slots.entries('sidebar.panellist')
    act(() => { locale.setLocale('zh') })
    await waitFor(() => {
      expect(view.getByRole('button', { name: '面板菜单' })).toBeTruthy()
    })
    fireEvent.click(view.getByRole('button', { name: '面板菜单' }))
    const menu = await view.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map(row => row.textContent)).toEqual(['Beta panel', '甲面板'])
    expect(runtime.slots.entries('sidebar.panellist')).toBe(entries)
  })

  it('uses an omitted label and order as the panel id and order zero', async () => {
    const { runtime, view } = await bench()
    await mountPanel(runtime, { id: ALPHA, heading: 'Alpha content', label: 'Alpha panel', order: 20 })
    await mountPanel(runtime, { id: BETA, heading: 'Beta content' })
    const rows = await openMenu(view)
    expect(rows.map(row => row.textContent)).toEqual([BETA, 'Alpha panel'])
    fireEvent.click(rows.find(row => row.textContent === BETA)!)
    expect(view.getByRole('heading', { name: 'Beta content' })).toBeTruthy()
  })

  it.each([false, true])('keeps main selection while DOM focus moves between controls with collapsed=%s', async (collapsed) => {
    const { runtime, locale, layout, view } = await bench(collapsed)
    await mountPanels(runtime, locale)
    const rows = await openMenu(view)
    const alphaRow = rows.find(row => row.textContent === 'Alpha panel')!
    act(() => { alphaRow.focus() })
    expect(document.activeElement).toBe(alphaRow)
    expect(runtime.panelInfo.getSnapshot()).toEqual({ activePanelId: null })
    expect(layout.selectPanel).not.toHaveBeenCalled()
    fireEvent.click(alphaRow)
    const selected = runtime.panelInfo.getSnapshot()
    const textbox = view.getByRole('textbox', { name: 'Alpha content input' })
    const action = view.getByRole('button', { name: 'Alpha content action' })
    for (const target of [textbox, action]) {
      act(() => { target.focus() })
      expect(document.activeElement).toBe(target)
      expect(runtime.panelInfo.getSnapshot()).toBe(selected)
      expect(view.getByRole('heading', { name: 'Alpha content' })).toBeTruthy()
      expect(view.queryByRole('heading', { name: 'Beta content' })).toBeNull()
    }
    expect(layout.selectPanel).toHaveBeenCalledExactlyOnceWith(ALPHA)
  })

  it('disposes the sidebar while retaining independently owned main panel bodies', async () => {
    const { runtime, locale, sidebar, view } = await bench()
    await mountPanels(runtime, locale)
    const rows = await openMenu(view)
    fireEvent.click(rows.find(row => row.textContent === 'Alpha panel')!)
    await sidebar.dispose()
    expect(view.queryByRole('navigation')).toBeNull()
    expect(runtime.slots.spec('sidebar.panellist')).toBeUndefined()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(view.getByRole('heading', { name: 'Alpha content' })).toBeTruthy()
    act(() => { locale.setLocale('zh') })
    expect(view.queryByRole('navigation')).toBeNull()
  })
})
