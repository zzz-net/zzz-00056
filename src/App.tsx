import { useState } from 'react'
import { useApp } from './store/AppContext'
import SampleReceive from './pages/SampleReceive'
import SampleList from './pages/SampleList'
import BatchList from './pages/BatchList'
import HandoverExport from './pages/HandoverExport'
import BatchLedger from './pages/BatchLedger'
import ImportHistory from './pages/ImportHistory'

type Page = 'receive' | 'samples' | 'batches' | 'ledger' | 'export' | 'import-history'

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('receive')
  const { state, dispatch } = useApp()
  const currentUser = state.users.find((u) => u.id === state.currentUserId)

  const handleUserChange = (userId: string) => {
    dispatch({ type: 'SET_CURRENT_USER', payload: userId })
  }

  const menuItems = [
    { key: 'receive', label: '样本接收', icon: '📥' },
    { key: 'samples', label: '样本列表', icon: '📋' },
    { key: 'batches', label: '批次管理', icon: '📦' },
    { key: 'ledger', label: '流转台账', icon: '📊' },
    { key: 'import-history', label: '导入历史', icon: '📋' },
    { key: 'export', label: '交接导出', icon: '📤' },
  ]

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          实验室样本流转系统
        </div>
        <nav className="sidebar-menu">
          {menuItems.map((item) => (
            <div
              key={item.key}
              className={`menu-item ${currentPage === item.key ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.key as Page)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>当前用户：</div>
          <select
            value={state.currentUserId || ''}
            onChange={(e) => handleUserChange(e.target.value)}
          >
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username} ({u.role === 'reviewer' ? '复核员' : '操作员'})
              </option>
            ))}
          </select>
        </div>
      </aside>
      <main className="main-content">
        {currentPage === 'receive' && <SampleReceive />}
        {currentPage === 'samples' && <SampleList />}
        {currentPage === 'batches' && <BatchList />}
        {currentPage === 'ledger' && <BatchLedger />}
        {currentPage === 'import-history' && <ImportHistory />}
        {currentPage === 'export' && <HandoverExport />}
      </main>
    </div>
  )
}

export default App
