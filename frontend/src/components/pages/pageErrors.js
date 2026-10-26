// What went wrong with a page request, in words a person can act on.
//
// The API answers in a few shapes (see apiErrorMessage in services/api.js);
// by the time an error reaches here it is an Error with `status` (absent when
// no response arrived at all) and the server's message. A 409 means three
// different things on a page, told apart by what the server said.

const has = (e, re) => re.test(String(e?.message || ''))

/** 'offline' | 'conflict' | 'trashed' | 'live' | 'creating' | 'too_large' |
 *  'forbidden' | 'not_found' | 'server' | 'invalid' | 'unknown' */
export function errorKind(e) {
  if (!e) return 'unknown'
  const status = e.status
  if (status == null) return 'offline'
  if (status === 409) {
    if (e.code === 'conflict' || has(e, /conflict|changed since you opened/i)) return 'conflict'
    if (has(e, /trash/i)) return 'trashed'
    if (has(e, /still being created/i)) return 'creating'
    return 'live'
  }
  if (status === 413) return 'too_large'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404 || status === 410) return 'not_found'
  if (status === 429 || status >= 500) return 'server'
  if (status === 422 || status === 400) return 'invalid'
  return 'unknown'
}

/** Worth sending again on its own: nothing came back, or the server was busy. */
export function isRetryable(e) {
  const k = errorKind(e)
  return k === 'offline' || k === 'server'
}

// Server text that describes the server rather than the page.
const TECHNICAL = /migration|relation .* does not exist|column .* does not exist|asyncpg|traceback|internal server error|\{'/i

export function friendlyError(e, action = 'save') {
  const kind = errorKind(e)
  switch (kind) {
    case 'offline':
      return action === 'load'
        ? 'Could not reach the server. Check your connection and try again.'
        : 'Could not reach the server. Your changes are kept on this device and will be saved when the connection is back.'
    case 'server':
      return action === 'load'
        ? 'The server is not responding right now. Try again in a moment.'
        : 'The server is not responding right now. Trying again shortly.'
    case 'conflict':
      return 'Someone else saved this page after you opened it.'
    case 'trashed':
      return 'This page is in the trash. Restore it from Trash to keep editing.'
    case 'live':
      return 'This page is open for live editing elsewhere. Saving again in a moment.'
    case 'creating':
      return 'Still creating this page. Trying again in a moment.'
    case 'too_large':
      return 'This page is too large to save (over 5 million characters). Move large images or files out of it, or split it into sub-pages.'
    case 'forbidden':
      return action === 'load' ? 'You do not have access to this page.' : 'You do not have permission to change this page.'
    case 'not_found':
      return 'This page no longer exists. It may have been deleted.'
    default: {
      const msg = String(e?.message || '').trim()
      if (!msg || TECHNICAL.test(msg) || /^HTTP \d+$/.test(msg)) {
        return action === 'load' ? 'Could not load this page.' : 'Could not save your changes.'
      }
      return msg
    }
  }
}
