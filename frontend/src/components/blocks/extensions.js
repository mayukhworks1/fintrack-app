// The block editor's schema and behaviour, in one list.
//
// Both the editor and the read-only viewer build their extensions here, so a
// document always renders with exactly the schema it was written in. Later
// phases plug in by passing `extra` (more nodes / marks / plugins, e.g. page
// links, inline databases, collaboration) and `commands` (more "/" entries).
import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import xml from 'highlight.js/lib/languages/xml'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'
import { API_BASE_URL } from '../../services/api'
import { Callout } from './nodes/Callout'
import { Embed } from './nodes/Embed'
import { codeBlockNodeView } from './nodes/CodeBlockView'
import { colorKey } from './palette'
import { safeHref, safeImageSrc } from './embeds'

// Only the languages the code block offers (nodes/CodeBlockView), not the
// whole "common" bundle.
const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, go, xml, java, javascript, json, kotlin,
  markdown, php, python, ruby, rust, sql, swift, typescript, yaml,
})

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Backend-relative asset paths become absolute: the public viewer is served
 *  from a different origin than the API that stores the files. */
export function assetUrl(src) {
  const s = safeImageSrc(src)
  if (!s) return null
  return s.startsWith('/api/') ? `${API_BASE_URL}${s}` : s
}

// Text colour as a named palette entry, rendered through a CSS variable.
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => colorKey(el.getAttribute('data-color')),
        renderHTML: a => (colorKey(a.color) ? { 'data-color': colorKey(a.color) } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-color]', getAttrs: el => (colorKey(el.getAttribute('data-color')) ? null : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'ft-tc' }), 0]
  },
  addCommands() {
    return {
      setTextColor: (color) => ({ commands }) => (colorKey(color) ? commands.setMark(this.name, { color: colorKey(color) }) : commands.unsetMark(this.name)),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

// Highlight keeps the ==text== input rule; its colour is a palette name too.
const SafeHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => colorKey(el.getAttribute('data-color')),
        renderHTML: a => (colorKey(a.color) ? { 'data-color': colorKey(a.color) } : {}),
      },
    }
  },
})

const SafeImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: el => el.getAttribute('src'),
        renderHTML: a => { const u = assetUrl(a.src); return u ? { src: u } : {} },
      },
    }
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { loading: 'lazy', draggable: 'false' })]
  },
})

const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: el => {
          const c = [...(el.firstElementChild?.classList || [])].find(x => x.startsWith('language-'))
          return c ? c.slice(9) : null
        },
        rendered: false,
      },
    }
  },
  addNodeView() {
    return codeBlockNodeView
  },
})

// Editor-wide hooks the toolbar and commands reach through editor.storage.blocks.
const BlocksKit = Extension.create({
  name: 'blocks',
  addOptions() {
    return { protect: false }
  },
  addStorage() {
    return { pickImage: null, openLink: null, pages: null, uploading: 0, protect: this.options.protect }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => { this.storage.openLink?.(); return !!this.storage.openLink },
    }
  },
})

/** Upload a file and drop the image into the document at `pos` (or the cursor). */
export async function insertUploadedImage(editor, file, uploadImage, pos) {
  if (!file || !uploadImage || !IMAGE_TYPES.includes(file.type)) return
  const store = editor.storage.blocks
  store.uploading += 1
  editor.emit('blocks:upload', store.uploading)
  try {
    const src = await uploadImage(file)
    if (!src || editor.isDestroyed) return
    const at = typeof pos === 'number' ? Math.min(pos, editor.state.doc.content.size) : editor.state.selection.to
    editor.chain().insertContentAt(at, { type: 'image', attrs: { src, alt: file.name || null } }).run()
  } catch (err) {
    editor.emit('blocks:error', err?.message || 'Upload failed')
  } finally {
    store.uploading -= 1
    editor.emit('blocks:upload', store.uploading)
  }
}

function linkAllowed(url, ctx) {
  if (!ctx.defaultValidate(url)) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) || !!safeHref(url)
}

/**
 * The document's schema and how it renders. The editing aids (placeholder,
 * the "/" menu, image drop and paste) are in ./editorExtensions, so the
 * read-only viewer does not load them; the editor passes them in `extra`.
 *
 * @param {object} o
 * @param {boolean} [o.editable=true]
 * @param {Array} [o.extra]     further extensions (editing aids, later features)
 * @param {boolean} [o.protect] viewer: hide copy affordances
 * @param {boolean} [o.history=true] ProseMirror undo; off when live editing
 *                                   brings Yjs' own undo (only your edits)
 */
export function createExtensions({ editable = true, extra = [], protect = false, history = true } = {}) {
  const list = [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: 'var(--blk-accent, #2383e2)', width: 3 },
      link: {
        openOnClick: !editable,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: linkAllowed,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
      },
      undoRedo: editable && history ? {} : false,
      trailingNode: editable ? {} : false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    CodeBlock.configure({ lowlight, defaultLanguage: null, HTMLAttributes: { spellcheck: 'false' } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'ft-toggle' } }),
    DetailsSummary,
    DetailsContent,
    Callout,
    Embed,
    SafeImage.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: { resizable: editable, HTMLAttributes: { class: 'ft-table' } } }),
    TextColor,
    SafeHighlight.configure({ multicolor: false }),
    BlocksKit.configure({ protect }),
  ]
  return [...list, ...extra]
}
