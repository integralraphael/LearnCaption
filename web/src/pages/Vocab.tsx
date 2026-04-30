import { useEffect, useRef, useState } from 'react'
import { api, VocabEntry, VocabSentence } from '../api'

type SortKey = 'occurrenceCount' | 'addedAt' | 'familiarity' | 'entry'
type Filter = 'all' | 'mastered' | 'unmastered'

// ── Star rating ───────────────────────────────────────────────────────────────

interface StarRatingProps {
  level: number
  onSet: (level: number) => void
}

function StarRating({ level, onSet }: StarRatingProps) {
  const [hovered, setHovered] = useState(0)
  const display = hovered || level

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ display: 'inline-flex', gap: '2px' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            title={`Set familiarity to ${i}`}
            style={{
              fontSize: '16px',
              cursor: 'pointer',
              color: i <= display ? '#f59e0b' : '#334155',
              transition: 'color 0.1s',
              userSelect: 'none',
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(0)}
            onClick={(e) => { e.stopPropagation(); onSet(i) }}
          >
            ★
          </span>
        ))}
      </span>
      {hovered > 0 && (
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {['', 'Beginner', 'Familiar', 'Comfortable', 'Advanced', 'Fluent'][hovered]}
        </span>
      )}
    </div>
  )
}

// ── Stars (read-only, compact, for table cell) ────────────────────────────────

function StarDisplay({ level }: { level: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: '1px' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ fontSize: '13px', color: i <= level ? '#f59e0b' : '#1e293b' }}>★</span>
      ))}
    </span>
  )
}

// ── Add word modal ────────────────────────────────────────────────────────────

interface AddWordModalProps {
  onClose: () => void
  onAdded: (entry: VocabEntry) => void
}

function AddWordModal({ onClose, onAdded }: AddWordModalProps) {
  const [word, setWord] = useState('')
  const [definition, setDefinition] = useState('')
  const [loading, setLoading] = useState(false)
  const [looked, setLooked] = useState(false)
  const wordRef = useRef<HTMLInputElement>(null)

  useEffect(() => { wordRef.current?.focus() }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const lookup = async () => {
    if (!word.trim()) return
    const res = await api.word(word.trim())
    if (res.definition) setDefinition(res.definition)
    setLooked(true)
  }

  const submit = async () => {
    if (!word.trim()) return
    setLoading(true)
    const entry = await api.addVocab(word.trim(), definition, 'word')
    onAdded(entry)
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
          padding: '24px', width: '420px', maxWidth: '92vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: '#f1f5f9' }}>Add word</h3>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Word</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              ref={wordRef}
              value={word}
              onChange={(e) => { setWord(e.target.value); setLooked(false) }}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
              placeholder="e.g. effortlessly"
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '7px',
                border: '1px solid #334155', background: '#0f172a',
                color: '#e2e8f0', fontSize: '14px', outline: 'none',
              }}
            />
            <button
              onClick={lookup}
              style={{
                padding: '8px 14px', borderRadius: '7px', border: 'none',
                background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '13px',
              }}
            >
              Look up
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
            Definition
            {looked && !definition && <span style={{ color: '#f59e0b', marginLeft: '6px' }}>not found in dictionary</span>}
          </label>
          <textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            placeholder="Enter definition (optional)"
            rows={3}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: '7px',
              border: '1px solid #334155', background: '#0f172a',
              color: '#e2e8f0', fontSize: '14px', outline: 'none',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: '7px', border: 'none', background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!word.trim() || loading}
            style={{
              padding: '8px 16px', borderRadius: '7px', border: 'none',
              background: word.trim() ? '#3b82f6' : '#1e3a5f',
              color: '#fff', cursor: word.trim() ? 'pointer' : 'default',
              fontSize: '13px', fontWeight: 500,
            }}
          >{loading ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: VocabEntry
  onUpdate: (id: number, patch: Partial<VocabEntry>) => void
  onDelete: (id: number) => void
}

