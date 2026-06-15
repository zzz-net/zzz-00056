import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { STATUS_LABELS, STATUS_COLORS, SampleStatus } from '../types'

function BatchList() {
  const { state, createBatch } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [batchName, setBatchName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)

  const handleCreate = () => {
    setErrorMsg('')
    if (!batchNo.trim()) {
      setErrorMsg('请输入批次编号')
      return
    }
    const exists = state.batches.some((b) => b.batchNo === batchNo.trim())
    if (exists) {
      setErrorMsg('批次编号已存在')
      return
    }
    createBatch(batchNo.trim(), batchName.trim())
    setShowModal(false)
    setBatchNo('')
    setBatchName('')
  }

  const getBatchStats = (batchId: string) => {
    const samples = state.samples.filter((s) => s.batchId === batchId)
    const stats: Record<string, number> = {}
    samples.forEach((s) => {
      stats[s.status] = (stats[s.status] || 0) + 1
    })
    return { total: samples.length, stats }
  }

  const selectedBatch = state.batches.find((b) => b.id === selectedBatchId)
  const batchSamples = state.samples.filter((s) => s.batchId === selectedBatchId)

  const statusOrder: SampleStatus[] = ['received', 'aliquoted', 'reviewing', 'reviewed', 'returned']

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">批次管理</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + 新建批次
        </button>
      </div>

      <div>
        {state.batches.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: '#999', padding: 60 }}>
            暂无批次，点击右上角新建批次
          </div>
        ) : (
          state.batches.map((batch) => {
            const { total, stats } = getBatchStats(batch.id)
            const isSelected = selectedBatchId === batch.id
            return (
              <div
                key={batch.id}
                className="batch-card"
                style={{
                  border: isSelected ? '2px solid #1890ff' : 'none',
                }}
                onClick={() => setSelectedBatchId(isSelected ? null : batch.id)}
              >
                <div className="batch-info">
                  <h3>{batch.batchNo}</h3>
                  <p>{batch.name || '未命名'}</p>
                  <p style={{ marginTop: 6 }}>
                    创建人：{batch.createdBy} | {new Date(batch.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="batch-stats">
                  <div className="stat-item">
                    <div className="stat-value">{total}</div>
                    <div className="stat-label">总数</div>
                  </div>
                  {statusOrder.map((s) =>
                    stats[s] ? (
                      <div key={s} className="stat-item">
                        <div className="stat-value" style={{ color: STATUS_COLORS[s] }}>
                          {stats[s]}
                        </div>
                        <div className="stat-label">{STATUS_LABELS[s]}</div>
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {selectedBatch && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 16 }}>
            批次详情 - {selectedBatch.batchNo}
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th>样本编号</th>
                <th>数量</th>
                <th>来源</th>
                <th>状态</th>
                <th>接收时间</th>
              </tr>
            </thead>
            <tbody>
              {batchSamples.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.sampleNo}</strong></td>
                  <td>{s.quantity}</td>
                  <td>{s.source}</td>
                  <td>
                    <span
                      className="status-tag"
                      style={{ background: STATUS_COLORS[s.status] }}
                    >
                      {STATUS_LABELS[s.status]}
                    </span>
                  </td>
                  <td>{new Date(s.receivedAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {batchSamples.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#999', padding: 30 }}>
                    该批次暂无样本
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">新建批次</div>
              <div className="modal-close" onClick={() => setShowModal(false)}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <div className="form-group">
                <label className="form-label">批次编号 *</label>
                <input
                  type="text"
                  className="form-input"
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  placeholder="例如：BATCH-20240616-001"
                />
              </div>
              <div className="form-group">
                <label className="form-label">批次名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="例如：6月16日第一批送检"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => setShowModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BatchList
