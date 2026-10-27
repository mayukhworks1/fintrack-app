/**
 * The plan step before an artifact is built: what the server proposed, what
 * the person kept or changed, and the build prompt made from both.
 */

export const DONT_ASK_KEY = 'ft_artifact_dont_ask'

// The server's own prompt limit (page_ai.MAX_PROMPT_CHARS).
export const MAX_BUILD_PROMPT = 4000

/** True when the person asked to build straight away without a plan. */
export function readDontAsk() {
  try { return localStorage.getItem(DONT_ASK_KEY) === '1' } catch { return false }
}

export function writeDontAsk(on) {
  try {
    if (on) localStorage.setItem(DONT_ASK_KEY, '1')
    else localStorage.removeItem(DONT_ASK_KEY)
  } catch { /* storage unavailable: the choice lasts this visit only */ }
}

/** A usable plan from the server's answer, or null when there is nothing to show. */
export function usablePlan(res) {
  if (!res || typeof res !== 'object' || res.fallback) return null
  const features = Array.isArray(res.features) ? res.features.filter(f => typeof f === 'string' && f.trim()) : []
  const questions = Array.isArray(res.questions)
    ? res.questions.filter(q => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
    : []
  if (!features.length && !questions.length) return null
  const styles = Array.isArray(res.style_options) ? res.style_options.filter(s => s && s.id && s.label) : []
  return {
    title: String(res.title || '').trim(),
    summary: String(res.summary || '').trim(),
    features,
    questions,
    styleOptions: styles,
    styleDefault: styles.some(s => s.id === res.style_default) ? res.style_default : (styles[0]?.id || ''),
  }
}

/** The starting selections: every feature on, each question at its default. */
export function initialChoices(plan) {
  const answers = {}
  for (const q of plan.questions) {
    if (q.multi) {
      const d = Array.isArray(q.default) ? q.default : [q.default]
      const chosen = q.options.filter(o => d.includes(o))
      answers[q.id] = chosen.length ? chosen : [q.options[0]]
    } else {
      answers[q.id] = q.options.includes(q.default) ? q.default : q.options[0]
    }
  }
  return {
    features: plan.features.map(text => ({ text, on: true })),
    answers,
    style: plan.styleDefault,
  }
}

/**
 * The prompt the build runs with: the original request, the features kept,
 * every answer, and the design direction. Features the person unticked are
 * named too, so the build does not add them back on its own.
 */
export function composeBuildPrompt(prompt, plan, choices) {
  const kept = choices.features.filter(f => f.on && f.text.trim()).map(f => f.text.trim())
  const dropped = choices.features.filter(f => !f.on && f.text.trim()).map(f => f.text.trim())
  const answers = plan.questions
    .map(q => {
      const a = choices.answers[q.id]
      const text = Array.isArray(a) ? a.join(', ') : a
      return text ? `- ${q.question} ${text}` : ''
    })
    .filter(Boolean)
  const style = plan.styleOptions.find(s => s.id === choices.style)

  const head = [String(prompt || '').trim()]
  if (plan.title || plan.summary) head.push(`Plan: ${[plan.title, plan.summary].filter(Boolean).join(' — ')}`)
  const tail = []
  if (answers.length) tail.push(`Decisions:\n${answers.join('\n')}`)
  if (dropped.length) tail.push(`Leave out: ${dropped.join('; ')}`)
  if (style) tail.push(`Design direction: ${style.label}`)

  const build = (features) => [
    ...head,
    ...(features.length ? [`Build these features:\n${features.map(f => `- ${f}`).join('\n')}`] : []),
    ...tail,
  ].join('\n\n')

  // Over the limit, the longest list gives way first, then the text is cut.
  let features = kept
  let out = build(features)
  while (out.length > MAX_BUILD_PROMPT && features.length > 1) {
    features = features.slice(0, -1)
    out = build(features)
  }
  return out.slice(0, MAX_BUILD_PROMPT)
}
