// A code block's node view in plain DOM: a language label, a copy button and
// the highlighted code. A document with many code blocks would otherwise
// mount a React tree (with a long <select>) per block; here the language list
// is built only when someone opens it on the block they are editing.

export const CODE_LANGUAGES = [
  ['', 'Plain text'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'],
  ['diff', 'Diff'], ['go', 'Go'], ['xml', 'HTML / XML'], ['java', 'Java'], ['javascript', 'JavaScript'],
  ['json', 'JSON'], ['kotlin', 'Kotlin'], ['markdown', 'Markdown'], ['php', 'PHP'], ['python', 'Python'],
  ['ruby', 'Ruby'], ['rust', 'Rust'], ['sql', 'SQL'], ['swift', 'Swift'], ['typescript', 'TypeScript'], ['yaml', 'YAML'],
]
const LABEL = Object.fromEntries(CODE_LANGUAGES)
const labelOf = (lang) => LABEL[lang] || lang || 'Plain text'

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    if (k === 'className') n.className = v
    else if (k === 'text') n.textContent = v
    else n.setAttribute(k, v)
  }
  children.forEach(c => c && n.appendChild(c))
  return n
}

/** ProseMirror node view factory for CodeBlockLowlight (addNodeView). */
export function codeBlockNodeView({ node, editor, getPos }) {
  let current = node
  const dom = el('div', { className: 'ft-code' })
  const bar = el('div', { className: 'ft-code-bar', contenteditable: 'false' })
  const pre = el('pre', { spellcheck: 'false' })
  const code = el('code')
  pre.appendChild(code)
  dom.append(bar, pre)

  let picker = null
  const setLanguage = (language) => {
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos == null || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: language || null }))
  }

  const label = editor.isEditable
    ? el('button', { type: 'button', className: 'ft-code-lang', 'aria-label': 'Code language', 'aria-haspopup': 'listbox' })
    : el('span', { className: 'ft-code-lang' })
  if (editor.isEditable) {
    label.addEventListener('mousedown', e => e.preventDefault())
    label.addEventListener('click', () => {
      if (picker) return
      const lang = current.attrs.language || ''
      picker = el('select', { 'aria-label': 'Code language' })
      for (const [v, l] of CODE_LANGUAGES) picker.appendChild(el('option', { value: v, text: l }))
      picker.value = LABEL[lang] !== undefined ? lang : ''
      const close = () => {
        if (!picker) return
        const p = picker
        picker = null
        p.replaceWith(label)
      }
      picker.addEventListener('change', () => { const v = picker.value; close(); setLanguage(v) })
      picker.addEventListener('blur', close)
      picker.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); editor.commands.focus() } })
      label.replaceWith(picker)
      picker.focus()
    })
  }
  bar.appendChild(label)

  if (!editor.storage.blocks?.protect) {
    const copy = el('button', { type: 'button', className: 'ft-code-copy', 'aria-label': 'Copy code', text: 'Copy' })
    copy.addEventListener('mousedown', e => e.preventDefault())
    copy.addEventListener('click', () => {
      navigator.clipboard?.writeText(current.textContent).then(() => {
        copy.textContent = 'Copied'
        setTimeout(() => { copy.textContent = 'Copy' }, 1200)
      }).catch(() => {})
    })
    bar.appendChild(copy)
  }

  const paint = () => {
    const lang = current.attrs.language || ''
    if (lang) dom.setAttribute('data-language', lang); else dom.removeAttribute('data-language')
    code.className = lang ? `hljs language-${lang}` : 'hljs'
    label.textContent = labelOf(lang)
  }
  paint()

  return {
    dom,
    contentDOM: code,
    update(next) {
      if (next.type !== current.type) return false
      const changed = next.attrs.language !== current.attrs.language
      current = next
      if (changed) paint()
      return true
    },
    stopEvent: (e) => bar.contains(e.target),
    ignoreMutation: (m) => bar.contains(m.target) || m.target === bar,
  }
}

export default codeBlockNodeView
