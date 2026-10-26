import Modal from '../Modal'

// A short, useful set rather than the whole emoji table: these cover the kinds
// of pages people keep here (clients, plans, notes, finance, launches).
export const PAGE_ICONS = [
  '📄', '📝', '📌', '📎', '📁', '🗂️', '📚', '📖',
  '💡', '✅', '☑️', '🎯', '🚀', '⭐', '🔥', '⚡',
  '📊', '📈', '💰', '💳', '🧾', '🏦', '🧮', '📅',
  '🤝', '👥', '💬', '📣', '📞', '✉️', '🔒', '🔑',
  '🏠', '🏢', '🌐', '🛠️', '⚙️', '🧪', '🎨', '🧭',
]

export default function IconPicker({ open, title, current, onPick, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Page icon" subtitle={title} width={340}>
      <div role="listbox" aria-label="Choose an icon"
        style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:4 }}>
        {PAGE_ICONS.map(e => (
          <button key={e} type="button" role="option" aria-selected={current === e} aria-label={`Icon ${e}`}
            onClick={() => onPick(e)}
            style={{ fontSize:20, lineHeight:1, padding:'7px 0', borderRadius:8, cursor:'pointer',
              border:`1px solid ${current === e ? 'var(--accent)' : 'transparent'}`,
              background: current === e ? 'var(--bg-base)' : 'transparent' }}>
            {e}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onPick('')}
        style={{ marginTop:12, width:'100%', padding:'8px 10px', borderRadius:9, border:'1px solid var(--border)', background:'var(--card-bg)', color:'var(--text-1)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
        No icon
      </button>
    </Modal>
  )
}
