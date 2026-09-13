import { useState } from 'react'
import { FileSearch, Sparkles, Check, ChevronRight, Layers, Play, Maximize2, X, ExternalLink, ShieldAlert } from 'lucide-react'
import { useTilt } from '../hooks/useTilt'

const SAMPLE_QUERIES = [
  {
    q: 'What is the late payment interest penalty clause?',
    citation: 'Section 4.3 — Late Settlement & Remedies (Page 2)',
    badge: 'Page 2, §4.3',
    snippet:
      'In the event Client fails to remit payment within forty-five (45) days of invoice date, interest shall accrue at the rate of 1.5% per month or the statutory maximum rate, calculated daily from the due date until full settlement.',
    answer:
      'Interest accrues at 1.5% per month (or statutory maximum) calculated daily for balances exceeding the 45-day net terms window.',
  },
  {
    q: 'What are the deliverable milestone acceptance criteria?',
    citation: 'Section 7.1 — Sign-off & Client Review Period (Page 4)',
    badge: 'Page 4, §7.1',
    snippet:
      'Client shall have ten (10) business days following delivery to review and provide written notice of non-conformity. In the absence of written rejection within said period, the milestone deliverable shall be deemed accepted and invoice ready.',
    answer:
      'Milestones are deemed accepted automatically after 10 business days unless formal written non-conformity is logged.',
  },
  {
    q: 'Check TDS certificate and tax indemnity covenants',
    citation: 'Section 9.4 — Tax Withholding & Form 16A Filings (Page 5)',
    badge: 'Page 5, §9.4',
    snippet:
      'Where tax is deducted at source pursuant to Indian Income Tax Act Section 194J/194C, Client covenants to issue quarterly Form 16A certificates within forty-five (45) days of the calendar quarter ending.',
    answer:
      'Client must deliver Form 16A certificates within 45 days of each quarter ending for all TDS deductions.',
  },
]

