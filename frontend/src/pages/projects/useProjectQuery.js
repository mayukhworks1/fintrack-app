// Data for the Projects page: the URL holds the search, status, client, sort
// and loaded pages; GET /api/projects/query answers one page of cards plus the
// totals of the filtered scope and of the whole portfolio. The fetching is
// hooks/useServerList.js, shared with the invoice pages.
import { useMemo } from 'react'
import { api } from '../../services/api'
import { createListFilters, createListQuery } from '../../hooks/useServerList'

export const PROJECT_PAGE_SIZE = 48
export const DEFAULT_PROJECT_SORT = 'Amount Billed So far'

export const DEFAULT_PROJECT_FILTERS = Object.freeze({
  q: '', status: '', client: '', sort: DEFAULT_PROJECT_SORT, order: 'desc',
})

const projectFilters = createListFilters({
  defaults: DEFAULT_PROJECT_FILTERS,
  keys: { q: 'q', status: 'status', client: 'client', sort: 'sort', order: 'order' },
  pageSize: PROJECT_PAGE_SIZE,
  normalize(out) {
    if (!['asc', 'desc'].includes(out.order)) out.order = 'desc'
    return out
  },
})

export const readProjectFilters = projectFilters.read

/** Query parameters for GET /api/projects/query. */
export function projectQueryParams(filters) {
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status || undefined,
    client: filters.client || undefined,
    sort: filters.sort && filters.sort !== DEFAULT_PROJECT_SORT ? filters.sort : undefined,
    order: filters.order && filters.order !== 'desc' ? filters.order : undefined,
  }
}

export function useProjectFilters(opts) {
  // Sorting is a view choice; "Clear filters" keeps it.
  return projectFilters.useFilters(opts)
}

export const projectList = createListQuery({
  endpoint: '/api/projects/query', fetcher: () => api.projects.query, label: 'projects',
})

export function useProjectQuery(filters, opts = {}) {
  const key = JSON.stringify(projectQueryParams(filters))
  const base = useMemo(() => JSON.parse(key), [key])
  return projectList.useList(base, { pageSize: PROJECT_PAGE_SIZE, ...opts })
}
