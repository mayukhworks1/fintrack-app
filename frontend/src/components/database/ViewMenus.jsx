import { Popover } from './ui'
import { OP_LABELS, VALUELESS, operatorsFor, typeMeta } from './dbModel'

function defaultValue(prop) {
  if (!prop) return ''
  if (prop.type === 'checkbox') return true
  if (prop.type === 'select' || prop.type === 'multi_select') return prop.options?.[0]?.id ?? ''
  if (prop.type === 'number') return 0
  if (['date', 'created_time', 'last_edited_time'].includes(prop.type)) return new Date().toISOString().slice(0, 10)
  return ''
}

export function newRule(props) {
  const prop = props[0]
  return { prop: prop.id, cmp: operatorsFor(prop.type)[0], value: defaultValue(prop) }
}

function ValueInput({ prop, rule, onChange }) {
  if (VALUELESS.has(rule.cmp)) return null
  const label = `Value for ${prop.name}`
  if (prop.type === 'checkbox') {
    return (
      <select className="fdb-select" aria-label={label} value={String(rule.value === true || rule.value === 'true')}
        onChange={e => onChange(e.target.value === 'true')}>
        <option value="true">Checked</option><option value="false">Not checked</option>
      </select>
    )
  }
  if (prop.type === 'select' || prop.type === 'multi_select') {
    return (
      <select className="fdb-select" aria-label={label} value={rule.value ?? ''} onChange={e => onChange(e.target.value)}>
        {!(prop.options || []).length && <option value="">No options</option>}
        {(prop.options || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    )
  }
  const dated = ['date', 'created_time', 'last_edited_time'].includes(prop.type)
  return (
    <input className="fdb-input" aria-label={label} type={dated ? 'date' : 'text'}
      inputMode={prop.type === 'number' ? 'decimal' : undefined}
      value={rule.value ?? ''} onChange={e => {
        const raw = e.target.value
        if (prop.type === 'number') { const n = Number(raw); onChange(raw === '' || !Number.isFinite(n) ? raw : n) } else onChange(raw)
      }} />
  )
}

function RuleRow({ rule, props, onChange, onRemove, joiner }) {
  const prop = props.find(p => p.id === rule.prop) || props[0]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 28px', gap: 4, alignItems: 'center' }} className="fdb-rule">
      <span style={{ fontSize: 12, color: 'var(--db-mute)', textAlign: 'right', paddingRight: 4 }}>{joiner}</span>
      <select className="fdb-select" aria-label="Property" value={prop.id} onChange={e => {
        const np = props.find(p => p.id === e.target.value)
        onChange({ prop: np.id, cmp: operatorsFor(np.type)[0], value: defaultValue(np) })
      }}>
        {props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="fdb-select" aria-label="Condition" value={rule.cmp} onChange={e => onChange({ ...rule, cmp: e.target.value })}>
        {operatorsFor(prop.type).map(op => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
      </select>
      <div style={{ minWidth: 0 }}><ValueInput prop={prop} rule={rule} onChange={value => onChange({ ...rule, value })} /></div>
      <button type="button" className="fdb-btn" aria-label="Remove rule" onClick={onRemove}>×</button>
    </div>
  )
}

function RuleList({ group, props, onChange, nested }) {
  const rules = group.rules || []
  const setRule = (i, r) => onChange({ ...group, rules: rules.map((x, j) => (j === i ? r : x)) })
  const remove = (i) => onChange({ ...group, rules: rules.filter((_, j) => j !== i) })
  const joinerFor = (i) => (i === 0 ? 'Where' : i === 1 ? (
    <select className="fdb-select" aria-label={nested ? 'Group joins with' : 'Rules join with'} value={group.op}
      onChange={e => onChange({ ...group, op: e.target.value })} style={{ padding: '2px', fontSize: 12 }}>
      <option value="and">and</option><option value="or">or</option>
    </select>
  ) : group.op)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rules.map((r, i) => r.rules ? (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr)', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--db-mute)', textAlign: 'right', paddingRight: 4, paddingTop: 8 }}>{joinerFor(i)}</span>
          <div style={{ border: '1px solid var(--db-line)', borderRadius: 8, padding: 6, background: 'var(--db-soft)' }}>
            <RuleList group={r} props={props} nested onChange={g => (g.rules.length ? setRule(i, g) : remove(i))} />
          </div>
        </div>
      ) : (
        <RuleRow key={i} rule={r} props={props} joiner={joinerFor(i)} onChange={nr => setRule(i, nr)} onRemove={() => remove(i)} />
      ))}
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" className="fdb-btn" onClick={() => onChange({ ...group, rules: [...rules, newRule(props)] })}>+ Add rule</button>
        {!nested && <button type="button" className="fdb-btn" onClick={() => onChange({ ...group, rules: [...rules, { op: group.op === 'and' ? 'or' : 'and', rules: [newRule(props)] }] })}>+ Add group</button>}
      </div>
    </div>
  )
}

