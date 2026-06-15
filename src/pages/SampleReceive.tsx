import { useState, useRef } from 'react'
import { useApp } from '../store/AppContext'
import { STATUS_LABELS, STATUS_COLORS, PrevalidateSummary } from '../types'

function SampleReceive() {
  const { state, createBatch, addSample, getCurrentUser, parseCSV, prevalidateImportCSV, batchImportSamples, doExportCSV, setLastSelectedScheme } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [batchName, setBatchName] = useState('')

  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [sampleNo, setSampleNo] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [source, setSource] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedSchemeId, setSelectedSchemeId] = useState<string>(state.lastSelectedSchemeId || '')
  const [prevalidateResult, setPrevalidateResult] = useState<PrevalidateSummary | null>(null)
  const [importedResult, setImportedResult] = useState<{ successCount: number; failedCount: number } | null>(null)

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedBatchId) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      const rows = parseCSV(content)
      const result = prevalidateImportCSV(selectedBatchId, rows)
      setPrevalidateResult(result)
      setImportedResult(null)
    }
    reader.readAsText(file)
  }

  const handleConfirmImport = () => {
    if (!prevalidateResult || !selectedBatchId) return

    const result = batchImportSamples(selectedBatchId, prevalidateResult.results)
    if (result.success && result.importResult) {
      setImportedResult({
        successCount: result.importResult.successCount,
        failedCount: result.importResult.failedCount,
      })
      setSuccessMsg(`批量导入完成：成功 ${result.importResult.successCount} 条，失败 ${result.importResult.failedCount} 条`)
    }
  }

  const handleDownloadTemplate = () => {
    const template = '样本编号,数量,来源\nSAMPLE-001,5,内科病房\nSAMPLE-002,3,外科病房\nSAMPLE-003,10,检验科'
    doExportCSV(template, '批量导入模板.csv')
  }

  const handleCloseImportModal = () => {
    setShowImportModal(false)
    setPrevalidateResult(null)
    setImportedResult(null)
    if (selectedSchemeId) {
      setLastSelectedScheme(selectedSchemeId)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const selectedScheme = state.importSchemes.find((s) => s.id === selectedSchemeId)

  const selectedBatch = state.batches.find((b) => b.id === selectedBatchId)
  const batchSamples = state.samples.filter((s) => s.batchId === selectedBatchId)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">样本接收</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-success"
            onClick={() => {
              if (!selectedBatchId) {
                setErrorMsg('请先选择批次')
                return
              }
              setShowImportModal(true)
            }}
          >
            📥 CSV 批量导入
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowBatchModal(true)}
          >
            + 新建批次
          </button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div style={{ marginBottom: 16, padding: 12, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4 }}>
        <span style={{ fontSize: 14, color: '#d48806' }}>
          💡 <strong>提示：</strong>批量导入后，可在左侧菜单「📋 导入历史」中查看所有导入记录和逐条明细，关闭应用重启后仍可追溯。
        </span>
      </div>

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

      {showImportModal && (
        <div className="modal-overlay" onClick={handleCloseImportModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxWidth: '90vw' }}>
            <div className="modal-header">
              <div className="modal-title">CSV 批量导入样本</div>
              <div className="modal-close" onClick={handleCloseImportModal}>×</div>
            </div>
            <div className="modal-body">
              {!prevalidateResult ? (
                <div>
                  {state.importSchemes.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">套用导入方案</label>
                      <select
                        className="form-input"
                        value={selectedSchemeId}
                        onChange={(e) => setSelectedSchemeId(e.target.value)}
                      >
                        <option value="">不使用方案（默认配置）</option>
                        {state.importSchemes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}{s.isShared ? ' [共享]' : ''}{s.isLocked ? ' [锁定]' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedScheme && (
                    <div style={{ padding: 10, background: '#f0f7ff', borderRadius: 4, marginBottom: 16, fontSize: 13 }}>
                      <div><strong>方案：</strong>{selectedScheme.name}</div>
                      <div><strong>列映射：</strong>{selectedScheme.columnMappings.map((m) => `${m.csvColumn}→${m.targetField}`).join('、')}</div>
                      <div><strong>批次号模式：</strong>{selectedScheme.defaultBatch.batchNoPattern || '未设置'}</div>
                      <div><strong>校验：</strong>{
                        Object.entries(selectedScheme.validationToggles)
                          .filter(([, v]) => v)
                          .map(([k]) => {
                            const labels: Record<string, string> = {
                              skipEmptySampleNo: '空编号',
                              skipDuplicateInFile: 'CSV重复',
                              skipDuplicateInBatch: '批次重复',
                              skipInvalidQuantity: '无效数量',
                              skipEmptySource: '空来源',
                            }
                            return labels[k] || k
                          })
                          .join('、') || '无'
                      }</div>
                    </div>
                  )}
                  <p style={{ marginBottom: 16 }}>
                    请选择 CSV 文件，格式：<code>样本编号,数量,来源</code>
                  </p>
                  <div style={{ marginBottom: 16 }}>
                    <button className="btn btn-default" onClick={handleDownloadTemplate}>
                      📄 下载导入模板
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="form-input"
                  />
                </div>
              ) : (
                <div>
                  <div style={{
                    padding: 12,
                    borderRadius: 4,
                    marginBottom: 16,
                    background: prevalidateResult.canImport ? '#f6ffed' : '#fff2f0',
                    border: `1px solid ${prevalidateResult.canImport ? '#b7eb8f' : '#ffa39e'}`,
                  }}>
                    <p style={{ margin: '4px 0' }}>
                      共 <strong>{prevalidateResult.total}</strong> 条记录，
                      <span style={{ color: '#52c41a' }}> 有效 {prevalidateResult.validCount} 条</span>，
                      <span style={{ color: '#f5222d' }}> 无效 {prevalidateResult.invalidCount} 条</span>
                    </p>
                    {!prevalidateResult.canImport && (
                      <p style={{ margin: '4px 0', color: '#f5222d' }}>
                        没有可导入的有效记录，请修正 CSV 文件后重新选择
                      </p>
                    )}
                  </div>

                  <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e8e8e8', borderRadius: 4 }}>
                    <table className="table" style={{ margin: 0 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                        <tr>
                          <th style={{ width: 60 }}>行号</th>
                          <th>样本编号</th>
                          <th style={{ width: 60 }}>数量</th>
                          <th>来源</th>
                          <th style={{ width: 80 }}>状态</th>
                          <th>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prevalidateResult.results.map((r) => (
                          <tr key={r.rowIndex} style={{
                            background: r.valid ? 'transparent' : '#fff2f0',
                          }}>
                            <td>{r.rowIndex}</td>
                            <td>{r.sampleNo || '-'}</td>
                            <td>{r.quantity || '-'}</td>
                            <td>{r.source || '-'}</td>
                            <td>
                              <span className="status-tag" style={{
                                background: r.valid ? '#52c41a' : '#f5222d',
                              }}>
                                {r.valid ? '通过' : '失败'}
                              </span>
                            </td>
                            <td style={{ color: '#f5222d', fontSize: 12 }}>
                              {r.errors.join('；')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {importedResult && (
                    <div style={{
                      marginTop: 16,
                      padding: 12,
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      borderRadius: 4,
                    }}>
                      <strong>✅ 导入完成！</strong> 成功 {importedResult.successCount} 条，失败 {importedResult.failedCount} 条
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={handleCloseImportModal}>
                {importedResult ? '完成' : '取消'}
              </button>
              {prevalidateResult && prevalidateResult.canImport && !importedResult && (
                <button className="btn btn-primary" onClick={handleConfirmImport}>
                  确认导入 {prevalidateResult.validCount} 条
                </button>
              )}
              {prevalidateResult && !importedResult && (
                <button className="btn btn-default" onClick={() => {
                  setPrevalidateResult(null)
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
                  }
                }}>
                  重新选择文件
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SampleReceive
