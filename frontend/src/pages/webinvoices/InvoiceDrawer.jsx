// Extracted from WebInvoices.jsx — InvoiceDrawer.
import Drawer from '../../components/Drawer'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../services/api'
import { AlertTriangle, CheckCircle2, Loader2, Mail, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentUploadField, FieldRow, PicklistSelect, SelectInput } from './ui'
import { EMPTY_FORM, STATUSES, buildWebInvoiceScalarPayload, currencySymbol, getProjectCategoryOption, getRetainerCategoryOption, isRetainerCategory, normalizeWebInvoiceScalarForm } from './utils'

export function InvoiceDrawer({
  open,
  invoice,
  draft,
  paymentOnly = false,
  onClose,
  onSaved,
  onDeleted,
  picklists,
  onOptionsUpdate,
  canEditPicklists,
  onPicklistPermissionError,
}) {
  const { userEmail, authRole, isEmailAuth, hasPerm } = useAuth()
  const isEdit = Boolean(invoice?.id)
  const ownerLocked = Boolean(isEmailAuth && userEmail && !['superadmin', 'admin', 'manager', 'finance', 'web_admin'].includes(authRole))
  const canDelete = hasPerm('module.invoices.delete')
  const canCreate = hasPerm('module.invoices.create')
  const canEditInvoice = hasPerm('module.invoices.edit')
  const canPayment = hasPerm('module.invoices.payment')
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error,      setError]      = useState('')
  const [workingRecordId, setWorkingRecordId] = useState(invoice?.id || null)
  const [categoryLocked, setCategoryLocked] = useState(false)
  const [parsing,      setParsing]      = useState(false)
  const [parseError,   setParseError]   = useState('')
  const [parseNote,    setParseNote]    = useState('')
  const [parseApplied, setParseApplied] = useState([])
  const parseFileRef = useRef(null)
  const paidSelected = form.payment_status === 'Paid'
  const hasPaymentAttempt = form.payment_status === 'Paid' || String(form.amount_received).trim() || form.cleared_date
  const hasFormChanges = useMemo(
    () => JSON.stringify(normalizeWebInvoiceScalarForm(form)) !== JSON.stringify(normalizeWebInvoiceScalarForm(initialForm)),
    [form, initialForm]
  )
  const retainerSelected = isRetainerCategory(form.category)
  const retainerCategoryOption = getRetainerCategoryOption(picklists?.Category || [])
  const projectCategoryOption = getProjectCategoryOption(picklists?.Category || [], form.category)
  const currentRecordId = invoice?.id || workingRecordId

  useEffect(() => {
    const ownerPatch = ownerLocked ? { raised_by: userEmail } : {}
    if (!invoice && !draft) {
      const next = { ...EMPTY_FORM, ...ownerPatch }
      setForm(next)
      setInitialForm(next)
      return
    }
    if (!invoice && draft) {
      const next = {
        ...EMPTY_FORM,
        ...draft,
        ...ownerPatch,
      }
      setForm(next)
      setInitialForm(next)
      return
    }
    const f = invoice.fields || {}
    const next = {
      invoice_number:  f['Invoice Number']  || '',
      project:         f['Project']         || '',
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
      currency:        f['Currency']        || 'RS',
      next_followup:   f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
      reference:       Array.isArray(f['Reference'])   ? f['Reference']   : [],
      invoice_pdf:     Array.isArray(f['Invoice PDF']) ? f['Invoice PDF'] : [],
      ...(draft || {}),
    }
    setForm(next)
    setInitialForm(next)
  }, [invoice, draft, ownerLocked, userEmail])

  useEffect(() => {
    setWorkingRecordId(invoice?.id || null)
    setCategoryLocked(Boolean(invoice?.id))
  }, [invoice?.id])

  const set  = k => v  => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev => setForm(f => ({ ...f, [k]: ev.target.value }))
  const setCategoryValue = (next) => {
    setCategoryLocked(true)
    setForm(f => ({ ...f, category: next }))
  }
  const setRetainerMode = (enabled, { force = true } = {}) => {
    const nextCategory = enabled ? retainerCategoryOption : getProjectCategoryOption(picklists?.Category || [], form.category)
    if (!force && categoryLocked) return
    setForm(f => ({
      ...f,
      category: nextCategory,
    }))
    if (force) setCategoryLocked(false)
  }

  useEffect(() => {
    if (!invoice?.id && draft?.category == null) {
      setRetainerMode(retainerSelected, { force: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retainerCategoryOption, projectCategoryOption, retainerSelected, invoice?.id, draft?.category])

  async function persistDraftRecord() {
    if (currentRecordId) return currentRecordId
    const paidDraftIncomplete = form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date)
    const payload = {
      ...buildWebInvoiceScalarPayload(form),
      payment_status:  paidDraftIncomplete ? 'Pending' : form.payment_status,
      remark: paidDraftIncomplete
        ? [form.remark, 'Draft created for attachment upload. Complete paid details before final save.'].filter(Boolean).join(' ')
        : form.remark,
    }
    const created = await api.webInvoices.create(payload)
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
      const payload = buildWebInvoiceScalarPayload(form, { isEdit, paymentOnly })
      const saved = currentRecordId
        ? await api.webInvoices.update(currentRecordId, payload)
        : await api.webInvoices.create(payload)
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
    try { await api.webInvoices.delete(invoice.id); onDeleted(invoice.id) }
    catch (e) { setError(e.message || 'Delete failed') }
    finally { setDeleting(false) }
  }

  async function handleParse(file) {
    if (!file) return
    setParsing(true); setParseError(''); setParseNote(''); setParseApplied([])
    try {
      const { fields } = await api.webInvoices.parse(file)
      const next = { ...form }
      const applied = []
      const MAP = {
        invoice_number: 'Invoice Number', project: 'Project', category: 'Category',
        description: 'Description', milestone: 'Milestone', raised_by: 'Raised By',
        raised_date: 'Raised Date', amount_raised: 'Amount Raised',
        amount_with_tax: 'Amount with Tax',
      }
      let filled = 0
      for (const [formKey, label] of Object.entries(MAP)) {
        const val = fields[formKey] ?? fields[label]
        if (val == null || val === '') continue
        const isEmpty = !next[formKey] || next[formKey] === ''
        const normalised = formKey.endsWith('_date') ? String(val).slice(0, 10) : val
        next[formKey] = String(normalised)
        applied.push({ key: formKey, label, value: String(normalised) })
        if (isEmpty) filled++
      }
      setForm(next)
      setParseApplied(applied)
      setParseNote(`AI filled ${filled} field${filled !== 1 ? 's' : ''} — please review`)
    } catch (e) {
      const msg = e.status === 400 ? e.message
                : e.status === 413 ? 'File too large (max 10 MB)'
                : e.message || 'AI parse failed — try a clearer image or PDF'
      setParseError(msg)
    } finally {
      setParsing(false)
      if (parseFileRef.current) parseFileRef.current.value = ''
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={paymentOnly
        ? `Record Payment · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}`
        : isEdit ? `Edit · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
      width={520}
      accent
      footer={
        <div className="flex items-center justify-between gap-3">
          {isEdit && canDelete ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Trash2 size={12} />{deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Cancel</button>
            {(() => {
              const needsCreatePerm = !isEdit && !canCreate
              const needsEditPerm   = isEdit && !paymentOnly && !canEditInvoice
              const needsPayPerm    = isEdit && paymentOnly && !canPayment
              if (needsCreatePerm || needsEditPerm || needsPayPerm) {
                return (
                  <button disabled className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', opacity: 0.5 }}
                    title="You don't have permission to perform this action">
                    No permission
                  </button>
                )
              }
              const noChanges = !saving && isEdit && !paymentOnly && !hasFormChanges
              return (
                <button
                  onClick={handleSave}
                  disabled={noChanges || saving}
                  className={noChanges ? 'btn-ghost' : 'btn-primary'}
                  style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', opacity: noChanges ? 0.62 : 1 }}
                  title={noChanges ? 'No form changes to save' : undefined}
                >
                  <Save size={12} />{saving ? 'Saving…' : noChanges ? 'No changes' : paymentOnly ? 'Record payment' : currentRecordId ? 'Save changes' : 'Create invoice'}
                </button>
              )
            })()}
          </div>
        </div>
      }
    >
      <div className="p-5 space-y-3.5">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
            </FieldRow>
            <FieldRow label="Payment Status">
              <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Currency">
              <PicklistSelect
                fieldName="Currency"
                value={form.currency}
                onChange={set('currency')}
                options={picklists?.Currency || ['RS', 'USD']}
                onOptionsUpdate={onOptionsUpdate}
                placeholder="Select currency…"
                canAddOptions={canEditPicklists}
                onPermissionError={onPicklistPermissionError}
              />
            </FieldRow>
            <div />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Project">
              <PicklistSelect fieldName="Project" value={form.project} onChange={set('project')}
                options={picklists?.Project || []} onOptionsUpdate={onOptionsUpdate}
                placeholder="Select project…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
            <FieldRow label="Category">
              <PicklistSelect fieldName="Category" value={form.category} onChange={setCategoryValue}
                options={picklists?.Category || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
          </div>

          <div>
            <label className="label">Billing Type</label>
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <button
                type="button"
                onClick={() => setRetainerMode(false)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={!retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Project
              </button>
              <button
                type="button"
                onClick={() => setRetainerMode(true)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Retainer
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Milestone">
              <PicklistSelect fieldName="Milestone" value={form.milestone} onChange={set('milestone')}
                options={picklists?.Milestone || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
            <FieldRow label="Raised By">
              {ownerLocked ? (
                <div className="input flex items-center gap-2" style={{ color: 'var(--text-1)', background: 'var(--bg-input)' }}>
                  <Mail size={13} style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{userEmail}</span>
                </div>
              ) : (
                <PicklistSelect fieldName="Raised By" value={form.raised_by} onChange={set('raised_by')}
                  options={picklists?.['Raised By'] || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                  canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
              )}
            </FieldRow>
          </div>
          <FieldRow label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
          </FieldRow>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></FieldRow>
            <FieldRow label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FieldRow label={`Raised (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></FieldRow>
            <FieldRow label={`With GST (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></FieldRow>
            <FieldRow label={`Received (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Next Followup"><input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} /></FieldRow>
          </div>
          <FieldRow label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
          </FieldRow>

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs flex items-start gap-2"
              style={{ background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
              <span>Paid invoices must include <strong>Amount Received</strong> and <strong>Cleared Date</strong>. Attach a payment reference screenshot before closing the entry.</span>
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode uses the existing table only. Put the retainer/client name in `Project`. The latest retainer row becomes the monthly template, invoice number can be filled later by the account manager, and paused months are stored as zero-value cancelled records with a reason.
            </div>
          )}

          {/* AI parse */}
          {!paymentOnly && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-layer)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>AI autofill from PDF / image</span>
                </div>
                <label className={`btn-ghost cursor-pointer ${parsing ? 'opacity-50 pointer-events-none' : ''}`} style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>
                  {parsing ? <><Loader2 size={12} className="animate-spin" />Parsing…</> : <><Upload size={12} />Upload & fill</>}
                  <input ref={parseFileRef} type="file" accept="image/*,.pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleParse(f) }} />
                </label>
              </div>
              {parseError && <p className="text-xs" style={{ color: 'var(--fin-negative)' }}>{parseError}</p>}
              {parseNote && <p className="text-xs" style={{ color: 'var(--fin-positive)' }}>{parseNote}</p>}
              {parseApplied.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {parseApplied.map(a => (
                    <span key={a.key} className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                      {a.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
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
      </div>
    </Drawer>
  )
}
