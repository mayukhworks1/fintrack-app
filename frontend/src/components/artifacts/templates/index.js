import gst from './gst'
import tds from './tds'
import emi from './emi'
import ageing from './ageing'
import margin from './margin'
import feedback from './feedback'
import currency from './currency'
import pomodoro from './pomodoro'
import { sip, splitter, todo } from './kit'

/**
 * The artifact templates gallery. Each entry is a complete, hand-written,
 * single-file app: { id, name, description, icon, html }.
 */
export const ARTIFACT_TEMPLATES = [todo, splitter, sip, gst, tds, emi, ageing, margin, feedback, currency, pomodoro]

export function templateTitle(t) {
  return t.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || t.name
}
