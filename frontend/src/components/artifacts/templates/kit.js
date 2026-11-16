/**
 * Templates written on the artifact design kit.
 *
 * These are complete single-file apps built exactly the way the
 * generation brief tells an artifact to be built (backend
 * services/artifact_design.py): the kit stylesheet, a design direction, the
 * icon sprite and real features. They live as plain .html files so they can be
 * opened, rendered and screenshotted on their own, and are imported as text.
 */
import taskOrganiser from './task-organiser.html?raw'
import expenseSplitter from './expense-splitter.html?raw'
import sipPlanner from './sip-planner.html?raw'
import costTracker from './cost-tracker.html?raw'

export const todo = {
  id: 'task-organiser',
  name: 'Shared to-do list',
  description: 'One task list for everyone with the link, live: due dates, priorities, filters, reordering and undo.',
  icon: '✅',
  html: taskOrganiser,
}

export const splitter = {
  id: 'expense-splitter',
  name: 'Trip expense splitter',
  description: 'Who paid what, everyone’s balance, and the fewest payments to settle up.',
  icon: '🧾',
  html: expenseSplitter,
}

export const sip = {
  id: 'sip-goal-planner',
  name: 'SIP goal planner',
  description: 'Monthly SIP needed for a goal, with step-ups, a growth chart and yearly table.',
  icon: '📈',
  html: sipPlanner,
}

export const costs = {
  id: 'cost-tracker',
  name: 'Cost tracker',
  description: 'Project costs and cash flow for an agency: retainers, one-time fees, licences, receivables and a 12-month forecast, shared live.',
  icon: '💼',
  html: costTracker,
}
