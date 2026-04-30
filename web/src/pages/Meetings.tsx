import { useEffect, useRef, useState } from 'react'
import { api, AnnotatedToken, Meeting, TranscriptLine, WordResult } from '../api'

interface MeetingViewConfig {
  showVocab: boolean
  showDifficult: boolean
  translationMode: 'none' | 'demand' | 'all'
  colorVocab: string
  colorDifficult: string
  highlightStyle: 'underline' | 'background'
}

const DEFAULT_CONFIG: MeetingViewConfig = {
  showVocab: true,
  showDifficult: true,
  translationMode: 'demand',
  colorVocab: '#34d399',
  colorDifficult: '#fbbf24',
  highlightStyle: 'underline',
}

function parseMeetingConfig(raw: Record<string, unknown>): MeetingViewConfig {
  return { ...DEFAULT_CONFIG, ...raw } as MeetingViewConfig
}

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
  config,
}: {
  tokens: AnnotatedToken[]
  config: MeetingViewConfig
}) {
  return (
    <>
      {tokens.map((token, i) =>
        token.isWord ? (
          <span
            key={i}
            style={(() => {
              const showHighlight = token.inVocab
                ? config.showVocab
                : token.difficult
                ? config.showDifficult
                : false
              const color = token.inVocab ? config.colorVocab : config.colorDifficult
              const highlightStyle: React.CSSProperties = showHighlight
                ? config.highlightStyle === 'background'
                  ? { background: color + '33', borderRadius: '3px', padding: '0 2px' }
                  : { color, textDecoration: 'underline', textDecorationStyle: 'dotted' }
                : {}
              return {
                cursor: 'pointer',
                borderRadius: '2px',
                padding: '0 1px',
                ...highlightStyle,
              }
            })()}
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
  onConfigChange: (config: MeetingViewConfig) => void
}

function TranscriptView({ meeting, onConfigChange }: TranscriptViewProps) {
  const meetingId = meeting.id
  const [config, setConfig] = useState<MeetingViewConfig>(() => parseMeetingConfig(meeting.config))
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [annotated, setAnnotated] = useState<AnnotatedToken[][] | null>(null)
  // translations keyed by line.id
  const [translations, setTranslations] = useState<Record<number, string>>({})
  const [translating, setTranslating] = useState<Record<number, boolean>>({})
  // track which line IDs we've already queued in this session to avoid duplicates
  const translatedInSession = useRef(new Set<number>())

  const updateConfig = (patch: Partial<MeetingViewConfig>) => {
    const next = { ...config, ...patch }
    setConfig(next)
    onConfigChange(next)
    api.updateMeetingConfig(meeting.id, next as Record<string, unknown>).catch(() => {})
  }

  useEffect(() => {
    setLoading(true)
    setAnnotated(null)
    setTranslations({})
    setTranslating({})
    translatedInSession.current = new Set()
    api.transcript(meetingId).then((data) => {
      setLines(data)
      setLoading(false)
      // Seed translations from DB cache — keyed by line.id
      const cached: Record<number, string> = {}
      data.forEach(line => {
        if (line.translation) {
          cached[line.id] = line.translation
          translatedInSession.current.add(line.id)
        }
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

  // Auto-translate effect #1: translationMode === 'all' → translate every line sequentially
  useEffect(() => {
    if (config.translationMode !== 'all' || lines.length === 0) return
    let cancelled = false

    const todo = lines.filter(line => !translatedInSession.current.has(line.id))
    if (todo.length === 0) return
    todo.forEach(line => translatedInSession.current.add(line.id))

    ;(async () => {
      for (const line of todo) {
        if (cancelled) break
        setTranslating(prev => ({ ...prev, [line.id]: true }))
        try {
          const r = await api.translate(line.text, [line.id])
          if (!cancelled && r.translation)
            setTranslations(prev => ({ ...prev, [line.id]: r.translation! }))
        } catch {}
        if (!cancelled) setTranslating(prev => ({ ...prev, [line.id]: false }))
      }
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.translationMode, lines])

  // Auto-translate effect #2: vocab/difficult mode → translate lines with matching tokens
  // Runs independently so it doesn't cancel the 'all' effect when annotated loads.
  useEffect(() => {
    if (!annotated || lines.length === 0) return
    if (!config.showVocab && !config.showDifficult) return
    let cancelled = false

    const todo = lines.filter((line, i) => {
      if (translatedInSession.current.has(line.id)) return false
      const tokens = annotated[i]
      return tokens?.some(t =>
        (config.showVocab && t.inVocab) || (config.showDifficult && t.difficult)
      ) ?? false
    })

    if (todo.length === 0) return
    todo.forEach(line => translatedInSession.current.add(line.id))

    ;(async () => {
      for (const line of todo) {
        if (cancelled) break
        setTranslating(prev => ({ ...prev, [line.id]: true }))
        try {
          const r = await api.translate(line.text, [line.id])
          if (!cancelled && r.translation)
            setTranslations(prev => ({ ...prev, [line.id]: r.translation! }))
        } catch {}
        if (!cancelled) setTranslating(prev => ({ ...prev, [line.id]: false }))
      }
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.showVocab, config.showDifficult, annotated])

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
        {/* Settings toolbar */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {/* 生词 toggle */}
          <button
            onClick={() => updateConfig({ showVocab: !config.showVocab })}
            title="生词高亮"
            style={{
              padding: '2px 8px', borderRadius: '4px', border: '1px solid',
              fontSize: '11px', cursor: 'pointer',
              background: config.showVocab ? 'rgba(52,211,153,0.15)' : 'transparent',
              borderColor: config.showVocab ? '#34d399' : '#334155',
              color: config.showVocab ? '#34d399' : '#475569',
            }}
          >生词</button>

          {/* 超纲 toggle */}
          <button
            onClick={() => updateConfig({ showDifficult: !config.showDifficult })}
            title="超纲词高亮"
            style={{
              padding: '2px 8px', borderRadius: '4px', border: '1px solid',
              fontSize: '11px', cursor: 'pointer',
              background: config.showDifficult ? 'rgba(251,191,36,0.15)' : 'transparent',
              borderColor: config.showDifficult ? '#fbbf24' : '#334155',
              color: config.showDifficult ? '#fbbf24' : '#475569',
            }}
          >超纲</button>

          {/* 翻译 mode selector */}
          <select
            value={config.translationMode}
            onChange={(e) => updateConfig({ translationMode: e.target.value as MeetingViewConfig['translationMode'] })}
            style={{
              padding: '2px 6px', borderRadius: '4px', border: '1px solid #334155',
              background: '#0f172a', color: '#94a3b8', fontSize: '11px', cursor: 'pointer',
            }}
          >
            <option value="none">翻译: 关</option>
            <option value="demand">翻译: 按需</option>
            <option value="all">翻译: 全文</option>
          </select>

          {/* 高亮样式 toggle */}
          <button
            onClick={() => updateConfig({ highlightStyle: config.highlightStyle === 'underline' ? 'background' : 'underline' })}
            title="高亮样式"
            style={{
              padding: '2px 8px', borderRadius: '4px', border: '1px solid #334155',
              fontSize: '11px', cursor: 'pointer', background: 'transparent', color: '#475569',
            }}
          >{config.highlightStyle === 'underline' ? '下划线' : '背景色'}</button>
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '16px' }} onClick={handleWordClick}>
        {loading && <p style={{ color: '#64748b', margin: 0 }}>Loading transcript…</p>}
        {!loading && lines.length === 0 && <p style={{ color: '#64748b', margin: 0 }}>No transcript lines.</p>}
        {blocks.map((block, bi) => (
          <div key={bi} style={{ marginBottom: '14px' }}>
            {block.lines.map((line, li) => {
              const idx = lines.findIndex(l => l.id === line.id)
              const tokens = annotated && idx >= 0 ? annotated[idx] : null
              const lineTranslation = translations[line.id]
              const lineTranslating = translating[line.id]

              return (
                <div key={line.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '6px' }}>
                  {/* Speaker badge — shown only on first line of block */}
                  <span style={{
                    flexShrink: 0, width: '80px', textAlign: 'right',
                    marginTop: '2px',
                    color: '#64748b', fontSize: '12px', fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {li === 0 ? (block.speaker ?? '') : ''}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, color: '#cbd5e1', fontSize: '14px', lineHeight: '1.8' }}>
                      {tokens
                        ? <AnnotatedLineText tokens={tokens} config={config} />
                        : <ClickableText text={line.text} />
                      }
                    </p>
                    {/* Translation result */}
                    {config.translationMode !== 'none' && lineTranslation && (
                      <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '13px', lineHeight: '1.6' }}>
                        {lineTranslation}
                      </p>
                    )}
                    {/* Status / manual translate */}
                    {config.translationMode !== 'none' && (
                      lineTranslating
                        ? <span style={{ fontSize: '11px', color: '#475569' }}>翻译中…</span>
                        : <button
                            onClick={() => {
                              translatedInSession.current.add(line.id)
                              setTranslating(prev => ({ ...prev, [line.id]: true }))
                              api.translate(line.text, [line.id]).then(r => {
                                if (r.translation) setTranslations(prev => ({ ...prev, [line.id]: r.translation! }))
                                setTranslating(prev => ({ ...prev, [line.id]: false }))
                              }).catch(() => setTranslating(prev => ({ ...prev, [line.id]: false })))
                            }}
                            style={{
                              marginTop: '2px', background: 'none', border: 'none',
                              color: '#334155', cursor: 'pointer', fontSize: '11px', padding: '0',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#64748b')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
                          >
                            {lineTranslation ? '重新翻译' : '翻译'}
                          </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
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

  const handleConfigChange = (id: number, config: MeetingViewConfig) => {
    setMeetings(prev => prev.map(m => m.id === id ? { ...m, config: config as unknown as Record<string, unknown> } : m))
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
          <TranscriptView
            meeting={meetings.find(m => m.id === selected)!}
            onConfigChange={(cfg) => handleConfigChange(selected!, cfg)}
          />
        ) : (
          <p style={{ color: '#475569', padding: '20px' }}>Select a meeting to view its transcript.</p>
        )}
      </div>
    </div>
  )
}
