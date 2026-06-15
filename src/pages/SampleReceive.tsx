import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { STATUS_LABELS, STATUS_COLORS } from '../types'

function SampleReceive() {
  const { state, createBatch, addSample, getCurrentUser } = useApp()
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [batchName, setBatchName] = useState('')

  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [sampleNo, setSampleNo] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [source, setSource] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const handleCreateBatch = () => {
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
    setShowBatchModal(false)
    setBatchNo('')
    setBatchName('')
    setErrorMsg('')
  }

  const handleAddSample = () => {
    setErrorMsg('')
    setSuccessMsg('')

    if (!selectedBatchId) {
      setErrorMsg('请先选择批次')
      return
    }
    if (!sampleNo.trim()) {
      setErrorMsg('请输入样本编号')
      return
    }
    if (quantity < 1) {
      setErrorMsg('数量必须大于0')
      return
    }
    if (!source.trim()) {
      setErrorMsg('请输入样本来源')
      return
    }

    const user = getCurrentUser()
    const result = addSample({
      batchId: selectedBatchId,
      sampleNo: sampleNo.trim(),
      quantity,
      source: source.trim(),
      status: 'received',
      receivedAt: new Date().toISOString(),
      receivedBy: user?.username || '未知',
    })

    if (result.success) {
      setSuccessMsg(`样本 ${sampleNo} 接收成功！`)
      setSampleNo('')
      setQuantity(1)
    } else {
      setErrorMsg(result.error || '添加失败')
    }
  }

  const selectedBatch = state.batches.find((b) => b.id === selectedBatchId)
  const batchSamples = state.samples.filter((s) => s.batchId === selectedBatchId)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">样本接收</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowBatchModal(true)}
        >
          + 新建批次
        </button>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="card">
        <div className="form-group">
          <label className="form-label">选择批次</label>
          <select
            className="form-input"
            value={selectedBatchId}
            onChange={(e) => setSelectedBatchId(e.target.value)}
          >
            <option value="">-- 请选择批次 --</option>
            {state.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNo} - {b.name || '未命名'}
              </option>
            ))}
          </select>
        </div>

        {selectedBatch && (
          <div style={{ padding: '12px', background: '#f0f7ff', borderRadius: 4, marginBottom: 16 }}>
            <p><strong>批次号：</strong>{selectedBatch.batchNo}</p>
            <p><strong>批次名称：</strong>{selectedBatch.name || '未命名'}</p>
            <p><strong>创建人：</strong>{selectedBatch.createdBy}</p>
            <p><strong>创建时间：</strong>{new Date(selectedBatch.createdAt).toLocaleString('zh-CN')}</p>
            <p><strong>该批次样本数：</strong>{batchSamples.length}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">样本唯一编号 *</label>
            <input
              type="text"
              className="form-input"
              value={sampleNo}
              onChange={(e) => setSampleNo(e.target.value)}
              placeholder="请输入样本编号"
            />
          </div>
          <div className="form-group">
            <label className="form-label">数量 *</label>
            <input
              type="number"
              className="form-input"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              min={1}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">样本来源 *</label>
          <input
            type="text"
            className="form-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="例如：检验科、内科病房、外部送检等"
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleAddSample}
          style={{ width: '100%', padding: 12, fontSize: 16 }}
        >
          确认接收
        </button>
      </div>

      {selectedBatchId && batchSamples.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>本批次已接收样本</h3>
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
                  <td>{s.sampleNo}</td>
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
            </tbody>
          </table>
        </div>
      )}

      {showBatchModal && (
        <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">新建批次</div>
              <div className="modal-close" onClick={() => setShowBatchModal(false)}>×</div>
            </div>
            <div className="modal-body">
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
              <button className="btn btn-default" onClick={() => setShowBatchModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreateBatch}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SampleReceive
