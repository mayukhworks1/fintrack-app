import PublicLayout from '../../components/PublicLayout'
import { FileText, ShieldCheck, Scale, Lock, Database, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Terms() {
  return (
    <PublicLayout>
      <main className="flex-1 mx-auto px-4 sm:px-6 py-12 sm:py-16 w-full" style={{ maxWidth: 880 }}>
        {/* Header */}
        <div className="border-b pb-6 mb-8" style={{ borderColor: 'var(--card-border)' }}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold mb-3"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
            <Scale size={13} />
            Institutional Governance & SLA
          </div>
          <h1 className="ft-display text-2xl sm:text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--text-1)' }}>
            Terms of Service
          </h1>
          <p className="text-xs sm:text-sm font-mono" style={{ color: 'var(--text-3)' }}>
            Last updated: January 1, 2026 · FinTrack Financial Operating System · Version 2.8.4
          </p>
        </div>

        {/* Legal Body */}
        <div className="space-y-8 text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              1. Platform Scope & Enterprise Service Provision
            </h2>
            <p>
              FinTrack provides a single-ledger financial tracking, invoice receivables management, statutory tax reconciliation (GST & Section 194J/194C TDS withholding), project delivery monitoring, and deterministic AI document synthesis service. By provisioning a tenant or connecting an authenticated session, the subscribing entity agrees to these terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              2. Single Source of Truth & Deterministic Computation
            </h2>
            <p>
              FinTrack executes all aggregations, aging band calculations, and tax escrow projections deterministically against the subscriber's PostgreSQL database mirror. The AI assistant and natural language querying features operate as Abstract Syntax Tree (AST) transpilers bound to schema constraints and do not generate arbitrary or unverified arithmetic.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              3. Tenant Isolation & Cryptographic Access Boundaries
            </h2>
            <p>
              Each organization operates within a segregated tenant boundary. Server-side session authentication enforces strict Row-Level Security (RLS) and cryptographic parameter verification. Cross-tenant data leakage is prevented at both the application proxy and database query levels.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              4. Role-Based Access Control (RBAC) & Client Sharing
            </h2>
            <p>
              Subscribers may assign granular roles (Owner, Admin, Member, Read-Only, Client Viewer) to internal and external actors. Client delivery portals and shared milestone links may be generated with optional time-based expiration and cryptographic passcodes. The subscribing organization maintains administrative authority over user lifecycle management and token revocation.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              5. Immutable Audit Trail & Regulatory Compliance
            </h2>
            <p>
              All write operations, invoice status transitions, payment settlements, and administrative permission changes are logged to an append-only, SHA-256 verified audit ledger. Audit log entries cannot be modified or deleted post-transaction.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              6. Service Level Agreement (SLA) & Uptime
            </h2>
            <p>
              FinTrack cloud deployments maintain a 99.95% monthly availability commitment. Self-hosted instances are provided with infrastructure Helm charts and automated migration scripts subject to the organization's underlying host infrastructure.
            </p>
          </section>
        </div>

        {/* Footer Navigation */}
        <div className="mt-12 pt-6 border-t flex items-center justify-between flex-wrap gap-4"
             style={{ borderColor: 'var(--card-border)' }}>
          <Link to="/privacy" className="text-xs font-semibold text-[var(--accent)] hover:underline">
            Read our Privacy Policy & Data Residency →
          </Link>
          <Link to="/login" className="px-4 py-2 rounded-lg text-xs font-bold text-white"
                style={{ background: 'var(--accent-btn)' }}>
            Sign in to Workspace
          </Link>
        </div>
      </main>
    </PublicLayout>
  )
}
