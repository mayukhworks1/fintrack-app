import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import SlashMenu from './SlashMenu'
import { BLOCK_COMMANDS, filterCommands } from './commands'

export const SlashPluginKey = new PluginKey('slashCommand')

// Fixed-position popover kept inside the visible viewport, which on a phone is
// the part above the on-screen keyboard (visualViewport), not the window.
function place(el, rect) {
  if (!el || !rect) return
  const vv = window.visualViewport
  const vw = vv?.width || window.innerWidth
  const vh = vv?.height || window.innerHeight
  const ox = vv?.offsetLeft || 0
  const oy = vv?.offsetTop || 0
  const w = Math.min(320, vw - 16)
  el.style.width = `${w}px`
  const h = Math.min(el.scrollHeight || 360, 360)
  let left = Math.min(Math.max(rect.left, ox + 8), ox + vw - w - 8)
  let top = rect.bottom + 6
  if (top + h > oy + vh - 8) {
    const above = rect.top - h - 6
    top = above >= oy + 8 ? above : Math.max(oy + 8, oy + vh - h - 8)
  }
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return { commands: BLOCK_COMMANDS }
  },

  addProseMirrorPlugins() {
    const getCommands = () => this.options.commands
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: SlashPluginKey,
        char: '/',
        startOfLine: false,
        allowedPrefixes: null,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.spec.code) return false
          // Only at the start of a block or after a space, like Notion, so a
          // URL or a date such as 1/2 typed into text does not open the menu.
          const before = $from.parent.textBetween(0, $from.parentOffset, '\0', '\0')
          return before === '' || /\s$/.test(before)
        },
        items: ({ query }) => filterCommands(getCommands(), query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let component = null
          let rect = null
          const reposition = () => place(component?.element, rect?.())
          return {
            onStart: (props) => {
              rect = props.clientRect
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor })
              const el = component.element
              el.className = 'ft-pop ft-slash'
              el.style.position = 'fixed'
              el.style.zIndex = '2600'
              el.setAttribute('data-slash-menu', '')
              document.body.appendChild(el)
              requestAnimationFrame(reposition)
              window.visualViewport?.addEventListener('resize', reposition)
            },
            onUpdate: (props) => {
              rect = props.clientRect
              component?.updateProps(props)
              requestAnimationFrame(reposition)
            },
            onKeyDown: (props) => component?.ref?.onKeyDown?.(props) || false,
            onExit: () => {
              window.visualViewport?.removeEventListener('resize', reposition)
              component?.element?.remove()
              component?.destroy()
              component = null
            },
          }
        },
      }),
    ]
  },
})
