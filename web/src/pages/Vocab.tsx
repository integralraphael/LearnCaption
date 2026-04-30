import { useEffect, useState } from 'react'
import { api, VocabEntry, VocabSentence } from '../api'

type SortKey = 'occurrenceCount' | 'addedAt' | 'familiarity' | 'entry'
type Filter = 'all' | 'mastered' | 'unmastered'

function FamiliarityDots({ level }: { level: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: '3px' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: i <= level ? '#3b82f6' : '#334155',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  )
}

interface EntryRowProps {
  entry: VocabEntry
  onMastered: (id: number) => void
}

function EntryRow({ entry, onMastered }: EntryRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [sentences, setSentences] = useState<VocabSentence[]>([])
  const [loadingSentences, setLoadingSentences] = useState(false)

  const toggleExpand = () => {
    if (!expanded && sentences.length === 0) {
      setLoadingSentences(true)
      api.vocabSentences(entry.id).then((data) => {
        setSentences(data)
        setLoadingSentences(false)
      })
    }
    setExpanded(!expanded)
  }

  const isMastered = entry.masteredAt !== null

  return (
    <>
      <tr
        onClick={toggleExpand}
        style={{
          cursor: 'pointer',
          background: expanded ? '#1e293b' : 'transparent',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <td style={{ padding: '10px 16px', color: isMastered ? '#475569' : '#e2e8f0', fontWeight: 500 }}>
          <span style={{ textDecoration: isMastered ? 'line-through' : 'none' }}>
            {entry.entry}
          </span>
        </td>
        <td style={{ padding: '10px 16px', color: '#94a3b8', fontSize: '13px', maxWidth: '300px' }}>
          {entry.definition ?? '—'}
        </td>
        <td style={{ padding: '10px 16px', color: '#64748b', textAlign: 'center' }}>
          {entry.occurrenceCount}
        </td>
        <td style={{ padding: '10px 16px', textAlign: 'center' }}>
          <FamiliarityDots level={entry.familiarity} />
        </td>
        <td style={{ padding: '10px 16px', color: '#64748b', fontSize: '12px' }}>
          {new Date(entry.addedAt).toLocaleDateString()}
        </td>
        {/* Mastered toggle — directly in row, no expand needed */}
        <td
          style={{ padding: '10px 12px', textAlign: 'center', width: '40px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            title={isMastered ? 'Mastered' : 'Mark as mastered'}
            onClick={() => { if (!isMastered) onMastered(entry.id) }}
            style={{
              width: '28px', height: '28px', borderRadius: '50%', border: 'none',
              cursor: isMastered ? 'default' : 'pointer',
              background: isMastered ? '#10b981' : '#1e293b',
              color: isMastered ? '#fff' : '#475569',
              fontSize: '14px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { if (!isMastered) (e.currentTarget.style.background = '#334155') }}
            onMouseLeave={(e) => { if (!isMastered) (e.currentTarget.style.background = '#1e293b') }}
          >
            ✓
          </button>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#0f172a' }}>
          <td colSpan={6} style={{ padding: '12px 16px 16px 32px' }}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <button
                style={{
                  padding: '5px 14px', borderRadius: '6px', border: 'none',
                  background: '#0ea5e9', color: '#fff', cursor: 'pointer', fontSize: '13px',
                }}
                onClick={(e) => { e.stopPropagation(); api.tts(entry.entry) }}
              >
                🔊 Pronounce
              </button>
            </div>
            {loadingSentences ? (
              <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Loading sentences…</p>
            ) : sentences.length === 0 ? (
              <p style={{ color: '#475569', fontSize: '13px', margin: 0 }}>No example sentences yet.</p>
            ) : (
              <>
                <p style={{ color: '#64748b', fontSize: '12px', margin: '0 0 8px' }}>Example sentences:</p>
                {sentences.map((s) => (
                  <div key={s.lineId} style={{ marginBottom: '8px' }}>
                    <p style={{ color: '#cbd5e1', fontSize: '13px', margin: '0 0 2px' }}>
                      {s.text.split(new RegExp(`(${entry.entry})`, 'i')).map((part, i) =>
                        part.toLowerCase() === entry.entry.toLowerCase()
                          ? <strong key={i} style={{ color: '#fbbf24' }}>{part}</strong>
                          : <span key={i}>{part}</span>
                      )}
                    </p>
                    <span style={{ color: '#475569', fontSize: '11px' }}>{s.meetingTitle}</span>
                  </div>
                ))}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function Vocab() {
  const [entries, setEntries] = useState<VocabEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('occurrenceCount')
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.vocab().then((data) => { setEntries(data); setLoading(false) })
  }, [])

  const handleMastered = (id: number) => {
    api.markMastered(id).then(() => {
      setEntries((prev) =>
        prev.map((e) => e.id === id ? { ...e, familiarity: 5, masteredAt: new Date().toISOString() } : e)
      )
    })
  }

  const sortedFiltered = entries
    .filter((e) => {
      if (filter === 'mastered' && !e.masteredAt) return false
      if (filter === 'unmastered' && e.masteredAt) return false
      if (search && !e.entry.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortKey === 'entry') cmp = a.entry.localeCompare(b.entry)
      else if (sortKey === 'addedAt') cmp = a.addedAt.localeCompare(b.addedAt)
      else cmp = (a[sortKey] as number) - (b[sortKey] as number)
      return sortAsc ? cmp : -cmp
    })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  const thStyle = (key: SortKey): React.CSSProperties => ({
    padding: '10px 16px',
    cursor: 'pointer',
    userSelect: 'none',
    color: sortKey === key ? '#e2e8f0' : '#64748b',
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'left',
  })

  if (loading) return <p style={{ color: '#64748b', padding: '20px' }}>Loading…</p>

  return (
    <div style={{ padding: '20px', height: 'calc(100vh - 49px)', overflowY: 'auto' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: '6px', border: '1px solid #334155',
            background: '#1e293b', color: '#e2e8f0', fontSize: '14px', outline: 'none',
          }}
        />
        {(['all', 'mastered', 'unmastered'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 14px', borderRadius: '6px', border: 'none',
              background: filter === f ? '#334155' : 'transparent',
              color: filter === f ? '#e2e8f0' : '#64748b',
              cursor: 'pointer', fontSize: '13px',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span style={{ color: '#475569', fontSize: '13px', marginLeft: 'auto' }}>
          {sortedFiltered.length} entries
        </span>
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#1e293b' }}>
            <th style={thStyle('entry')} onClick={() => toggleSort('entry')}>
              Word {sortKey === 'entry' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={{ ...thStyle('entry'), cursor: 'default' }}>Definition</th>
            <th style={thStyle('occurrenceCount')} onClick={() => toggleSort('occurrenceCount')}>
              Seen {sortKey === 'occurrenceCount' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={thStyle('familiarity')} onClick={() => toggleSort('familiarity')}>
              Familiarity {sortKey === 'familiarity' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={thStyle('addedAt')} onClick={() => toggleSort('addedAt')}>
              Added {sortKey === 'addedAt' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={{ ...thStyle('entry'), cursor: 'default', width: '40px' }} />
          </tr>
        </thead>
        <tbody>
          {sortedFiltered.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#475569' }}>
                No entries found.
              </td>
            </tr>
          ) : sortedFiltered.map((e) => (
            <EntryRow key={e.id} entry={e} onMastered={handleMastered} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
