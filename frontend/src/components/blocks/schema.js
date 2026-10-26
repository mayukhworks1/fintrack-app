import { getSchema } from '@tiptap/core'
import { createExtensions } from './extensions'
import { EMPTY_DOC, parseDoc, docText } from './docText'
import { markdownToDoc, plainTextToDoc } from './markdown'

let schema = null
/** The ProseMirror schema every block document is checked against. */
export function blockSchema() {
  if (!schema) schema = getSchema(createExtensions({ editable: false }))
  return schema
}

/**
 * Whatever is in `content`, as a document the editor can open. Text that is
 * not a block document (an old draft, a mistaken type switch) is read as
 * Markdown, and JSON that does not fit the schema keeps its text rather than
 * failing to open.
 */
export function toDocJSON(value) {
  if (!value) return EMPTY_DOC
  const doc = parseDoc(value) || markdownToDoc(String(value))
  try {
    blockSchema().nodeFromJSON(doc).check()
    return doc
  } catch {
    return plainTextToDoc(docText(doc))
  }
}
