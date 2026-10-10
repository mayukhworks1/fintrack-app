/**
 * InsightWorkbench must never export or chart rows from a previous period.
 *
 * Its source rows were cached per source key for the life of the component.
 * Analytics rebuilds its loaders when the period changes, but the cache was
 * consulted first, so an export downloaded after switching from "All" to
 * "30d" carried filters {period: 30d} and every invoice ever raised — and the
 * same stale rows were handed to the page for its custom blocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const { api } = vi.hoisted(() => ({
  api: {
    insights: {
      listConfigs: vi.fn(),
      export: vi.fn(),
      createConfig: vi.fn(),
      updateConfig: vi.fn(),
      deleteConfig: vi.fn(),
    },
  },
}))
vi.mock('../services/api', () => ({ api }))

import InsightWorkbench from '../components/InsightWorkbench'

const ROWS = {
  all: [{ invoice: 'A', amount: 100 }, { invoice: 'B', amount: 50 }],
  '30d': [{ invoice: 'B', amount: 50 }],
}

const columns = [{ key: 'invoice', label: 'Invoice' }, { key: 'amount', label: 'Amount' }]

/* What Analytics passes: a fresh options array per period, whose loader
   filters by that period. */
function propsFor(period, onApplyCustomBlocks = vi.fn()) {
  return {
    pageKey: 'analytics',
    pageLabel: 'Analytics',
    sourceOptions: [{
      key: 'period-invoices',
      label: 'Invoices in current period',
      columns,
      defaultColumns: columns.map(c => c.key),
      loadRows: vi.fn(async () => ROWS[period]),
      getRows: () => ROWS[period],
    }],
    currentFilters: { period },
    onApplyCustomBlocks,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.insights.listConfigs.mockResolvedValue({ configs: [] })
  api.insights.export.mockResolvedValue({ blob: new Blob(['x']), filename: 'report.xls' })
  URL.createObjectURL = vi.fn(() => 'blob:report')
  URL.revokeObjectURL = vi.fn()
})

describe('InsightWorkbench source rows', () => {
  it('exports the current period after the period changes', async () => {
    const { rerender } = render(<InsightWorkbench {...propsFor('all')} />)
    fireEvent.click(screen.getByRole('button', { name: /Export reports/ }))
    await waitFor(() => expect(screen.getAllByText('A').length).toBeGreaterThan(0)) // preview of "all"
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    const thirty = propsFor('30d')
    rerender(<InsightWorkbench {...thirty} />)
    fireEvent.click(screen.getByRole('button', { name: /Export reports/ }))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Download/ })) })

    await waitFor(() => expect(api.insights.export).toHaveBeenCalledTimes(1))
    const payload = api.insights.export.mock.calls[0][0]
    expect(payload.filters).toEqual({ period: '30d' })
    expect(payload.rows).toEqual([['B', 50]])
    expect(thirty.sourceOptions[0].loadRows).toHaveBeenCalled()
  })

  it('takes back the custom-block rows once the period changes', async () => {
    const onApply = vi.fn()
    const { rerender } = render(<InsightWorkbench {...propsFor('all', onApply)} />)
    fireEvent.click(screen.getByRole('button', { name: /Custom dashboards/ }))
    await waitFor(() => expect(screen.getByText('2 rows loaded')).toBeInTheDocument())

    fireEvent.change(screen.getByDisplayValue('KPI'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: /Add block/ }))
    const [blocks, rowsByKey] = onApply.mock.calls.at(-1)
    expect(blocks).toHaveLength(1)
    expect(rowsByKey['period-invoices']).toEqual(ROWS.all)

    rerender(<InsightWorkbench {...propsFor('30d', onApply)} />)
    await waitFor(() => {
      const [, latest] = onApply.mock.calls.at(-1)
      expect(latest['period-invoices']).toBeUndefined()
    })
    // The blocks themselves survive the period change.
    expect(onApply.mock.calls.at(-1)[0]).toEqual(blocks)
  })

  it('reloads the preview for the new period while a modal stays open', async () => {
    const { rerender } = render(<InsightWorkbench {...propsFor('all')} />)
    fireEvent.click(screen.getByRole('button', { name: /Custom dashboards/ }))
    await waitFor(() => expect(screen.getByText('2 rows loaded')).toBeInTheDocument())
    rerender(<InsightWorkbench {...propsFor('30d')} />)
    await waitFor(() => expect(screen.getByText('1 rows loaded')).toBeInTheDocument())
  })
})
