import { FileText, Globe, Table2, Type } from 'lucide-react'

// A page's emoji when it has one, otherwise a small type icon.
export function PageGlyph({ node, size = 14 }) {
  if (node?.icon) {
    return <span aria-hidden="true" style={{ width:size + 4, textAlign:'center', fontSize:size, lineHeight:1, flexShrink:0 }}>{node.icon}</span>
  }
  const t = node?.content_type
  const Icon = t === 'html' ? Globe : t === 'csv' ? Table2 : t === 'text' ? Type : FileText
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} style={{ width:size + 4, flexShrink:0, color:'var(--text-3)' }} />
}
