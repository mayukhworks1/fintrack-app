/**
 * The public site's motion and media primitives, in one import.
 *
 *   import { RollNumber, InViewVideo, Shot, LazyMount, StepRail } from '../components/motion'
 *
 * Components (each file documents its props at the top):
 *   RollNumber   <RollNumber value format from={0} duration={1200} align="end" />
 *   InViewVideo  <InViewVideo id="sheet-demo" label="… sample data" decorative={false} loop
 *                             playThreshold={0.5} controls="toggle" />
 *   Shot         <Shot id="sheet" alt sizes priority={false} chrome="window" focus ratio zoom
 *                      caption spots={[{ x: '62%', y: '18%', label, side }]} />
 *   Lightbox     <Lightbox open onClose src width height alt caption />  (Shot uses it for `zoom`)
 *   LazyMount    <LazyMount minHeight={560} aspectRatio rootMargin="600px 0px">…</LazyMount>
 *   StepRail     <StepRail count={4} active={i} labels={[…]} orientation="vertical" />
 *
 * Media registry: SCREENS, VIDEOS, screen(id) from './media'.
 *
 * Hooks live in src/hooks:
 *   useReducedMotion()                                   → boolean (live; true without matchMedia)
 *   useInView({ threshold=0, rootMargin='0px', once })   → [ref, inView]
 *   useAutoplay({ threshold=0.25, enabled=true })        → { ref, running, reduced, userPaused,
 *                                                             pause, resume, toggle, inView, autoplay }
 *   useActiveStep(count, { band, disabled })             → { active, stepRef(i), tracking }
 *   useInk(activeIndex, { axis='x' })                    → containerRef
 *   useReveal({ threshold, rootMargin })                 → ref (sets [data-shown] once)
 *
 * CSS (src/styles/motion.css): tokens --m-t-* / --m-ease-* / --m-stagger / --m-rise and the
 * utilities ft-m-seq, ft-m-draw, ft-m-clip, ft-m-pop, ft-m-pulse-once, ft-m-page,
 * ft-m-skeleton, ft-m-scrub, ft-m-paused, ft-m-ink / ft-m-ink-bar, ft-m-sr.
 */
export { default as RollNumber } from './RollNumber'
export { default as InViewVideo } from './InViewVideo'
export { default as Shot } from './Shot'
export { default as Lightbox } from './Lightbox'
export { default as LazyMount } from './LazyMount'
export { default as StepRail } from './StepRail'
export { SCREENS, VIDEOS, screen } from './media'