export default function ContractCitationInspector() {
  const [activeQuery, setActiveQuery] = useState(0)
  const [activeMedia, setActiveMedia] = useState('inspector') // 'inspector' | 'blueprint' | 'motion'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const tiltRef = useTilt({ max: 3 })

  const current = SAMPLE_QUERIES[activeQuery]

  return (
    <div
      ref={tiltRef}
      className="rounded-3xl p-6 sm:p-8 lg:p-10 transition-all duration-300 relative overflow-hidden ft-glow-border"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--card-border)]">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-2"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            <FileSearch size={13} />
            Contract Intelligence & Page-Level Citations
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Zero-hallucination semantic clause inspection
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Every answer is anchored to exact page numbers and paragraph coordinates. Click prompt chips to see the document jump and highlight.
          </p>
        </div>

        {/* Media Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('inspector')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'inspector' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'inspector' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'inspector' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            Inspector
          </button>
          <button
            onClick={() => setActiveMedia('blueprint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'blueprint' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'blueprint' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'blueprint' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Layers size={13} />
            3D View
          </button>
          <button
            onClick={() => setActiveMedia('motion')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'motion' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'motion' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'motion' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Play size={13} />
            Motion
          </button>
        </div>
      </div>

      {activeMedia === 'inspector' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Interactive Prompts & Answer */}
          <div className="lg:col-span-6 flex flex-col gap-4">
            <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Ask your legal agreements & statements of work:
            </label>

            <div className="flex flex-col gap-2">
              {SAMPLE_QUERIES.map((sq, idx) => {
                const isSelected = idx === activeQuery
                return (
                  <button
                    key={sq.q}
                    onClick={() => setActiveQuery(idx)}
                    className="p-3.5 rounded-xl text-left transition-all flex items-start justify-between gap-3 group"
                    style={{
                      background: isSelected ? 'var(--accent-dim)' : 'var(--bg-input)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--card-border)'}`,
                      color: isSelected ? 'var(--accent)' : 'var(--text-1)',
                    }}
                  >
                    <div className="min-w-0">
                      <span className="block font-semibold text-xs sm:text-sm">{sq.q}</span>
                      <span className="block text-[11px] mt-1 font-mono opacity-80 truncate" style={{ color: 'var(--text-3)' }}>
                        {sq.citation}
                      </span>
                    </div>
                    <ChevronRight size={16} className={`shrink-0 mt-1 transition-transform ${isSelected ? 'rotate-90 text-[var(--accent)]' : 'text-[var(--text-3)]'}`} />
                  </button>
                )
              })}
            </div>

            {/* Answer Synthesis Box */}
            <div className="rounded-2xl p-4 sm:p-5 mt-2 border"
                 style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--text-1)' }}>
                  Verified Answer (Citation Linked)
                </span>
              </div>
              <p className="text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {current.answer}
              </p>
            </div>
          </div>

          {/* Right Column: Simulated PDF Sheet with Live Highlight */}
          <div className="lg:col-span-6 flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[var(--text-2)]">
                Master Services Agreement (MSA_2026_Final.pdf)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-sky-500/10 text-sky-500 border border-sky-500/20">
                {current.badge}
              </span>
            </div>

            {/* Paper Document Container */}
            <div className="rounded-2xl p-5 sm:p-6 border shadow-lg relative min-h-[300px] flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              {/* Document Mock Header */}
              <div className="border-b pb-3 mb-4 flex items-center justify-between" style={{ borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-mono tracking-widest text-[var(--text-3)]">
                  Confidential · Legal Document Review
                </span>
                <span className="text-[10px] font-mono text-[var(--text-3)]">
                  Page 1 of 8
                </span>
              </div>

              {/* Document Text Paragraphs */}
              <div className="text-xs leading-relaxed font-serif text-[var(--text-3)] space-y-3">
                <p className="opacity-40">
                  1.1 Scope of Services. The Service Provider shall perform the services described in each applicable Statement of Work executed by authorized signatories of both parties...
                </p>

                {/* Highlighted Target Clause */}
                <div
                  key={current.q}
                  className="p-3 rounded-xl border relative shadow-sm"
                  style={{
                    background: 'var(--accent-dim)',
                    borderColor: 'var(--accent-soft)',
                    color: 'var(--text-1)',
                    animation: 'ft-pop-in 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-bold" style={{ color: 'var(--accent)' }}>
                    <Sparkles size={12} />
                    <span>{current.citation}</span>
                  </div>
                  <p className="font-sans text-xs sm:text-[13px] leading-relaxed font-medium">
                    "{current.snippet}"
                  </p>
                </div>

                <p className="opacity-40">
                  12.3 Governing Law & Jurisdiction. This Agreement shall be governed by and construed in accordance with the laws of India, and the courts of New Delhi shall have exclusive jurisdiction...
                </p>
              </div>

              <div className="mt-4 pt-3 border-t flex items-center justify-between text-[11px]"
                   style={{ borderColor: 'var(--card-border)', color: 'var(--text-3)' }}>
                <span>100% Vectorized OCR & AST Matching</span>
                <span className="text-[var(--accent)] font-semibold">Strict Provenance Proof</span>
              </div>
            </div>
          </div>
        </div>
      ) : activeMedia === 'blueprint' ? (
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <img
            src="/media/pomelli_photoshoot-4.png"
            alt="3D Document Intelligence Blueprint"
            className="max-h-[360px] w-auto object-contain rounded-lg drop-shadow-2xl"
          />
          <button
            onClick={() => setLightboxOpen(true)}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900/90 text-white border border-slate-700 hover:border-sky-400 backdrop-blur transition-all"
          >
            <Maximize2 size={13} /> Inspect High-Res
          </button>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden p-4 bg-slate-950 flex items-center justify-center min-h-[380px]">
          <video
            src="/media/pomelli_photoshoot-7.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="max-h-[360px] w-auto object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[92vh] flex flex-col rounded-2xl overflow-hidden bg-slate-900 border border-slate-700 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">Contract & Document Intelligence 3D Blueprint</span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center">
              <img
                src="/media/pomelli_photoshoot-4.png"
                alt="Document Intelligence"
                className="max-h-[78vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
