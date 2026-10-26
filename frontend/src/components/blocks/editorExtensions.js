// What only the editor needs on top of the document schema (./extensions):
// placeholders, the "/" menu and image drop / paste. Kept apart so the public
// viewer's bundle does not carry them.
import { Placeholder } from '@tiptap/extensions'
import { FileHandler } from '@tiptap/extension-file-handler'
import { SlashCommand } from './SlashCommand'
import { BLOCK_COMMANDS } from './commands'
import { IMAGE_TYPES, insertUploadedImage } from './extensions'

/**
 * @param {object} o
 * @param {Array} [o.commands]  "/" menu entries (defaults to BLOCK_COMMANDS)
 * @param {(file: File) => Promise<string>} [o.uploadImage]  returns the stored image URL
 */
export function editorExtensions({ commands = BLOCK_COMMANDS, uploadImage } = {}) {
  const list = [
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
  ]
  if (uploadImage) {
    list.push(FileHandler.configure({
      allowedMimeTypes: IMAGE_TYPES,
      onDrop: (editor, files, pos) => { files.forEach(f => insertUploadedImage(editor, f, uploadImage, pos)) },
      onPaste: (editor, files, html) => { if (html) return; files.forEach(f => insertUploadedImage(editor, f, uploadImage)) },
    }))
  }
  return list
}
