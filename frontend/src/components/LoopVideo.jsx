import { forwardRef } from 'react'
import InViewVideo from './motion/InViewVideo'
import { videoForSrc } from './motion/media'

/**
 * A decorative motion loop: a thin wrapper over InViewVideo.
 *
 * It used to be a bare <video autoPlay loop>, so every loop on the public
 * pages started downloading on load, played under reduced motion and kept
 * playing off screen and in a background tab, with nothing to stop it. Now
 * it is InViewVideo in decorative mode, which means:
 *
 *   - preload="none" and a poster: no video bytes until it is on screen;
 *   - it plays only while at least half of it is visible and the tab is
 *     showing, and never by itself under reduced motion or Save-Data;
 *   - a pause button (these loops run 8 seconds), visible on hover, focus
 *     and touch, and whenever the loop is paused;
 *   - WebM first, the mp4 as the fallback, chosen at first play.
 *
 * It still reads as an animation rather than a player: no native controls,
 * no picture-in-picture, no download entry, the context menu suppressed, and
 * aria-hidden, because a decorative loop carries nothing a screen reader
 * needs. None of that secures the file; it only stops an accidental
 * right-click lifting it.
 *
 * Callers name the mp4 (`src`); the WebM sits beside it under the same stem,
 * and the poster and size come from the media registry when the file is
 * registered there. `poster` overrides it. The ref still reaches the <video>
 * element, so a caller that restarts the loop keeps working.
 */
const LoopVideo = forwardRef(function LoopVideo({ src, poster, className = '', style }, ref) {
  const known = videoForSrc(src)
  return (
    <InViewVideo
      ref={ref}
      decorative
      reserve={false}
      mp4={src}
      webm={known?.webm ?? src.replace(/\.mp4$/, '.webm')}
      poster={poster ?? known?.poster}
      width={known?.w}
      height={known?.h}
      className={className}
      videoClassName={className}
      style={style}
    />
  )
})

export default LoopVideo
