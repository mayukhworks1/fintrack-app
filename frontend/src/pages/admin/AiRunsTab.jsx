// Extracted from AdminDashboard.jsx — AiRunsTab.
import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, ChevronLeft
} from 'lucide-react'
import { api } from '../../services/api'
import { Badge, Empty, Err, FMulti, FPill, FSel, FilterBar, Pager, Skeleton, roleBadge } from './ui'
import { ts } from './utils'

export function AiRunsTab() {
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [filterRole, setFilterRole] = useState([])
  const [filterSource, setFilterSource] = useState('')
  const [limit, setLimit] = useState(30)

  const loadList = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setList(await api.admin.aiGenerations({
        limit, offset,
        task_prefix: taskPrefix || undefined,
        role: filterRole[0] || undefined,
        source: filterSource || undefined,
      }))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [limit, offset, taskPrefix, filterRole, filterSource])

  useEffect(() => { setOffset(0) }, [taskPrefix, filterRole, filterSource, limit])
  useEffect(() => { loadList() }, [loadList])

  const openGeneration = useCallback(async (id) => {
    setSelected(id); setDetail(null); setDetailLoading(true)
    try { setDetail(await api.admin.aiGeneration(id)) }
    catch { setDetail({ error: true }) }
    finally { setDetailLoading(false) }
  }, [])

  if (selected) {
    const gen = detail?.generation
    return (
      <div className="space-y-3">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-xs btn-secondary px-3 py-1">
          <ChevronLeft size={12} /> Back to AI runs
        </button>
        {detailLoading ? <Skeleton rows={5} /> : detail?.error ? <Err msg="Failed to load AI generation" /> : gen ? (
          <div className="space-y-3">
            <div className="card p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="purple">{gen.task_type}</Badge>
                <Badge color="blue">{gen.response_mode || 'brief'}</Badge>
                {gen.verification?.source && <Badge color="teal">{gen.verification.source}</Badge>}
                {gen.metadata?.planner?.label && <Badge color="indigo">{gen.metadata.planner.label}</Badge>}
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div><span style={{ color: 'var(--text-3)' }}>Created:</span> <span style={{ color: 'var(--text-1)' }}>{ts(gen.created_at)}</span></div>
                <div><span style={{ color: 'var(--text-3)' }}>Model:</span> <span style={{ color: 'var(--text-1)' }}>{gen.model || '—'}</span></div>
                <div><span style={{ color: 'var(--text-3)' }}>Role:</span> <span style={{ color: 'var(--text-1)' }}>{gen.role || '—'}</span></div>
                <div><span style={{ color: 'var(--text-3)' }}>Duration:</span> <span style={{ color: 'var(--text-1)' }}>{gen.duration_ms ? `${gen.duration_ms}ms` : '—'}</span></div>
              </div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Prompt</div>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{gen.prompt || '—'}</pre>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Output</div>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{gen.output_text || '—'}</pre>
            </div>
          </div>
        ) : <Empty label="No generation detail found" />}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <FilterBar
        count={(taskPrefix ? 1 : 0) + filterRole.length + (filterSource ? 1 : 0)}
        onReset={() => { setTaskPrefix(''); setFilterRole([]); setFilterSource('') }}
        rightSlot={<>
          <FSel label="Limit" value={String(limit)} onChange={v => setLimit(Number(v))}
            opts={[['15','15'],['30','30'],['50','50'],['100','100']]} />
          <button onClick={loadList} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </>}
      >
        <FPill label="Task" value={taskPrefix} onChange={setTaskPrefix} placeholder="dashboard: / report:" width={160} />
        <FMulti label="Role" selected={filterRole} onChange={setFilterRole} width={140}
          opts={[['editor','editor'],['viewer','viewer'],['web','web'],['all','all'],['admin','admin']]} />
        <FSel label="Source" value={filterSource} onChange={setFilterSource}
          opts={[['','All'],['hybrid-rag','hybrid-rag'],['pg-mirror','pg-mirror'],['teable-live','teable-live']]} />
      </FilterBar>
      {list && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{list.total} AI runs</div>}
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={loadList} /> : (
        <>
          {(list?.rows || []).length === 0
            ? <Empty label="No AI runs yet" />
            : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                      {['Task','Mode','Source','Role','Duration','Created','Prompt'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(list?.rows || []).map(row => (
                      <tr key={row.id} className="border-b cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => openGeneration(row.id)}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span style={{ color: 'var(--text-1)' }}>{row.metadata?.planner?.label || row.task_type}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{row.task_type}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{row.response_mode || '—'}</td>
                        <td className="px-3 py-2">{row.verification?.source ? <Badge color="teal">{row.verification.source}</Badge> : '—'}</td>
                        <td className="px-3 py-2">{roleBadge(row.role)}</td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>{row.duration_ms ? `${row.duration_ms}ms` : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{ts(row.created_at)}</td>
                        <td className="px-3 py-2 max-w-[420px] truncate" style={{ color: 'var(--text-2)' }}>{row.prompt_preview || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <Pager total={list?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Sync Log ─────────────────────────────────────────────────────────────
