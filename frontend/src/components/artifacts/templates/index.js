import gst from './gst'
import tds from './tds'
import emi from './emi'
import ageing from './ageing'
import margin from './margin'
import feedback from './feedback'
import currency from './currency'
import pomodoro from './pomodoro'
import { sip, splitter, todo } from './kit'
import signup from './signup'

/**
 * The artifact templates gallery. Each entry is a complete, hand-written,
 * single-file app: { id, name, description, icon, html }. The shared to-do
 * list (the task organiser) and the sign-up sheet keep their data in the
 * cloud (window.fintrack.db), shared live with everyone who has the link.
 */
export const ARTIFACT_TEMPLATES = [todo, signup, splitter, sip, gst, tds, emi, ageing, margin, feedback, currency, pomodoro]

export function templateTitle(t) {
  return t.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || t.name
}
