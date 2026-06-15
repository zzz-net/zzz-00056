import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { STATUS_LABELS, STATUS_COLORS, SampleStatus } from '../types'

function SampleList() {
  const { state, changeSampleStatus, undoLastStatus, canReview } = useApp()
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showActionModal, setShowActionModal] = useState(false)
  const [actionType, setActionType] = useState<'' | 'aliquot' | 'review' | 'return' | 'reviewed'>('')
  const [reason, setReason] = useState('')
  const [remark, setRemark] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [filterStatus, setFilterStatus] = useState<SampleStatus | ''>('')
  const [filterBatchId, setFilterBatchId] = useState('')

  const selectedSample = state.samples.find((s) => s.id === selectedSampleId)

  const filteredSamples = state.samples.filter((s) => {
    if (filterStatus && s.status !== filterStatus) return false
    if (filterBatchId && s.batchId !== filterBatchId) return false
    return true
  })

  const openAction = (type: typeof actionType) => {
    setActionType(type)
    setReason('')
    setRemark('')
    setErrorMsg('')
    setShowActionModal(true)
  }

  const handleAction = () => {
    if (!selectedSampleId) return
    setErrorMsg('')

    let newStatus: SampleStatus | null = null
    let actionName = ''

    switch (actionType) {
      case 'aliquot':
        newStatus = 'aliquoted'
        actionName = '分装'
        break
      case 'review':
        newStatus = 'reviewing'
        actionName = '提交复核'
        break
      case 'reviewed':
        newStatus = 'reviewed'
        actionName = '复核通过'
        break
      case 'return':
        newStatus = 'returned'
        actionName = '退回'
        if (!reason.trim()) {
          setErrorMsg('退回必须填写原因')
          return
        }
        break
    }

    if (newStatus) {
      const result = changeSampleStatus(
        selectedSampleId,
        newStatus,
        actionName,
        reason || undefined,
        remark || undefined
      )
      if (result.success) {
        setShowActionModal(false)
      } else {
        setErrorMsg(result.error || '操作失败')
      }
    }
  }

  const handleUndo = () => {
    if (!selectedSampleId) return
    const result = undoLastStatus(selectedSampleId)
    if (!result.success) {
      alert(result.error)
    }
  }

  const getAvailableActions = (status: SampleStatus) => {
    const actions: { key: string; label: string; type: typeof actionType; className: string }[] = []
    switch (status) {
      case 'received':
        actions.push({ key: 'aliquot', label: '分装', type: 'aliquot', className: 'btn-success' })
        actions.push({ key: 'return', label: '退回', type: 'return', className: 'btn-danger' })
        break
      case 'aliquoted':
        actions.push({ key: 'review', label: '提交复核', type: 'review', className: 'btn-warning' })
        actions.push({ key: 'return', label: '退回', type: 'return', className: 'btn-danger' })
        break
      case 'reviewing':
        if (canReview()) {
          actions.push({ key: 'reviewed', label: '复核通过', type: 'reviewed', className: 'btn-success' })
        }
        actions.push({ key: 'return', label: '退回', type: 'return', className: 'btn-danger' })
        break
      case 'returned':
        break
      case 'reviewed':
        break
    }
    return actions
  }

  const getActionTitle = () => {
    switch (actionType) {
      case 'aliquot': return '确认分装'
      case 'review': return '提交复核'
      case 'reviewed': return '复核通过'
      case 'return': return '退回样本'
      default: return ''
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">样本列表</h1>
      </div>

      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" style={{ marginBottom: 4 }}>按状态筛选</label>
          <select
            className="form-input"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as SampleStatus | '')}
            style={{ width: 150 }}
          >
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" style={{ marginBottom: 4 }}>按批次筛选</label>
          <select
            className="form-input"
            value={filterBatchId}
            onChange={(e) => setFilterBatchId(e.target.value)}
            style={{ width: 200 }}
          >
            <option value="">全部批次</option>
            {state.batches.map((b) => (
              <option key={b.id} value={b.id}>{b.batchNo} - {b.name}</option>
            ))}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', color: '#666' }}>
          共 {filteredSamples.length} 条记录
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>样本编号</th>
              <th>所属批次</th>
              <th>数量</th>
              <th>来源</th>
              <th>状态</th>
              <th>接收时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredSamples.map((s) => {
              const batch = state.batches.find((b) => b.id === s.batchId)
              const actions = getAvailableActions(s.status)
              return (
                <tr key={s.id}>
                  <td><strong>{s.sampleNo}</strong></td>
                  <td>{batch?.batchNo || '-'}</td>
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
                  <td>
                    <div className="action-buttons">
                      {actions.map((a) => (
                        <button
                          key={a.key}
                          className={`btn btn-sm ${a.className}`}
                          onClick={() => {
                            setSelectedSampleId(s.id)
                            openAction(a.type)
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                      {s.status === 'returned' && (
                        <button
                          className="btn btn-sm btn-default"
                          onClick={() => {
                            setSelectedSampleId(s.id)
                            handleUndo()
                          }}
                        >
                          撤销退回
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-default"
                        onClick={() => {
                          setSelectedSampleId(s.id)
                          setShowHistory(true)
                        }}
                      >
                        历史
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filteredSamples.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: 40 }}>
                  暂无样本数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showActionModal && selectedSample && (
        <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{getActionTitle()}</div>
              <div className="modal-close" onClick={() => setShowActionModal(false)}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <p style={{ marginBottom: 16 }}>
                样本编号：<strong>{selectedSample.sampleNo}</strong>
              </p>
              <p style={{ marginBottom: 16, color: '#666' }}>
                当前状态：{STATUS_LABELS[selectedSample.status]}
              </p>
              {actionType === 'return' && (
                <div className="form-group">
                  <label className="form-label">退回原因 *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="请输入退回原因"
                  />
                </div>
              )}
              {(actionType === 'aliquot' || actionType === 'review' || actionType === 'reviewed') && (
                <div className="form-group">
                  <label className="form-label">原因说明</label>
                  <input
                    type="text"
                    className="form-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="选填"
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">备注</label>
                <textarea
                  className="form-textarea"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="选填，备注信息"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => setShowActionModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleAction}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && selectedSample && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 600 }}>
            <div className="modal-header">
              <div className="modal-title">流转历史 - {selectedSample.sampleNo}</div>
              <div className="modal-close" onClick={() => setShowHistory(false)}>×</div>
            </div>
            <div className="modal-body">
              {selectedSample.history.length === 0 ? (
                <p style={{ color: '#999', textAlign: 'center', padding: 20 }}>暂无历史记录</p>
              ) : (
                <div>
                  {[...selectedSample.history].reverse().map((h, idx) => (
                    <div key={h.id} className="history-item">
                      <div className="history-time">
                        {new Date(h.timestamp).toLocaleString('zh-CN')}
                      </div>
                      <div className="history-content">
                        <div className="history-action">
                          <span
                            className="status-tag"
                            style={{
                              background: (STATUS_COLORS as any)[h.toStatus] || '#999',
                              marginRight: 8,
                            }}
                          >
                            {h.action}
                          </span>
                          {idx === 0 && <span style={{ color: '#52c41a', fontSize: 12 }}>（当前）</span>}
                        </div>
                        <div className="history-operator">
                          操作人：{h.operatorName}
                        </div>
                        {h.reason && (
                          <div className="history-remark">
                            原因：{h.reason}
                          </div>
                        )}
                        {h.remark && (
                          <div className="history-remark">
                            备注：{h.remark}
                          </div>
                        )}
                        <div className="history-remark" style={{ marginTop: 4 }}>
                          {h.fromStatus
                            ? `${(STATUS_LABELS as any)[h.fromStatus] || h.fromStatus} → ${(STATUS_LABELS as any)[h.toStatus] || h.toStatus}`
                            : `初始状态：${(STATUS_LABELS as any)[h.toStatus] || h.toStatus}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => setShowHistory(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SampleList
