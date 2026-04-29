import { useEffect, useState } from 'react'
import { api, Meeting, TranscriptLine, WordResult } from '../api'

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

  useEffect(() => {
    api.word(word).then(setResult).catch(() => setResult(null))
  }, [word])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
          padding: '24px', maxWidth: '480px', width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', color: '#f1f5f9' }}>{word}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#0ea5e9', color: '#fff', cursor: 'pointer' }}
              onClick={() => api.tts(word)}
            >
              🔊
            </button>
            <button
              style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#334155', color: '#94a3b8', cursor: 'pointer' }}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
        {result ? (
          <>
            {result.definition && (
              <p style={{ color: '#94a3b8', margin: '0 0 12px', fontSize: '14px' }}>{result.definition}</p>
            )}
            {result.frequency && (
              <p style={{ color: '#64748b', margin: '0 0 12px', fontSize: '12px' }}>
                Frequency rank: #{result.frequency}
              </p>
            )}
            {result.vocabEntry ? (
              <p style={{ color: '#10b981', fontSize: '13px', margin: 0 }}>✓ In vocab book</p>
            ) : result.definition ? (
              <button
                style={{
                  padding: '6px 14px', borderRadius: '6px', border: 'none',
                  background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '13px',
                }}
                onClick={() => result.definition && api.addVocab(word, result.definition).then(() => {
                  setResult((r) => r ? { ...r, vocabEntry: { id: 0, entry: word, entryType: 'word', definition: result.definition, familiarity: 0, occurrenceCount: 0, addedAt: '', masteredAt: null } } : r)
                })}
              >
                Add to vocab book
              </button>
            ) : null}
          </>
        ) : (
          <p style={{ color: '#64748b', fontSize: '14px' }}>Loading…</p>
        )}
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

interface TranscriptViewProps {
  meetingId: number
}

function TranscriptView({ meetingId }: TranscriptViewProps) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.transcript(meetingId).then((data) => { setLines(data); setLoading(false) })
  }, [meetingId])

  const handleWordClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'SPAN') {
      const word = target.textContent?.replace(/[^a-zA-Z'-]/g, '') || ''
      if (word.length > 1) setSelectedWord(word)
    }
  }

  if (loading) return <p style={{ color: '#64748b', padding: '20px' }}>Loading transcript…</p>
  if (lines.length === 0) return <p style={{ color: '#64748b', padding: '20px' }}>No transcript lines.</p>

  const blocks = groupBySpeaker(lines)

  return (
    <>
      <div style={{ overflowY: 'auto', height: '100%', padding: '16px' }} onClick={handleWordClick}>
        {blocks.map((block, bi) => (
          <div key={bi} style={{ marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            {/* Speaker badge — fixed width column so text aligns */}
            <span style={{
              flexShrink: 0, width: '80px', textAlign: 'right',
              marginTop: '2px',
              color: '#64748b', fontSize: '12px', fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {block.speaker ?? ''}
            </span>
            {/* Paragraph: all lines joined with a space */}
            <p style={{
              margin: 0, color: '#cbd5e1', fontSize: '14px', lineHeight: '1.8',
              flex: 1,
            }}>
              {block.lines.map((line, li) => (
                <span key={line.id}>
                  {li > 0 && ' '}
                  <ClickableText text={line.text} />
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
      {selectedWord && <WordPopup word={selectedWord} onClose={() => setSelectedWord(null)} />}
    </>
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
          <div
            key={m.id}
            onClick={() => setSelected(m.id)}
            style={{
              padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #1e293b',
              background: selected === m.id ? '#1e293b' : 'transparent',
              borderLeft: selected === m.id ? '3px solid #3b82f6' : '3px solid transparent',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0', marginBottom: '4px' }}>
              {m.title}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>{formatDate(m.startedAt)}</div>
            <div style={{ fontSize: '12px', color: '#475569' }}>{duration(m)}</div>
          </div>
        ))}
      </div>

      {/* Right panel: transcript */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selected ? (
          <TranscriptView meetingId={selected} />
        ) : (
          <p style={{ color: '#475569', padding: '20px' }}>Select a meeting to view its transcript.</p>
        )}
      </div>
    </div>
  )
}
