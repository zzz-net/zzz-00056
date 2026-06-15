import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { STATUS_LABELS, STATUS_COLORS } from '../types'

function BatchLedger() {
  const { state, exportBatchLedgerCSV, doExportCSV, getBatchLedgerSummary } = useApp()
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const selectedBatch = state.batches.find((b) => b.id === selectedBatchId)

  const filteredLedger = selectedBatchId
    ? state.batchLedger.filter((l) => l.batchId === selectedBatchId)
    : state.batchLedger

  const sortedLedger = [...filteredLedger].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const summary = selectedBatchId ? getBatchLedgerSummary(selectedBatchId) : null

  const handleExport = async () => {
    const csvContent = exportBatchLedgerCSV(selectedBatchId || undefined)
    if (sortedLedger.length === 0) {
      alert('没有可导出的台账记录')
      return
    }
    const batch = state.batches.find((b) => b.id === selectedBatchId)
    const fileName = batch
      ? `批次流转台账_${batch.batchNo}_${new Date().toISOString().slice(0, 10)}.csv`
      : `批次流转台账_全部_${new Date().toISOString().slice(0, 10)}.csv`

    try {
      const result = await doExportCSV(csvContent, fileName)
      if (result) {
        setSuccessMsg('导出成功！')
        setTimeout(() => setSuccessMsg(''), 3000)
      }
    } catch (e) {
      alert('导出失败')
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">批次流转台账</h1>
      </div>

      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label" style={{ marginBottom: 4 }}>选择批次</label>
            <select
              className="form-input"
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
            >
              <option value="">全部批次</option>
              {state.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} - {b.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleExport}>
              📥 导出 CSV
            </button>
          </div>
        </div>

        {summary && (
          <div style={{ marginTop: 16, padding: 16, background: '#f0f7ff', borderRadius: 4 }}>
            <h4 style={{ marginBottom: 12 }}>批次摘要 - {selectedBatch?.batchNo}</h4>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1890ff' }}>
                  {summary.totalSamples}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>样本总数</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#722ed1' }}>
                  {summary.totalActions}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>动作总数</div>
              </div>
              {Object.entries(summary.byAction).map(([action, count]) => (
                <div key={action}>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>
                    {count}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>{action}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p style={{ color: '#666', margin: '16px 0' }}>
          共 <strong style={{ color: '#1890ff' }}>{sortedLedger.length}</strong> 条台账记录
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>批次号</th>
              <th>样本编号</th>
              <th>动作</th>
              <th>操作人</th>
              <th>原状态</th>
              <th>新状态</th>
              <th>原因</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {sortedLedger.map((l) => {
              const batch = state.batches.find((b) => b.id === l.batchId)
              return (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {new Date(l.timestamp).toLocaleString('zh-CN')}
                  </td>
                  <td>{batch?.batchNo || '-'}</td>
                  <td><strong>{l.sampleNo}</strong></td>
                  <td>
                    <span
                      className="status-tag"
                      style={{
                        background: (STATUS_COLORS as any)[l.toStatus] || '#999',
                      }}
                    >
                      {l.action}
                    </span>
                  </td>
                  <td>{l.operatorName}</td>
                  <td style={{ color: '#999' }}>
                    {l.fromStatus ? (STATUS_LABELS as any)[l.fromStatus] || l.fromStatus : '无'}
                  </td>
                  <td>
                    <span style={{ color: (STATUS_COLORS as any)[l.toStatus] || '#333', fontWeight: 'bold' }}>
                      {(STATUS_LABELS as any)[l.toStatus] || l.toStatus}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{l.reason || '-'}</td>
                  <td style={{ fontSize: 12 }}>{l.remark || '-'}</td>
                </tr>
              )
            })}
            {sortedLedger.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: '#999', padding: 40 }}>
                  暂无台账记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default BatchLedger