/** The filter builder: rules joined by and / or, with one level of groups. */
export function FilterMenu({ filter, schema, onChange, onClose }) {
  const props = schema.properties
  const group = filter && filter.rules ? filter : { op: 'and', rules: [] }
  return (
    <Popover onClose={onClose} label="Filter" style={{ width: 'min(560px, calc(100vw - 24px))' }}>
      <h4>Filter</h4>
      {!group.rules.length && <div className="fdb-count">No filters. Rows are all shown.</div>}
      <RuleList group={group} props={props} onChange={g => onChange(g.rules.length ? g : null)} />
    </Popover>
  )
}

export function SortMenu({ sort = [], schema, onChange, onClose }) {
  const props = schema.properties
  return (
    <Popover onClose={onClose} label="Sort" style={{ width: 'min(380px, calc(100vw - 24px))' }}>
      <h4>Sort</h4>
      {!sort.length && <div className="fdb-count">Rows keep their manual order.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sort.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 28px', gap: 4 }}>
            <select className="fdb-select" aria-label="Sort by" value={s.prop} onChange={e => onChange(sort.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)))}>
              {props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="fdb-select" aria-label="Direction" value={s.dir} onChange={e => onChange(sort.map((x, j) => (j === i ? { ...x, dir: e.target.value } : x)))}>
              <option value="asc">Ascending</option><option value="desc">Descending</option>
            </select>
            <button type="button" className="fdb-btn" aria-label="Remove sort" onClick={() => onChange(sort.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {sort.length < 5 && (
          <button type="button" className="fdb-btn" style={{ alignSelf: 'flex-start' }}
            onClick={() => onChange([...sort, { prop: (props.find(p => !sort.some(s => s.prop === p.id)) || props[0]).id, dir: 'asc' }])}>+ Add sort</button>
        )}
      </div>
    </Popover>
  )
}

/** Which properties a view shows (table columns, or card fields). */
export function PropertiesMenu({ view, schema, onChange, onClose }) {
  const isTable = view.type === 'table'
  const hidden = new Set(view.hidden || [])
  const cards = new Set(view.card_props || [])
  const props = schema.properties.filter(p => p.type !== 'title')
  return (
    <Popover onClose={onClose} label="Properties" align="right" style={{ width: 280 }}>
      <h4>{isTable ? 'Columns shown' : 'Shown on cards'}</h4>
      {!props.length && <div className="fdb-count">Only the title so far.</div>}
      {props.map(p => {
        const on = isTable ? !hidden.has(p.id) : cards.has(p.id)
        return (
          <label key={p.id} className="fdb-item" style={{ cursor: 'pointer' }}>
            <span className="g">{typeMeta(p.type).glyph}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
            <input type="checkbox" className="fdb-check" checked={on} aria-label={`Show ${p.name}`}
              onChange={() => {
                if (isTable) onChange({ hidden: on ? [...hidden, p.id] : [...hidden].filter(x => x !== p.id) })
                else onChange({ card_props: on ? [...cards].filter(x => x !== p.id) : [...cards, p.id] })
              }} />
          </label>
        )
      })}
    </Popover>
  )
}
