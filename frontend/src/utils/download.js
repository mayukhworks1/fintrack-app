// Saves a Blob as a file. The link is attached to the page because some
// browsers ignore a click on a detached anchor, and the object URL is revoked
// a moment later rather than at once so the download has started by then.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
