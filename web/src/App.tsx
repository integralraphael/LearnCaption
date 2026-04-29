import { useState } from 'react'
import Meetings from './pages/Meetings'
import Vocab from './pages/Vocab'

type Page = 'meetings' | 'vocab'

const NAV_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '2px',
  padding: '12px 20px',
  background: '#1e293b',
  borderBottom: '1px solid #334155',
}

const NAV_BTN = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px',
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500,
  background: active ? '#3b82f6' : 'transparent',
  color: active ? '#fff' : '#94a3b8',
})

export default function App() {
  const [page, setPage] = useState<Page>('meetings')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={NAV_STYLE}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', marginRight: '16px', alignSelf: 'center' }}>
          LearnCaption
        </span>
        <button style={NAV_BTN(page === 'meetings')} onClick={() => setPage('meetings')}>
          Meetings
        </button>
        <button style={NAV_BTN(page === 'vocab')} onClick={() => setPage('vocab')}>
          Vocab Book
        </button>
      </nav>
      <div style={{ flex: 1 }}>
        {page === 'meetings' ? <Meetings /> : <Vocab />}
      </div>
    </div>
  )
}
