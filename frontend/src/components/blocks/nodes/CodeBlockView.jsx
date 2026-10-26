import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

export const CODE_LANGUAGES = [
  ['', 'Plain text'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'],
  ['diff', 'Diff'], ['go', 'Go'], ['xml', 'HTML / XML'], ['java', 'Java'], ['javascript', 'JavaScript'],
  ['json', 'JSON'], ['kotlin', 'Kotlin'], ['markdown', 'Markdown'], ['php', 'PHP'], ['python', 'Python'],
  ['ruby', 'Ruby'], ['rust', 'Rust'], ['sql', 'SQL'], ['swift', 'Swift'], ['typescript', 'TypeScript'], ['yaml', 'YAML'],
]
const LABEL = Object.fromEntries(CODE_LANGUAGES)

export default function CodeBlockView({ node, updateAttributes, editor }) {
  const lang = node.attrs.language || ''
  return (
    <NodeViewWrapper className="ft-code" data-language={lang || undefined}>
      <div className="ft-code-bar" contentEditable={false}>
        {editor.isEditable ? (
          <select value={LABEL[lang] !== undefined ? lang : ''} aria-label="Code language"
            onChange={e => updateAttributes({ language: e.target.value || null })}>
            {CODE_LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ) : (
          <span>{LABEL[lang] || lang || 'Plain text'}</span>
        )}
        {!editor.storage.blocks?.protect && <button type="button" className="ft-code-copy" aria-label="Copy code"
          onMouseDown={e => e.preventDefault()}
          onClick={(e) => {
            const btn = e.currentTarget
            navigator.clipboard?.writeText(node.textContent).then(() => {
              btn.textContent = 'Copied'
              setTimeout(() => { btn.textContent = 'Copy' }, 1200)
            }).catch(() => {})
          }}>Copy</button>}
      </div>
      <pre spellCheck={false}><NodeViewContent as="code" className={lang ? `hljs language-${lang}` : 'hljs'} /></pre>
    </NodeViewWrapper>
  )
}