function EntryRow({ entry, onUpdate, onDelete }: EntryRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [sentences, setSentences] = useState<VocabSentence[]>([])
  const [loadingSentences, setLoadingSentences] = useState(false)
  const [editingDef, setEditingDef] = useState(false)
  const [draftDef, setDraftDef] = useState(entry.definition ?? '')

  const toggleExpand = () => {
    if (!expanded && sentences.length === 0) {
      setLoadingSentences(true)
      api.vocabSentences(entry.id).then((data) => { setSentences(data); setLoadingSentences(false) })
    }
    setExpanded(!expanded)
  }

  const isMastered = entry.masteredAt !== null

  const toggleMastered = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isMastered) {
      api.unmarkMastered(entry.id).then(() => onUpdate(entry.id, { familiarity: 0, masteredAt: null }))
    } else {
      api.markMastered(entry.id).then(() => onUpdate(entry.id, { familiarity: 5, masteredAt: new Date().toISOString() }))
    }
  }

  const setFamiliarity = (level: number) => {
    api.setFamiliarity(entry.id, level).then(() => onUpdate(entry.id, { familiarity: level }))
  }

  const saveDef = () => {
    api.setDefinition(entry.id, draftDef).then(() => {
      onUpdate(entry.id, { definition: draftDef || null })
      setEditingDef(false)
    })
  }

  const confirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Delete "${entry.entry}" from vocab book?`)) {
      api.deleteVocab(entry.id).then(() => onDelete(entry.id))
    }
  }

  return (
    <>
      <tr
        onClick={toggleExpand}
        style={{ cursor: 'pointer', background: expanded ? '#1e293b' : 'transparent', borderBottom: '1px solid #1e293b' }}
      >
        {/* Word + mastered badge */}
        <td style={{ padding: '11px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontWeight: 500,
              color: isMastered ? '#475569' : '#e2e8f0',
              textDecoration: isMastered ? 'line-through' : 'none',
            }}>
              {entry.entry}
            </span>
            {isMastered && (
              <span style={{
                fontSize: '10px', fontWeight: 600, padding: '1px 6px',
                borderRadius: '99px', background: '#064e3b', color: '#34d399',
                letterSpacing: '0.04em',
              }}>
                MASTERED
              </span>
            )}
          </div>
        </td>

        {/* Definition (truncated) */}
        <td style={{
          padding: '11px 16px', color: '#94a3b8', fontSize: '13px',
          maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.definition ?? <span style={{ color: '#334155' }}>—</span>}
        </td>

        {/* Seen */}
        <td style={{ padding: '11px 16px', color: '#64748b', textAlign: 'center' }}>
          {entry.occurrenceCount}
        </td>

        {/* Familiarity — read-only stars in main row */}
        <td style={{ padding: '11px 16px', textAlign: 'center' }}>
          <StarDisplay level={entry.familiarity} />
        </td>

        {/* Added */}
        <td style={{ padding: '11px 16px', color: '#64748b', fontSize: '12px' }}>
          {new Date(entry.addedAt).toLocaleDateString()}
        </td>

        {/* Mastered toggle only — delete lives in the expanded panel */}
        <td style={{ padding: '11px 16px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={toggleMastered}
            title={isMastered ? 'Click to unmark mastered' : 'Mark as mastered'}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 500,
              background: isMastered ? '#064e3b' : '#1e293b',
              color: isMastered ? '#34d399' : '#475569',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = isMastered ? '#065f46' : '#334155' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = isMastered ? '#064e3b' : '#1e293b' }}
          >
            {isMastered ? '✓ Mastered' : 'Mark mastered'}
          </button>
        </td>
      </tr>

      {/* Expanded panel */}
      {expanded && (
        <tr style={{ background: '#0a1628' }}>
          <td colSpan={6} style={{ padding: '16px 20px 20px 24px' }}>
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>

              {/* Left: familiarity + actions */}
              <div style={{ minWidth: '200px' }}>
                <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Familiarity — click to rate
                </p>
                <StarRating level={entry.familiarity} onSet={setFamiliarity} />

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
                  <button
                    style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#0ea5e9', color: '#fff', cursor: 'pointer', fontSize: '13px' }}
                    onClick={(e) => { e.stopPropagation(); api.tts(entry.entry) }}
                  >🔊 Pronounce</button>

                  <button
                    style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}
                    onClick={(e) => { e.stopPropagation(); setEditingDef(true); setDraftDef(entry.definition ?? '') }}
                  >✎ Edit definition</button>

                  {/* Delete — clearly separated, red, in expanded panel */}
                  <button
                    style={{ padding: '5px 14px', borderRadius: '6px', border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: '13px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#7f1d1d' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    onClick={confirmDelete}
                  >🗑 Delete</button>
                </div>

                {/* Inline definition editor */}
                {editingDef && (
                  <div style={{ marginTop: '14px' }} onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={draftDef}
                      onChange={(e) => setDraftDef(e.target.value)}
                      rows={3}
                      autoFocus
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: '7px',
                        border: '1px solid #3b82f6', background: '#0f172a',
                        color: '#e2e8f0', fontSize: '13px', outline: 'none',
                        resize: 'vertical', boxSizing: 'border-box', marginBottom: '8px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={saveDef} style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>Save</button>
                      <button onClick={(e) => { e.stopPropagation(); setEditingDef(false) }} style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: example sentences */}
              <div style={{ flex: 1, minWidth: '200px' }}>
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Example sentences
                </p>
                {loadingSentences ? (
                  <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Loading…</p>
                ) : sentences.length === 0 ? (
                  <p style={{ color: '#334155', fontSize: '13px', margin: 0 }}>No example sentences yet.</p>
                ) : sentences.map((s) => (
                  <div key={s.lineId} style={{ marginBottom: '10px', paddingLeft: '10px', borderLeft: '2px solid #1e293b' }}>
                    <p style={{ color: '#cbd5e1', fontSize: '13px', margin: '0 0 3px', lineHeight: 1.6 }}>
                      {s.text.split(new RegExp(`(${entry.entry})`, 'i')).map((part, i) =>
                        part.toLowerCase() === entry.entry.toLowerCase()
                          ? <strong key={i} style={{ color: '#fbbf24' }}>{part}</strong>
                          : <span key={i}>{part}</span>
                      )}
                    </p>
                    <span style={{ color: '#334155', fontSize: '11px' }}>{s.meetingTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Vocab() {
  const [entries, setEntries] = useState<VocabEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('occurrenceCount')
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    api.vocab().then((data) => { setEntries(data); setLoading(false) })
  }, [])

  const handleUpdate = (id: number, patch: Partial<VocabEntry>) =>
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e))

  const handleDelete = (id: number) =>
    setEntries((prev) => prev.filter((e) => e.id !== id))

  const handleAdded = (entry: VocabEntry) =>
    setEntries((prev) => [entry, ...prev])

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

  const th = (key: SortKey): React.CSSProperties => ({
    padding: '10px 16px', cursor: 'pointer', userSelect: 'none',
    color: sortKey === key ? '#e2e8f0' : '#64748b',
    fontWeight: 600, fontSize: '12px',
    textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left',
  })

  if (loading) return <p style={{ color: '#64748b', padding: '20px' }}>Loading…</p>

  return (
    <div style={{ padding: '20px', height: 'calc(100vh - 49px)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: '6px', border: '1px solid #334155',
            background: '#1e293b', color: '#e2e8f0', fontSize: '14px', outline: 'none',
          }}
        />
        {(['all', 'mastered', 'unmastered'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
            background: filter === f ? '#334155' : 'transparent',
            color: filter === f ? '#e2e8f0' : '#64748b',
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span style={{ color: '#334155', fontSize: '13px' }}>{sortedFiltered.length} entries</span>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            marginLeft: 'auto', padding: '6px 16px', borderRadius: '7px', border: 'none',
            background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
          }}
        >+ Add word</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#1e293b' }}>
            <th style={th('entry')} onClick={() => toggleSort('entry')}>
              Word {sortKey === 'entry' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={{ ...th('entry'), cursor: 'default' }}>Definition</th>
            <th style={th('occurrenceCount')} onClick={() => toggleSort('occurrenceCount')}>
              Seen {sortKey === 'occurrenceCount' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={th('familiarity')} onClick={() => toggleSort('familiarity')}>
              Familiarity {sortKey === 'familiarity' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={th('addedAt')} onClick={() => toggleSort('addedAt')}>
              Added {sortKey === 'addedAt' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th style={{ width: '130px' }} />
          </tr>
        </thead>
        <tbody>
          {sortedFiltered.length === 0 ? (
            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#334155' }}>No entries found.</td></tr>
          ) : sortedFiltered.map((e) => (
            <EntryRow key={e.id} entry={e} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </tbody>
      </table>

      {showAdd && <AddWordModal onClose={() => setShowAdd(false)} onAdded={handleAdded} />}
    </div>
  )
}
