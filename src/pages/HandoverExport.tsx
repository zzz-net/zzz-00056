import { useState } from 'react'
import { useApp } from '../store/AppContext'

function HandoverExport() {
  const { state, exportHandoverCSV, doExportCSV } = useApp()
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const reviewedSamples = state.samples.filter((s) => s.status === 'reviewed')
  const filteredSamples = selectedBatchId
    ? reviewedSamples.filter((s) => s.batchId === selectedBatchId)
    : reviewedSamples

  const handleExport = async () => {
    const csvContent = exportHandoverCSV(selectedBatchId || undefined)
    if (filteredSamples.length === 0) {
      alert('没有可导出的复核通过样本')
      return
    }
    const batch = state.batches.find((b) => b.id === selectedBatchId)
    const fileName = batch
      ? `交接清单_${batch.batchNo}_${new Date().toISOString().slice(0, 10)}.csv`
      : `交接清单_全部_${new Date().toISOString().slice(0, 10)}.csv`

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
        <h1 className="page-title">交接清单导出</h1>
      </div>

      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
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

        <p style={{ color: '#666', marginBottom: 16 }}>
          共 <strong style={{ color: '#1890ff' }}>{filteredSamples.length}</strong> 条已复核通过的样本可导出
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>样本编号</th>
              <th>所属批次</th>
              <th>数量</th>
              <th>来源</th>
              <th>接收时间</th>
              <th>接收人</th>
              <th>交接人</th>
              <th>交接时间</th>
            </tr>
          </thead>
          <tbody>
            {filteredSamples.map((s) => {
              const batch = state.batches.find((b) => b.id === s.batchId)
              return (
                <tr key={s.id}>
                  <td><strong>{s.sampleNo}</strong></td>
                  <td>{batch?.batchNo || '-'}</td>
                  <td>{s.quantity}</td>
                  <td>{s.source}</td>
                  <td>{new Date(s.receivedAt).toLocaleString('zh-CN')}</td>
                  <td>{s.receivedBy}</td>
                  <td><strong style={{ color: '#722ed1' }}>{s.handoverBy || '-'}</strong></td>
                  <td>{s.handoverAt ? new Date(s.handoverAt).toLocaleString('zh-CN') : '-'}</td>
                </tr>
              )
            })}
            {filteredSamples.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: '#999', padding: 40 }}>
                  暂无复核通过的样本
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>导出说明</h3>
        <ul style={{ color: '#666', lineHeight: 2, paddingLeft: 20 }}>
          <li>仅状态为"已复核通过"的样本会被导出到交接清单</li>
          <li>导出格式为 CSV，可直接用 Excel 打开</li>
          <li>可按批次筛选导出，或导出全部已通过样本</li>
          <li>文件名自动包含批次号和导出日期</li>
        </ul>
      </div>
    </div>
  )
}

export default HandoverExport
