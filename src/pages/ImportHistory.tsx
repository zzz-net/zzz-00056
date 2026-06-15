import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { ImportResult } from '../types'

function ImportHistory() {
  const { state } = useApp()
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filteredResults = selectedBatchId
    ? state.importResults.filter((r) => r.batchId === selectedBatchId)
    : state.importResults

  const sortedResults = [...filteredResults].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const getBatchInfo = (batchId: string) => {
    const batch = state.batches.find((b) => b.id === batchId)
    return batch ? `${batch.batchNo} - ${batch.name}` : '未知批次'
  }

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">导入历史</h1>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
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
            <span style={{ color: '#666', fontSize: 14 }}>
              共 <strong style={{ color: '#1890ff' }}>{sortedResults.length}</strong> 条导入记录
            </span>
          </div>
        </div>

        {sortedResults.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>暂无导入记录</div>
            <div style={{ fontSize: 13 }}>
              在「样本接收」页面点击「📥 CSV 批量导入」可批量导入样本
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sortedResults.map((result) => (
              <ImportResultCard
                key={result.id}
                result={result}
                batchInfo={getBatchInfo(result.batchId)}
                expanded={expandedId === result.id}
                onToggle={() => toggleExpand(result.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ImportResultCard({
  result,
  batchInfo,
  expanded,
  onToggle,
}: {
  result: ImportResult
  batchInfo: string
  expanded: boolean
  onToggle: () => void
}) {
  const successRate = result.totalCount > 0
    ? Math.round((result.successCount / result.totalCount) * 100)
    : 0

  return (
    <div
      style={{
        border: '1px solid #e8e8e8',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          background: '#fafafa',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
        onClick={onToggle}
      >
        <div style={{ fontSize: 18 }}>
          {expanded ? '▼' : '▶'}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
            {batchInfo}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            导入时间：{new Date(result.timestamp).toLocaleString('zh-CN')}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            操作人：{result.operatorName}
          </div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
            {result.totalCount}
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>总条数</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
            {result.successCount}
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>成功</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: result.failedCount > 0 ? '#f5222d' : '#999' }}>
            {result.failedCount}
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>失败</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: successRate === 100 ? '#52c41a' : successRate >= 50 ? '#faad14' : '#f5222d',
          }}>
            {successRate}%
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>成功率</div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: 16, borderTop: '1px solid #e8e8e8' }}>
          <h4 style={{ marginBottom: 12, color: '#333' }}>导入明细</h4>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="table" style={{ margin: 0 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                <tr>
                  <th style={{ width: 60 }}>行号</th>
                  <th>样本编号</th>
                  <th style={{ width: 80 }}>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {result.details.map((detail) => (
                  <tr key={detail.rowIndex} style={{
                    background: detail.success ? 'transparent' : '#fff2f0',
                  }}>
                    <td>{detail.rowIndex}</td>
                    <td><strong>{detail.sampleNo}</strong></td>
                    <td>
                      <span className="status-tag" style={{
                        background: detail.success ? '#52c41a' : '#f5222d',
                      }}>
                        {detail.success ? '成功' : '失败'}
                      </span>
                    </td>
                    <td style={{ color: detail.success ? '#52c41a' : '#f5222d', fontSize: 12 }}>
                      {detail.success ? '导入成功' : detail.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default ImportHistory
