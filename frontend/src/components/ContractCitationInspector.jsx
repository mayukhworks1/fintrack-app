import { useState } from 'react'
import { FileSearch, Check, ChevronRight, Layers, ExternalLink, ShieldAlert, Sliders, Activity } from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import LoopVideo from './LoopVideo'

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
  const [activeMedia, setActiveMedia] = useState('inspector') // 'inspector' | 'blueprint'
  const tiltRef = useTilt({ max: 3 })

  const current = SAMPLE_QUERIES[activeQuery]

  return (
    <div
      ref={tiltRef}
      className="rounded-xl p-6 sm:p-8 lg:p-10 transition-all duration-300 relative overflow-hidden"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--card-border)]">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold mb-2"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
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

        {/* View Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('inspector')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'inspector' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'inspector' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'inspector' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Sliders size={13} />
            Inspector
          </button>
          <button
            onClick={() => setActiveMedia('blueprint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'blueprint' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'blueprint' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'blueprint' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Layers size={13} />
            3D Vector Engine
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
                    className="p-3.5 rounded-xl text-left transition-all flex items-start justify-between gap-3 group cursor-pointer"
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
              <div className="mt-3 pt-2.5 border-t flex items-center justify-between text-[11px]"
                   style={{ borderColor: 'var(--card-border)', color: 'var(--text-3)' }}>
                <span className="font-mono">{current.badge}</span>
                <span className="text-emerald-500 font-semibold flex items-center gap-1">
                  <Check size={12} /> Cosine Similarity: 0.94
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Highlighted Document Coordinates View */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl p-5 sm:p-6 border relative"
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
                    <FileSearch size={12} />
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
      ) : (
        /* 3D Vector Architecture Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Vector Engine Specs */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Vector Embeddings & OCR Pipeline
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                Hybrid pgvector semantic indexing & AST clause boundary detection
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                Contracts and statements of work are parsed into hierarchical markdown trees, embedded in pgvector, and retrieved with strict citation grounding.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  'HNSW vector indexing in Postgres',
                  'Page-number and bounding-box coordinates',
                  'Strict source verification before response',
                  'Zero synthetic clauses or hallucinations',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Embedding Latency</span>
                  <span className="font-extrabold text-sm text-[var(--accent)]">&lt; 40ms</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Grounding Precision</span>
                  <span className="font-extrabold text-sm text-emerald-500">100% Verifiable</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Framed 3D Render Loop */}
          <div className="lg:col-span-6 flex items-center justify-center">
            <div className="w-full max-w-[380px] sm:max-w-[420px] rounded-2xl overflow-hidden p-3 transition-all duration-300 relative"
                 style={{
                   background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.95))',
                   border: '1px solid rgba(255,255,255,0.1)',
                   boxShadow: '0 12px 35px rgba(37,99,235,0.15)',
                 }}>
              <div className="relative rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center aspect-[4/3]">
                <LoopVideo src="/media/pomelli_photoshoot-7.mp4" className="w-full h-full object-cover rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
