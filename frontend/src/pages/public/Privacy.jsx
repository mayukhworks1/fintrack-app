/**
 * Privacy Policy. The text below is the policy as written; only its frame
 * (title, landmarks, contents list) lives in LegalPage.
 */
import LegalPage from '../../components/secondary/LegalPage'

const META = {
  title: "Privacy policy — FinTrack",
  description: "How FinTrack isolates your data, what it records, and why your records are never used to train AI models.",
  path: '/privacy',
}

const SECTIONS = [
  {
    heading: "1. Zero Foundation Model Training Guarantee",
    body: "Your proprietary business documents, invoices, client contracts, Master Services Agreements (MSAs), Statements of Work (SOWs), and tax records are strictly confidential. FinTrack does not, and will never, use customer data, uploaded contract vectors, or ledger entries to train, fine-tune, or improve public AI foundation models.",
  },
  {
    heading: "2. Vector Embeddings & Document Isolation",
    body: "When documents are indexed in FinTrack Studio, 768-dimension vector embeddings generated for semantic retrieval (RAG) are stored strictly within the tenant's isolated pgvector namespace. Document chunks are cited with deterministic page and paragraph offsets and are inaccessible across tenant boundaries.",
  },
  {
    heading: "3. Encryption in Transit and at Rest",
    body: "All customer ledger databases, file storage buckets, and document stores are encrypted at rest using AES-256. All communications between user browsers, API gateways, and microservices are secured using TLS 1.3 with Perfect Forward Secrecy (PFS).",
  },
  {
    heading: "4. Telemetry, Tracking & Third-Party Sharing",
    body: "FinTrack does not sell, broker, or monetize user data. Public analytics are strictly limited to anonymized operational performance indicators (e.g. Core Web Vitals, API latency). We do not embed third-party advertising trackers or invasive behavioral tracking pixels into authenticated application workspaces.",
  },
  {
    heading: "5. Statutory Tax Data & Form 26AS Privacy",
    body: "Statutory GST and TDS withholding entries, taxpayer identification numbers (PAN/GSTIN), and invoice reconciliation summaries are processed solely for the subscriber's statutory reporting (e.g., GSTR-1 preparation, 26AS matching) and are never disclosed to third parties without organizational authorization.",
  },
  {
    heading: "6. Data Sovereignty & Self-Hosting",
    body: "Organizations requiring complete physical data sovereignty may deploy FinTrack on self-hosted infrastructure (bare metal, private VPC, or sovereign Kubernetes clusters) using our Docker and Helm deployment packages. In self-hosted configurations, 100% of data remains on subscriber hardware.",
  },
]

const LINKS = [{ to: '/terms', label: "Terms of service →" }, { to: '/security', label: "Security and access →" }]

export default function Privacy() {
  return (
    <LegalPage meta={META} title="Privacy Policy"
               stamp="Effective Date: January 1, 2026 · FinTrack Financial Operating System · Version 2.8.4"
               sections={SECTIONS} links={LINKS} />
  )
}
