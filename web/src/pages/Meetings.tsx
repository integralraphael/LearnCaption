import { useEffect, useRef, useState } from 'react'
import { api, AnnotatedToken, Meeting, TranscriptLine, WordResult } from '../api'

function SourceBadge({ source }: { source: string }) {
  const isGoogle = source === 'browser'
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 600,
      background: isGoogle ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)',
      color: isGoogle ? '#60a5fa' : '#a78bfa',
      border: `1px solid ${isGoogle ? 'rgba(59,130,246,0.3)' : 'rgba(139,92,246,0.3)'}`,
      letterSpacing: '0.2px',
      flexShrink: 0,
    }}>
      {isGoogle ? 'Google Meet' : 'Whisper'}
    </span>
  )
}

function formatDate(s: string) {
  return new Date(s).toLocaleString()
}

function duration(m: Meeting) {
  if (!m.endedAt) return 'In progress'
  const ms = new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()
  const min = Math.floor(ms / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  return `${min}m ${sec}s`
}

interface WordPopupProps {
  word: string
  onClose: () => void
}

function WordPopup({ word, onClose }: WordPopupProps) {
  const [result, setResult] = useState<WordResult | null>(null)
  const [added, setAdded] = useState(false)

  useEffect(() => {
    setResult(null)
    setAdded(false)
    api.word(word).then(setResult).catch(() => setResult(null))
  }, [word])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const inVocab = added || !!result?.vocabEntry

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
          width: '420px', maxWidth: '92vw',
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid #334155', flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: '20px', color: '#f1f5f9', fontWeight: 600 }}>{word}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#0ea5e9', color: '#fff', cursor: 'pointer', fontSize: '15px' }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => api.tts(word)}
            >
              🔊
            </button>
            <button
              style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          {!result ? (
            <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Loading…</p>
          ) : (
            <>
              {result.definition ? (
                <p style={{ color: '#cbd5e1', margin: '0 0 12px', fontSize: '14px', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                  {result.definition}
                </p>
              ) : (
                <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 12px' }}>No definition found.</p>
              )}
              {result.frequency && (
                <p style={{ color: '#475569', margin: '0 0 16px', fontSize: '12px' }}>
                  Frequency rank: #{result.frequency}
                </p>
              )}
              {inVocab ? (
                <p style={{ color: '#10b981', fontSize: '13px', margin: 0 }}>✓ In vocab book</p>
              ) : result.definition ? (
                <button
                  style={{
                    padding: '7px 16px', borderRadius: '7px', border: 'none',
                    background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
                  }}
                  onClick={() => {
                    const def = result.definition!
                    api.addVocab(word, def).then(() => setAdded(true))
                  }}
                >
                  + Add to vocab book
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface SpeakerBlock {
  speaker: string | null
  lines: TranscriptLine[]
}

/** Group consecutive lines from the same speaker into blocks. */
function groupBySpeaker(lines: TranscriptLine[]): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = []
  for (const line of lines) {
    const last = blocks[blocks.length - 1]
    if (last && last.speaker === line.speakerLabel) {
      last.lines.push(line)
    } else {
      blocks.push({ speaker: line.speakerLabel, lines: [line] })
    }
  }
  return blocks
}

function ClickableText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((token, i) => {
        const word = token.replace(/[^a-zA-Z'-]/g, '')
        return word.length > 1
          ? <span key={i} style={{ cursor: 'pointer', borderRadius: '3px', padding: '0 1px' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >{token}</span>
          : <span key={i}>{token}</span>
      })}
    </>
  )
}

function AnnotatedLineText({
  tokens,
}: {
  tokens: AnnotatedToken[]
}) {
  return (
    <>
      {tokens.map((token, i) =>
        token.isWord ? (
          <span
            key={i}
            style={{
              cursor: 'pointer',
              borderRadius: '2px',
              padding: '0 1px',
              color: token.inVocab ? '#34d399' : token.difficult ? '#fbbf24' : undefined,
              textDecoration: (token.inVocab || token.difficult) ? 'underline' : undefined,
              textDecorationStyle: 'dotted',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#334155' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {token.text}
          </span>
        ) : (
          <span key={i}>{token.text}</span>
        )
      )}
    </>
  )
}

interface TranscriptViewProps {
  meeting: Meeting
}

function TranscriptView({ meeting }: TranscriptViewProps) {
  const meetingId = meeting.id
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [annotated, setAnnotated] = useState<AnnotatedToken[][] | null>(null)
  const [translations, setTranslations] = useState<Record<number, string>>({})
  const [translating, setTranslating] = useState<Record<number, boolean>>({})
  const [freqThreshold, setFreqThreshold] = useState(3000)

  useEffect(() => {
    api.setting('ai_translate_frq_threshold')
      .then(r => setFreqThreshold(parseInt(r.value ?? '3000', 10)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setAnnotated(null)
    setTranslations({})
    setTranslating({})
    api.transcript(meetingId).then((data) => {
      setLines(data)
      setLoading(false)
      // Seed translations from cached DB values — group by speaker blocks,
      // use first non-null translation found in each block.
      const cached: Record<number, string> = {}
      const blocks = groupBySpeaker(data)
      blocks.forEach((block, bi) => {
        const t = block.lines.find(l => l.translation)?.translation
        if (t) cached[bi] = t
      })
      if (Object.keys(cached).length > 0) setTranslations(cached)
    })
  }, [meetingId])

  useEffect(() => {
    if (lines.length === 0) return
    const texts = lines.map(l => l.text)
    api.annotate(texts).then(result => {
      setAnnotated(result)
    }).catch(() => {})
  }, [lines])

  const handleWordClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'SPAN') {
      const word = target.textContent?.replace(/[^a-zA-Z'-]/g, '') || ''
      if (word.length > 1) setSelectedWord(word)
    }
  }

  const blocks = loading ? [] : groupBySpeaker(lines)

  return (
    <>
      {/* Meeting header */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f1f5f9', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meeting.title}
        </h2>
        <SourceBadge source={meeting.source} />
        <span style={{ color: '#475569', fontSize: '12px', flexShrink: 0 }}>
          {new Date(meeting.startedAt).toLocaleString()}
        </span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '16px' }} onClick={handleWordClick}>
        {loading && <p style={{ color: '#64748b', margin: 0 }}>Loading transcript…</p>}
        {!loading && lines.length === 0 && <p style={{ color: '#64748b', margin: 0 }}>No transcript lines.</p>}
        {blocks.map((block, bi) => {
          const blockAnnotated = annotated ? block.lines.map((line) => {
            const idx = lines.findIndex(l => l.id === line.id)
            return idx >= 0 && annotated[idx] ? annotated[idx] : null
          }) : null

          return (
            <div key={bi} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                {/* Speaker badge — fixed width column so text aligns */}
                <span style={{
                  flexShrink: 0, width: '80px', textAlign: 'right',
                  marginTop: '2px',
                  color: '#64748b', fontSize: '12px', fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {block.speaker ?? ''}
                </span>
                <div style={{ flex: 1 }}>
                  {/* Paragraph: all lines joined with a space */}
                  <p style={{ margin: 0, color: '#cbd5e1', fontSize: '14px', lineHeight: '1.8' }}>
                    {block.lines.map((line, li) => {
                      const tokens = blockAnnotated?.[li]
                      return (
                        <span key={line.id}>
                          {li > 0 && ' '}
                          {tokens
                            ? <AnnotatedLineText tokens={tokens} />
                            : <ClickableText text={line.text} />
                          }
                        </span>
                      )
                    })}
                  </p>
                  {/* Translation result */}
                  {translations[bi] && (
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px', lineHeight: '1.6' }}>
                      {translations[bi]}
                    </p>
                  )}
                  {/* Translate button */}
                  <button
                    onClick={() => {
                      setTranslating(prev => ({ ...prev, [bi]: true }))
                      const text = block.lines.map(l => l.text).join(' ')
                      const lineIds = block.lines.map(l => l.id)
                      api.translate(text, lineIds).then(r => {
                        if (r.translation) setTranslations(prev => ({ ...prev, [bi]: r.translation! }))
                        setTranslating(prev => ({ ...prev, [bi]: false }))
                      }).catch(() => setTranslating(prev => ({ ...prev, [bi]: false })))
                    }}
                    disabled={translating[bi]}
                    style={{
                      marginTop: '4px',
                      background: 'none',
                      border: 'none',
                      color: translating[bi] ? '#475569' : '#334155',
                      cursor: translating[bi] ? 'default' : 'pointer',
                      fontSize: '11px',
                      padding: '0',
                    }}
                  >
                    {translating[bi] ? '翻译中…' : translations[bi] ? '重新翻译' : '翻译'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {selectedWord && <WordPopup word={selectedWord} onClose={() => setSelectedWord(null)} />}
    </>
  )
}

function MeetingItem({
  meeting, selected, onSelect, onRename,
}: {
  meeting: Meeting
  selected: boolean
  onSelect: () => void
  onRename: (id: number, title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(meeting.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(meeting.title)
    setEditing(true)
    setTimeout(() => { inputRef.current?.select() }, 0)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== meeting.title) {
      api.renameMeeting(meeting.id, trimmed).then(() => onRename(meeting.id, trimmed))
    }
    setEditing(false)
  }

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #1e293b',
        background: selected ? '#1e293b' : 'transparent',
        borderLeft: selected ? '3px solid #3b82f6' : '3px solid transparent',
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#0f172a', border: '1px solid #3b82f6', borderRadius: '5px',
            color: '#f1f5f9', fontSize: '14px', fontWeight: 500,
            padding: '2px 6px', outline: 'none', marginBottom: '4px',
          }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meeting.title}
          </span>
          <button
            onClick={startEdit}
            title="Rename"
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: '#334155', fontSize: '13px', padding: '0 2px', lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#334155')}
          >✎</button>
        </div>
      )}
      <div style={{ marginBottom: '4px' }}>
        <SourceBadge source={meeting.source} />
      </div>
      <div style={{ fontSize: '12px', color: '#64748b' }}>{formatDate(meeting.startedAt)}</div>
      <div style={{ fontSize: '12px', color: '#475569' }}>{duration(meeting)}</div>
    </div>
  )
}

export default function Meetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.meetings().then((data) => {
      setMeetings(data)
      if (data.length > 0) setSelected(data[0].id)
      setLoading(false)
    })
  }, [])

  const handleRename = (id: number, title: string) => {
    setMeetings((prev) => prev.map((m) => m.id === id ? { ...m, title } : m))
  }

  if (loading) return <p style={{ color: '#64748b', padding: '20px' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      {/* Left panel: meeting list */}
      <div style={{
        width: '280px', flexShrink: 0, overflowY: 'auto',
        borderRight: '1px solid #1e293b', background: '#0f172a',
      }}>
        {meetings.length === 0 ? (
          <p style={{ color: '#475569', padding: '20px', fontSize: '14px' }}>No meetings yet.</p>
        ) : meetings.map((m) => (
          <MeetingItem
            key={m.id}
            meeting={m}
            selected={selected === m.id}
            onSelect={() => setSelected(m.id)}
            onRename={handleRename}
          />
        ))}
      </div>

      {/* Right panel: transcript */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <TranscriptView meeting={meetings.find(m => m.id === selected)!} />
        ) : (
          <p style={{ color: '#475569', padding: '20px' }}>Select a meeting to view its transcript.</p>
        )}
      </div>
    </div>
  )
}
