import { useState } from 'react'
import { FileText, Loader2, Download, RefreshCw } from 'lucide-react'
import { api } from '../services/api'

export default function Report() {
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)

  const generate = async () => {
    setLoading(true)
    setReport('')
    try {
      const { report: r } = await api.ai.report()
      setReport(r)
    } catch (e) {
      setReport('Failed to generate report: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const download = () => {
    const blob = new Blob([report], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fintrack-report-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Report</h1>
          <p className="text-gray-500 text-sm mt-0.5">Generate an executive summary of your portfolio</p>
        </div>
        <div className="flex gap-2">
          {report && (
            <button onClick={download} className="btn-ghost flex items-center gap-2 text-sm">
              <Download size={14} /> Download
            </button>
          )}
          <button onClick={generate} disabled={loading} className="btn-primary flex items-center gap-2">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {report ? 'Regenerate' : 'Generate Report'}
          </button>
        </div>
      </div>

      {!report && !loading && (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-4">
            <FileText size={28} className="text-brand-400" />
          </div>
          <p className="text-white font-semibold">Generate Your Executive Report</p>
          <p className="text-gray-500 text-sm mt-1 max-w-sm">
            AI will analyze all your projects and create a comprehensive portfolio summary with insights and recommendations.
          </p>
          <button onClick={generate} className="btn-primary mt-5">Generate Now</button>
        </div>
      )}

      {loading && (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <Loader2 size={32} className="animate-spin text-brand-400 mb-4" />
          <p className="text-white font-medium">Analyzing your portfolio...</p>
          <p className="text-gray-500 text-sm mt-1">This may take 15–30 seconds</p>
        </div>
      )}

      {report && (
        <div className="card border-brand-500/20">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b border-surface-700">
            <FileText size={16} className="text-brand-400" />
            <span className="text-sm font-medium text-brand-400">Executive Report</span>
            <span className="text-xs text-gray-500 ml-auto">{new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</span>
          </div>
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">{report}</div>
        </div>
      )}
    </div>
  )
}
