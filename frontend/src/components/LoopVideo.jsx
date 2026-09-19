import { forwardRef } from 'react'

/**
 * A decorative motion loop.
 *
 * Every ambient loop on the public pages goes through here, for three reasons
 * that were previously repeated — or forgotten — at nine separate call sites.
 *
 * It reads as an animation, not as a video player: no controls, no
 * picture-in-picture, no download entry in the context menu, and the context
 * menu itself suppressed. None of that secures the file. The URL is in the
 * page and anyone who opens devtools has it; this only stops the asset being
 * lifted by an accidental right-click, which is what was actually asked for.
 *
 * It serves WebM first. These autoplay on load, so their weight is paid by
 * every visitor whether or not they look: 7.0MB of H.264 against 2.1MB of
 * VP9 across the three clips. The mp4 stays as the fallback because Safari
 * does not decode VP9 on every version still in use.
 *
 * It is aria-hidden. These carry no information a screen reader needs, and
 * announcing a decorative loop is noise.
 */
/* Forwards its ref: two callers restart the loop from the top when their tab
   changes, so the new subject is not joined halfway through the last one's
   motion. Without forwarding, that ref silently points at nothing and the
   restart quietly stops happening — no error, just a behaviour that is gone. */
const LoopVideo = forwardRef(function LoopVideo({ src, className = '', style }, ref) {
  // Callers name the mp4; the WebM sits beside it under the same stem.
  const webm = src.replace(/\.mp4$/, '.webm')
  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      controls={false}
      controlsList="nodownload noplaybackrate noremoteplayback"
      disablePictureInPicture
      onContextMenu={e => e.preventDefault()}
      aria-hidden="true"
      className={className}
      style={style}
    >
      <source src={webm} type="video/webm" />
      <source src={src} type="video/mp4" />
    </video>
  )
})

export default LoopVideo
