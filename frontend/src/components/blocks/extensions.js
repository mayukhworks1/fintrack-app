// The block editor's schema and behaviour, in one list.
//
// Both the editor and the read-only viewer build their extensions here, so a
// document always renders with exactly the schema it was written in. Later
// phases plug in by passing `extra` (more nodes / marks / plugins, e.g. page
// links, inline databases, collaboration) and `commands` (more "/" entries).
import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { FileHandler } from '@tiptap/extension-file-handler'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { API_BASE_URL } from '../../services/api'
import { Callout } from './nodes/Callout'
import { Embed } from './nodes/Embed'
import CodeBlockView from './nodes/CodeBlockView'
import { SlashCommand } from './SlashCommand'
import { BLOCK_COMMANDS } from './commands'
import { colorKey } from './palette'
import { safeHref, safeImageSrc } from './embeds'

const lowlight = createLowlight(common)

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
    return ReactNodeViewRenderer(CodeBlockView)
  },
})

// Editor-wide hooks the toolbar and commands reach through editor.storage.blocks.
const BlocksKit = Extension.create({
  name: 'blocks',
  addOptions() {
    return { protect: false }
  },
  addStorage() {
    return { pickImage: null, openLink: null, uploading: 0, protect: this.options.protect }
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
 * @param {object} o
 * @param {boolean} [o.editable=true]
 * @param {(file: File) => Promise<string>} [o.uploadImage]  returns the stored image URL
 * @param {Array} [o.commands]  "/" menu entries (defaults to BLOCK_COMMANDS)
 * @param {Array} [o.extra]     further extensions from later features
 * @param {boolean} [o.protect] viewer: hide copy affordances
 * @param {boolean} [o.history=true] ProseMirror undo; off when live editing
 *                                   brings Yjs' own undo (only your edits)
 */
export function createExtensions({ editable = true, uploadImage, commands = BLOCK_COMMANDS, extra = [], protect = false, history = true } = {}) {
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
  if (editable) {
    list.push(
      Placeholder.configure({
        includeChildren: true,
        showOnlyCurrent: true,
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
          if (node.type.name === 'detailsSummary') return 'Toggle'
          if (node.type.name === 'codeBlock') return ''
          return "Type '/' for commands"
        },
      }),
      SlashCommand.configure({ commands }),
    )
    if (uploadImage) {
      list.push(FileHandler.configure({
        allowedMimeTypes: IMAGE_TYPES,
        onDrop: (editor, files, pos) => { files.forEach(f => insertUploadedImage(editor, f, uploadImage, pos)) },
        onPaste: (editor, files, html) => { if (html) return; files.forEach(f => insertUploadedImage(editor, f, uploadImage)) },
      }))
    }
  }
  return [...list, ...extra]
}
