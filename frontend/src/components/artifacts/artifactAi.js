import { api } from '../../services/api'

export const ARTIFACT_TYPE = 'artifact'

/**
 * Build or refine an artifact through the page builder's streaming endpoint.
 *
 * content_type "artifact" is what selects the artifact brief on the server
 * (self-contained, no network calls, localStorage only, accessible, light and
 * dark). With `existing` the server takes its revision path and returns the
 * whole edited document in the final frame.
 *
 * Resolves to { content, model, warnings }.
 */
export async function streamArtifact({ prompt, existing, signal, onThought, onDelta, onEdit }) {
  const res = await api.pages.aiStream({
    prompt,
    content_type: ARTIFACT_TYPE,
    existing: existing && existing.trim() ? existing : undefined,
  }, { signal })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamed = ''
  let done = null

  const handle = (line) => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') return
    let frame
    try { frame = JSON.parse(data) } catch { return }
    if (frame.type === 'thought') onThought?.(frame.text || '', frame.mode)
    else if (frame.type === 'delta') { streamed += frame.delta || ''; onDelta?.(streamed) }
    else if (frame.type === 'edit') onEdit?.(frame)
    else if (frame.type === 'done') done = frame
    else if (frame.type === 'error') throw new Error(frame.message || 'Generation failed.')
  }

  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(handle)
  }
  if (buffer) handle(buffer)

  if (done?.content) {
    return { content: done.content, model: done.model_short || done.model || '', warnings: done.warnings || [] }
  }
  // A revision streams edit instructions, not a document, so only a fresh
  // build may fall back to what was streamed.
  if (!existing && streamed.trim()) {
    return { content: streamed, model: '', warnings: ['The stream ended early; check the result before publishing'] }
  }
  throw new Error('No artifact came back. Try again, or rephrase the request.')
}
