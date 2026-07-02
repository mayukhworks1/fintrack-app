// Extracted from Invoices.jsx — InvoiceDrawer.
import Drawer from '../../components/Drawer'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../services/api'
import { AlertTriangle, CheckCircle2, Loader2, Mail, RotateCcw, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentUploadField, Field, SelectInput, SuggestInput } from './ui'
import { EMPTY_FORM, INVOICE_PARSE_FIELD_LABELS, STATUSES, buildInvoiceScalarPayload, isRetainerCategory, normalizeInvoiceScalarForm } from './utils'

export function InvoiceDrawer({ open, invoice, prefill, paymentOnly = false, onClose, onSaved, onDeleted, options = {} }) {
  const { userEmail, authRole, isEmailAuth, hasPerm } = useAuth()
  const isEdit = Boolean(invoice?.id)
  const ownerLocked = Boolean(isEmailAuth && userEmail && !['superadmin', 'admin', 'manager', 'finance'].includes(authRole))
  const _canDelete = hasPerm('module.invoices.delete')
  const [form,       setForm]      = useState(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState(EMPTY_FORM)
  const [workingRecordId, setWorkingRecordId] = useState(invoice?.id || null)
  const [saving,     setSaving]    = useState(false)
  const [deleting,   setDeleting]  = useState(false)
  const [confirmDel, setConfirmDel]= useState(false)
  const [error,      setError]     = useState('')
  const [parsing,    setParsing]   = useState(false)
  const [parseNote,  setParseNote] = useState('')   // "Filled N fields" banner text
  const [parseError, setParseError]= useState('')
  const [parseApplied, setParseApplied] = useState([])
  const parseFileRef = useRef(null)
  const currentRecordId = invoice?.id || workingRecordId
  const paidSelected = form.payment_status === 'Paid'
  const projectOptions    = options.projects    || []
  const clientNameOptions = options.clientNames || []
  const categoryOptions   = options.categories  || []
  const milestoneOptions  = options.milestones  || []
  const raisedByOptions   = options.raisedBy    || []
  const retainerCategoryOption = categoryOptions.find(c => /retainer/i.test(c)) || 'Development- Retainer'
  const retainerSelected = isRetainerCategory(form.category)
  const hasPaymentAttempt = form.payment_status === 'Paid' || String(form.amount_received).trim() || form.cleared_date
  const hasFormChanges = useMemo(
    () => JSON.stringify(normalizeInvoiceScalarForm(form)) !== JSON.stringify(normalizeInvoiceScalarForm(initialForm)),
    [form, initialForm]
  )
  const canSubmit = !saving && (!isEdit || paymentOnly || hasFormChanges)

  useEffect(() => {
    const ownerPatch = ownerLocked ? { raised_by: userEmail } : {}
    if (!invoice && !prefill) {
      const next = { ...EMPTY_FORM, ...ownerPatch }
      setForm(next)
      setInitialForm(next)
      return
    }
    if (!invoice && prefill) {
      const next = { ...EMPTY_FORM, ...prefill, ...ownerPatch }
      setForm(next)
      setInitialForm(next)
      return
    }
    const f = invoice.fields || {}
    const next = {
      invoice_number:  f['Invoice Number']  || '',
      project:         f['Project']         || '',
      client_name:     f['Client Name']     || '',
      category:        f['Category']        || '',
      description:     f['Description']     || '',
      milestone:       f['Milestone']       || '',
      raised_by:       ownerLocked ? userEmail : (f['Raised By'] || ''),
      raised_date:     f['Raised Date']   ? String(f['Raised Date']).slice(0, 10)   : '',
      cleared_date:    f['Cleared Date']  ? String(f['Cleared Date']).slice(0, 10)  : '',
      amount_raised:   f['Amount Raised']   ?? '',
      amount_with_tax: f['Amount with Tax'] ?? '',
      amount_received: f['Amount Received'] ?? '',
      payment_status:  f['Payment Status']  || 'Pending',
      remark:          f['Remark']          || '',
      next_followup:   f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
      reference:       Array.isArray(f['Reference']) ? f['Reference'] : [],
      invoice_pdf:     Array.isArray(f['Invoice PDF']) ? f['Invoice PDF'] : [],
      ...(prefill || {}),
      ...ownerPatch,
    }
    setForm(next)
    setInitialForm(next)
  }, [invoice, prefill, ownerLocked, userEmail])

  useEffect(() => {
    setWorkingRecordId(invoice?.id || null)
  }, [invoice?.id])

  const set  = k => v   => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev  => setForm(f => ({ ...f, [k]: ev.target.value }))

  async function persistDraftRecord() {
    if (currentRecordId) return currentRecordId
    const payload = {
      ...buildInvoiceScalarPayload(form),
      payment_status:  form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date) ? 'Pending' : form.payment_status,
      remark: form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date)
        ? [form.remark, 'Draft created for attachment upload. Complete paid details before final save.'].filter(Boolean).join(' ')
        : form.remark,
    }
    const created = await api.invoices.create(payload)
    const createdId = created?.id
    if (!createdId) throw new Error('Invoice draft was created but no record id was returned')
    setWorkingRecordId(createdId)
    return createdId
  }

  async function handleSave() {
    if (isEdit && !paymentOnly && !hasFormChanges) {
      setError('')
      return
    }
    if (hasPaymentAttempt && form.payment_status !== 'Paid') {
      setError('Payment Status must be Paid when recording received amount or cleared date')
      return
    }
    if (hasPaymentAttempt && !String(form.amount_received).trim()) {
      setError('Amount received is required when status is Paid')
      return
    }
    if (hasPaymentAttempt && !form.cleared_date) {
      setError('Cleared date is required when status is Paid')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = buildInvoiceScalarPayload(form, { isEdit, paymentOnly })
      const saved = currentRecordId ? await api.invoices.update(currentRecordId, payload) : await api.invoices.create(payload)
      setInitialForm(form)
      onSaved(saved)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setDeleting(true)
    try { await api.invoices.delete(invoice.id); onDeleted(invoice.id) }
    catch (e) { setError(e.message || 'Delete failed') }
    finally { setDeleting(false) }
  }

  async function handleParseFile(file) {
    if (!file) return
    setParsing(true); setParseError(''); setParseNote(''); setParseApplied([])
    try {
      const { fields } = await api.invoices.parse(file)
      if (!fields || Object.keys(fields).length === 0) {
        setParseError('AI could not extract any fields from this document. Please fill manually.')
        return
      }
      // Map returned fields onto the form — only overwrite blank fields (preserve user edits)
      const FIELD_MAP = {
        invoice_number:  'invoice_number',
        project:         'project',
        description:     'description',
        raised_date:     'raised_date',
        cleared_date:    'cleared_date',
        amount_raised:   'amount_raised',
        amount_with_tax: 'amount_with_tax',
        amount_received: 'amount_received',
        payment_status:  'payment_status',
        milestone:       'milestone',
        raised_by:       'raised_by',
        remark:          'remark',
      }
      const next = { ...form }
      const applied = []
      let filled = 0
      for (const [aiKey, formKey] of Object.entries(FIELD_MAP)) {
        const val = fields[aiKey]
        if (val == null || val === '') continue
        const cur = form[formKey]
        const isEmpty = cur === '' || cur === null || cur === undefined || cur === 'Pending'
        if (formKey === 'payment_status' || isEmpty) {
          const normalised = (formKey.endsWith('_date') && typeof val === 'string')
            ? val.slice(0, 10)
            : val
          next[formKey] = String(normalised)
          applied.push({
            key: formKey,
            label: INVOICE_PARSE_FIELD_LABELS[formKey] || formKey,
            value: String(normalised),
          })
          if (isEmpty) filled++
        }
      }
      setForm(next)
      setParseApplied(applied)
      setParseNote(`AI filled ${filled} field${filled !== 1 ? 's' : ''} — please review and correct`)
    } catch (e) {
      const status = e.status
      const msg = status === 400 ? e.message               // our explicit error (bad file, unreadable PDF, etc.)
               : status === 413 ? 'File too large (max 10 MB)'
               : status === 403 ? 'Not authorized to use this feature'
               : e.message && !e.message.startsWith('[') ? e.message
               : 'AI parse failed — try a clearer image or a text-based PDF'
      setParseError(msg)
    } finally {
      setParsing(false)
      if (parseFileRef.current) parseFileRef.current.value = ''
    }
  }

  const drawerTitle = paymentOnly
    ? `Record Payment · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}`
    : isEdit ? `Edit · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={drawerTitle}
      width={520}
      accent
      footer={
        <div className="flex items-center justify-between gap-3">
          {isEdit && _canDelete ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Trash2 size={12} />{deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSubmit}
              className={canSubmit ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', opacity: canSubmit ? 1 : 0.62 }}
              title={!canSubmit ? 'No form changes to save' : undefined}
            >
              <Save size={12} />{saving ? 'Saving…' : !canSubmit ? 'No changes' : paymentOnly ? 'Record payment' : isEdit ? 'Save changes' : 'Create invoice'}
            </button>
          </div>
        </div>
      }
    >
      <div className="p-5 space-y-3.5">

          {/* ── AI Invoice Scanner ── */}
          <div>
            <input
              ref={parseFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={e => handleParseFile(e.target.files?.[0])}
            />
            {parsing ? (
              <div className="flex items-center justify-center gap-2.5 p-4 rounded-xl"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                <Loader2 size={15} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  AI is reading your invoice…
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => parseFileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 border-dashed transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ borderColor: 'var(--accent-soft)', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Sparkles size={14} />
                <span className="text-xs font-semibold">Scan Invoice with AI</span>
                <Upload size={12} className="opacity-60" />
                <span className="text-[11px] opacity-60">PDF · PNG · JPG</span>
              </button>
            )}
            {parseNote && !parsing && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>
                <CheckCircle2 size={12} className="flex-shrink-0" />
                {parseNote}
              </div>
            )}
            {parseApplied.length > 0 && !parsing && (
              <div className="mt-2 rounded-xl p-3 space-y-2"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  AI filled these fields
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {parseApplied.map((item) => (
                    <div key={item.key} className="rounded-lg px-2.5 py-2"
                      style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{item.label}</p>
                      <p className="text-xs mt-1 break-words" style={{ color: 'var(--text-1)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {parseError && !parsing && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
                <AlertTriangle size={12} className="flex-shrink-0" />
                {parseError}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          {paymentOnly ? (
            <>
              <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Invoice context</p>
                <p className="text-sm font-semibold mt-2" style={{ color: 'var(--text-1)' }}>{form.invoice_number || invoice?.fields?.['Invoice Number'] || '—'}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  {[form.project || invoice?.fields?.['Project'], form.category || invoice?.fields?.['Category'], form.milestone || invoice?.fields?.['Milestone']].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Payment Status">
                  <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
                </Field>
                <Field label="Cleared Date">
                  <input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Received (₹)">
                  <input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" />
                </Field>
                <Field label="Remark">
                  <input className="input" value={form.remark} onChange={setE('remark')} placeholder="Payment note or settlement details…" />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Invoice Number">
                  <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
                </Field>
                <Field label="Payment Status">
                  <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Client Name">
                  <SelectInput value={form.client_name} onChange={set('client_name')} options={clientNameOptions} placeholder="Select client..." />
                </Field>
                <Field label="Project">
                  <SelectInput value={form.project} onChange={set('project')} options={projectOptions} placeholder="Select project..." />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Category">
                  <SuggestInput value={form.category} onChange={set('category')} options={categoryOptions} placeholder="Type or select category..." listId="invoice-category-options" />
                </Field>
              </div>
              <div>
                <label className="label">Billing Type</label>
                <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: categoryOptions.find(c => !isRetainerCategory(c)) || '' }))}
                    className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={!retainerSelected
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    Project
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: retainerCategoryOption }))}
                    className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={retainerSelected
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    Retainer
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Milestone">
                  <SuggestInput value={form.milestone} onChange={set('milestone')} options={milestoneOptions} placeholder="Type or select milestone..." listId="invoice-milestone-options" />
                </Field>
                <Field label="Raised By">
                  {ownerLocked ? (
                    <div className="input flex items-center gap-2" style={{ color: 'var(--text-1)', background: 'var(--bg-input)' }}>
                      <Mail size={13} style={{ color: 'var(--accent)' }} />
                      <span className="truncate">{userEmail}</span>
                    </div>
                  ) : (
                    <SuggestInput value={form.raised_by} onChange={set('raised_by')} options={raisedByOptions} placeholder="Type or select owner..." listId="invoice-raised-by-options" />
                  )}
                </Field>
              </div>
              <Field label="Description">
                <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></Field>
                <Field label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Raised (₹)"><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></Field>
                <Field label="With GST (₹)"><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></Field>
                <Field label="Received (₹)"><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Next Followup">
                  <div className="flex items-center gap-2">
                    <input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, next_followup: '' }))}
                      className="btn-ghost flex-shrink-0"
                      style={{ fontSize: '0.75rem', padding: '0.55rem 0.75rem' }}
                      title="Clear follow-up date"
                    >
                      <RotateCcw size={12} />Clear
                    </button>
                  </div>
                </Field>
              </div>
              <Field label="Remark">
                <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
              </Field>
            </>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AttachmentUploadField
              label="Invoice PDF"
              fieldKey="invoice_pdf"
              value={form.invoice_pdf}
              onChange={v => setForm(f => ({ ...f, invoice_pdf: v }))}
              recordId={currentRecordId}
              ensureRecord={persistDraftRecord}
            />
            <AttachmentUploadField
              label="Payment Reference"
              fieldKey="reference"
              value={form.reference}
              onChange={v => setForm(f => ({ ...f, reference: v }))}
              recordId={currentRecordId}
              ensureRecord={persistDraftRecord}
            />
          </div>

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs flex items-start gap-2"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--fin-warning)' }} />
              Paid invoices must include Amount Received and Cleared Date. It is also recommended to attach a payment reference screenshot before closing the entry.
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode — put the retainer/client name in Project. The latest retainer row becomes the monthly template; invoice number can be filled later.
            </div>
          )}
        </div>
    </Drawer>
  )
}
