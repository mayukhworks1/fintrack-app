import PublicLayout from '../../components/PublicLayout'
import { ShieldCheck, Lock, Database, FileCheck, EyeOff, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <PublicLayout>
      <main className="flex-1 mx-auto px-4 sm:px-6 py-12 sm:py-16 w-full" style={{ maxWidth: 880 }}>
        {/* Header */}
        <div className="border-b pb-6 mb-8" style={{ borderColor: 'var(--card-border)' }}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold mb-3"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
            <ShieldCheck size={13} />
            Data Protection & Zero-Telemetry Architecture
          </div>
          <h1 className="ft-display text-2xl sm:text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--text-1)' }}>
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm font-mono" style={{ color: 'var(--text-3)' }}>
            Effective Date: January 1, 2026 · FinTrack Financial Operating System · Version 2.8.4
          </p>
        </div>

        {/* Legal Body */}
        <div className="space-y-8 text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              1. Zero Foundation Model Training Guarantee
            </h2>
            <p>
              Your proprietary business documents, invoices, client contracts, Master Services Agreements (MSAs), Statements of Work (SOWs), and tax records are strictly confidential. FinTrack does not, and will never, use customer data, uploaded contract vectors, or ledger entries to train, fine-tune, or improve public AI foundation models.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              2. Vector Embeddings & Document Isolation
            </h2>
            <p>
              When documents are indexed in FinTrack Studio, 768-dimension vector embeddings generated for semantic retrieval (RAG) are stored strictly within the tenant's isolated pgvector namespace. Document chunks are cited with deterministic page and paragraph offsets and are inaccessible across tenant boundaries.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              3. Encryption in Transit and at Rest
            </h2>
            <p>
              All customer ledger databases, file storage buckets, and document stores are encrypted at rest using AES-256. All communications between user browsers, API gateways, and microservices are secured using TLS 1.3 with Perfect Forward Secrecy (PFS).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              4. Telemetry, Tracking & Third-Party Sharing
            </h2>
            <p>
              FinTrack does not sell, broker, or monetize user data. Public analytics are strictly limited to anonymized operational performance indicators (e.g. Core Web Vitals, API latency). We do not embed third-party advertising trackers or invasive behavioral tracking pixels into authenticated application workspaces.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              5. Statutory Tax Data & Form 26AS Privacy
            </h2>
            <p>
              Statutory GST and TDS withholding entries, taxpayer identification numbers (PAN/GSTIN), and invoice reconciliation summaries are processed solely for the subscriber's statutory reporting (e.g., GSTR-1 preparation, 26AS matching) and are never disclosed to third parties without organizational authorization.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              6. Data Sovereignty & Self-Hosting
            </h2>
            <p>
              Organizations requiring complete physical data sovereignty may deploy FinTrack on self-hosted infrastructure (bare metal, private VPC, or sovereign Kubernetes clusters) using our Docker and Helm deployment packages. In self-hosted configurations, 100% of data remains on subscriber hardware.
            </p>
          </section>
        </div>

        {/* Footer Navigation */}
        <div className="mt-12 pt-6 border-t flex items-center justify-between flex-wrap gap-4"
             style={{ borderColor: 'var(--card-border)' }}>
          <Link to="/terms" className="text-xs font-semibold text-[var(--accent)] hover:underline">
            ← Review our Terms of Service
          </Link>
          <Link to="/security" className="text-xs font-semibold text-[var(--accent)] hover:underline">
            Explore Security Architecture & RBAC →
          </Link>
        </div>
      </main>
    </PublicLayout>
  )
}
