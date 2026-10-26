import { ARTIFACT_TEMPLATES } from './templates'

/** Grid of the hand-written artifact templates. Picking one hands back the template. */
export default function ArtifactTemplates({ onPick, compact = false }) {
  return (
    <ul
      aria-label="Artifact templates"
      style={{
        listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10,
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${compact ? 200 : 220}px), 1fr))`,
      }}
    >
      {ARTIFACT_TEMPLATES.map(t => (
        <li key={t.id} style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={() => onPick(t)}
            aria-label={`Use template: ${t.name}`}
            data-template={t.id}
            className="app-press"
            style={{
              width: '100%', height: '100%', textAlign: 'left', cursor: 'pointer',
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '12px 14px', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-1)',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{t.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{t.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45, marginTop: 2 }}>{t.description}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
