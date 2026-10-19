/**
 * The only way a video plays on the public site.
 *
 *   <InViewVideo id="sheet-demo"
 *                label="Spreadsheet editor, sample data: a SUM is typed, an amount changes and totals follow" />
 *   // or explicit: webm, mp4, mp4Small, poster, width, height
 *
 * - preload="none", muted, playsInline, a poster always, and never the
 *   autoplay attribute. Browsers fetch a poster as soon as the element
 *   exists, so the poster attribute is only set once the video is within
 *   300px of the viewport; until then the reserved frame shows its plain
 *   background. With no IntersectionObserver it is set at once. Playback starts from script while
 *   useAutoplay({ threshold: playThreshold }).running is true and pauses when
 *   it turns false (scrolled away, tab hidden, visitor pressed pause).
 * - No video bytes before the first play: the <source> list is only rendered
 *   then, which is also when mp4Small is chosen (under 1024px or Save-Data).
 * - A play() from anywhere else (a caller holding the ref) while the gate is
 *   closed is paused straight back.
 * - Under reduced motion or Save-Data it shows the poster and a Play button;
 *   playback the visitor starts is allowed and loops with a visible Pause.
 * - controls="toggle" renders a 44px play/pause button (aria-pressed means
 *   paused). It shows on hover and focus, always on touch, and always while
 *   paused. Required for any loop over 5s, decorative or not.
 * - decorative: the video is aria-hidden and there is no caption (LoopVideo
 *   only). Otherwise it is a <figure> whose <figcaption> is `caption` or
 *   `label` — say "sample data" in it.
 * - Space is reserved by width/height attributes plus aspect-ratio on the
 *   frame inside the .ft-m-video wrapper. `reserve={false}` drops the
 *   aspect-ratio for a caller whose own box sizes the video (LoopVideo).
 * - `className` goes on the wrapper, `videoClassName` on the <video>; `name`
 *   is the short noun in the toggle's label ("Pause <name>").
 */
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useAutoplay } from '../../hooks/useAutoplay'
import { useInView } from '../../hooks/useInView'
import { VIDEOS } from './media'

const smallScreen = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
  !!window.matchMedia('(max-width: 1023px)')?.matches

const saveData = () => typeof navigator !== 'undefined' && !!navigator.connection?.saveData

const InViewVideo = forwardRef(function InViewVideo({
  id, label = '', caption, name,
  webm, mp4, mp4Small, poster, width, height,
  decorative = false, loop = true, playThreshold = 0.5, controls = 'toggle',
  reserve = true, className = '', videoClassName = '', style, videoStyle,
}, outerRef) {
  const entry = (id && VIDEOS[id]) || {}
  const src = {
    webm: webm ?? entry.webm,
    mp4: mp4 ?? entry.mp4,
    mp4Small: mp4Small ?? entry.mp4Small,
    poster: poster ?? entry.poster,
    w: width ?? entry.w,
    h: height ?? entry.h,
  }

  const auto = useAutoplay({ threshold: playThreshold })
  // The poster waits until the video is near: a poster is not lazy-loaded.
  const [nearRef, near] = useInView({ rootMargin: '300px 0px', once: true })
  const autoRef = auto.ref
  const setFigure = useCallback((el) => { autoRef(el); nearRef(el) }, [autoRef, nearRef])
  const videoRef = useRef(null)
  useImperativeHandle(outerRef, () => videoRef.current, [])
  const [armed, setArmed] = useState(null)     // sources chosen at first play
  const [playing, setPlaying] = useState(false)
  const captionId = useId()
  // Read by the play handler, so a caller holding the ref cannot start the
  // video while the gate is closed (scrolled away, tab hidden, reduced motion).
  const runningRef = useRef(auto.running)
  runningRef.current = auto.running

  // Sources arrive with the first play; load them before playing. Declared
  // before the play effect so it runs first in the commit that arms them.
  useEffect(() => {
    if (armed) videoRef.current?.load?.()
  }, [armed])

  // Play while the gate is open, pause the moment it closes.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (!auto.running) { if (!v.paused) v.pause(); return }
    if (!armed) {
      setArmed({ mp4: (smallScreen() || saveData()) && src.mp4Small ? src.mp4Small : src.mp4 })
      return
    }
    const p = v.play?.()
    // A browser that refuses (power saving, a policy) leaves the poster and
    // the Play button: nothing is lost by not playing.
    if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false))
  }, [auto.running, armed, src.mp4, src.mp4Small])

  const onToggle = useCallback(() => auto.toggle(), [auto])

  const ratio = src.w && src.h ? `${src.w} / ${src.h}` : undefined
  const Tag = decorative ? 'div' : 'figure'
  const what = name || (decorative ? 'animation' : 'video')
  const paused = !playing

  return (
    <Tag
      ref={setFigure}
      className={`ft-m-video ${className}`.trim()}
      data-state={playing ? 'playing' : 'paused'}
      style={style}
    >
      <div className="ft-m-video-frame" style={reserve && ratio ? { aspectRatio: ratio } : undefined}>
        <video
          ref={videoRef}
          className={videoClassName || undefined}
          style={videoStyle}
          width={src.w}
          height={src.h}
          poster={near || armed ? src.poster : undefined}
          preload="none"
          muted
          playsInline
          loop={loop}
          controls={false}
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablePictureInPicture
          aria-hidden={decorative ? 'true' : undefined}
          aria-labelledby={decorative ? undefined : captionId}
          onContextMenu={decorative ? (e) => e.preventDefault() : undefined}
          onPlay={(e) => {
            if (!runningRef.current) { e.currentTarget.pause(); return }
            setPlaying(true)
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        >
          {armed && src.webm && <source src={src.webm} type="video/webm" />}
          {armed && armed.mp4 && <source src={armed.mp4} type="video/mp4" />}
        </video>
        {controls === 'toggle' && (
          <button
            type="button"
            className="ft-m-video-toggle"
            aria-label={`Pause ${what}`}
            aria-pressed={paused}
            onClick={onToggle}
          >
            {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
          </button>
        )}
      </div>
      {!decorative && (
        <figcaption id={captionId} className="ft-m-video-cap">{caption ?? label}</figcaption>
      )}
    </Tag>
  )
})

export default InViewVideo
