/**
 * Terms of Service. The text below is the policy as written; only its frame
 * (title, landmarks, contents list) lives in LegalPage.
 */
import LegalPage from '../../components/secondary/LegalPage'

const META = {
  title: "Terms of service — FinTrack",
  description: "The terms that govern use of the FinTrack platform.",
  path: '/terms',
}

const SECTIONS = [
  {
    heading: "1. Platform Scope & Enterprise Service Provision",
    body: "FinTrack provides a single-ledger financial tracking, invoice receivables management, statutory tax reconciliation (GST & Section 194J/194C TDS withholding), project delivery monitoring, and deterministic AI document synthesis service. By provisioning a tenant or connecting an authenticated session, the subscribing entity agrees to these terms.",
  },
  {
    heading: "2. Single Source of Truth & Deterministic Computation",
    body: "FinTrack executes all aggregations, aging band calculations, and tax escrow projections deterministically against the subscriber's PostgreSQL database mirror. The AI assistant and natural language querying features operate as Abstract Syntax Tree (AST) transpilers bound to schema constraints and do not generate arbitrary or unverified arithmetic.",
  },
  {
    heading: "3. Tenant Isolation & Cryptographic Access Boundaries",
    body: "Each organization operates within a segregated tenant boundary. Server-side session authentication enforces strict Row-Level Security (RLS) and cryptographic parameter verification. Cross-tenant data leakage is prevented at both the application proxy and database query levels.",
  },
  {
    heading: "4. Role-Based Access Control (RBAC) & Client Sharing",
    body: "Subscribers may assign granular roles (Owner, Admin, Member, Read-Only, Client Viewer) to internal and external actors. Client delivery portals and shared milestone links may be generated with optional time-based expiration and cryptographic passcodes. The subscribing organization maintains administrative authority over user lifecycle management and token revocation.",
  },
  {
    heading: "5. Immutable Audit Trail & Regulatory Compliance",
    body: "All write operations, invoice status transitions, payment settlements, and administrative permission changes are logged to an append-only, SHA-256 verified audit ledger. Audit log entries cannot be modified or deleted post-transaction.",
  },
  {
    heading: "6. Service Level Agreement (SLA) & Uptime",
    body: "FinTrack cloud deployments maintain a 99.95% monthly availability commitment. Self-hosted instances are provided with infrastructure Helm charts and automated migration scripts subject to the organization's underlying host infrastructure.",
  },
]

const LINKS = [{ to: '/privacy', label: "Privacy policy →" }, { to: '/login', label: "Sign in →" }]

export default function Terms() {
  return (
    <LegalPage meta={META} title="Terms of Service"
               stamp="Last updated: January 1, 2026 · FinTrack Financial Operating System · Version 2.8.4"
               sections={SECTIONS} links={LINKS} />
  )
}
