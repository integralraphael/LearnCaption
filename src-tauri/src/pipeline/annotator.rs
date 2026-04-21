use aho_corasick::{AhoCorasick, MatchKind};
use serde::{Deserialize, Serialize};

use crate::dictionary::EcdictDictionary;

// NOTE: serde(rename_all = "camelCase") is required on all structs here
// so field names match the TypeScript interfaces in src/types/subtitle.ts

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordToken {
    pub text: String,
    pub definition: Option<String>,
    pub vocab_id: Option<i64>,
    pub color: Option<String>, // "yellow" | "orange" | "red"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotatedLine {
    pub line_id: i64,
    pub meeting_id: i64,
    pub tokens: Vec<WordToken>,
    pub raw_text: String,
    pub timestamp_ms: i64,
}

/// A single entry from the vocabulary table used to build the automaton.
#[derive(Debug, Clone)]
pub struct VocabEntry {
    pub id: i64,
    pub entry: String,            // e.g. "leverage" or "look forward to"
    pub definition: String,
    pub occurrence_count: u32,
    pub familiarity: u8,
}

pub struct Annotator {
    dict: std::sync::Arc<crate::dictionary::EcdictDictionary>,
    automaton: Option<AhoCorasick>,
    vocab_entries: Vec<VocabEntry>,
}

impl Annotator {
    pub fn new(dict: std::sync::Arc<crate::dictionary::EcdictDictionary>) -> Self {
        Self {
            dict,
            automaton: None,
            vocab_entries: vec![],
        }
    }

    /// Rebuild the Aho-Corasick automaton from the current vocabulary entries.
    /// Call on startup and whenever the vocabulary table changes.
    pub fn rebuild_automaton(&mut self, entries: Vec<VocabEntry>) {
        let patterns: Vec<String> = entries
            .iter()
            .map(|e| e.entry.to_lowercase())
            .collect();
        if patterns.is_empty() {
            self.automaton = None;
        } else {
            self.automaton = Some(
                AhoCorasick::builder()
                    .match_kind(MatchKind::LeftmostLongest)
                    .build(&patterns)
                    .expect("failed to build Aho-Corasick automaton"),
            );
        }
        self.vocab_entries = entries;
    }

    /// Annotate a raw Whisper text line into tokens.
    pub fn annotate(
        &self,
        raw_text: &str,
        line_id: i64,
        meeting_id: i64,
        timestamp_ms: i64,
    ) -> AnnotatedLine {
        let lower = raw_text.to_lowercase();
        let mut vocab_matches: Vec<(usize, usize, usize)> = vec![];
        if let Some(ac) = &self.automaton {
            for m in ac.find_iter(&lower) {
                vocab_matches.push((m.start(), m.end(), m.pattern().as_usize()));
            }
        }
        let tokens = self.build_tokens(raw_text, &vocab_matches);
        AnnotatedLine {
            line_id,
            meeting_id,
            tokens,
            raw_text: raw_text.to_string(),
            timestamp_ms,
        }
    }

    fn build_tokens(
        &self,
        raw: &str,
        vocab_matches: &[(usize, usize, usize)],
    ) -> Vec<WordToken> {
        let mut tokens = vec![];
        let bytes = raw.as_bytes();

        // Collect word byte ranges by splitting on whitespace
        let words: Vec<(usize, usize)> = {
            let mut v = vec![];
            let mut start: Option<usize> = None;
            for (i, &b) in bytes.iter().enumerate() {
                if b == b' ' || b == b'\t' {
                    if let Some(s) = start.take() {
                        v.push((s, i));
                    }
                } else if start.is_none() {
                    start = Some(i);
                }
            }
            if let Some(s) = start {
                v.push((s, bytes.len()));
            }
            v
        };

        let mut word_idx = 0;
        while word_idx < words.len() {
            let (wstart, _wend) = words[word_idx];
            // Check if a vocab match starts at this word's byte position
            let vocab_hit = vocab_matches.iter().find(|&&(ms, _me, _)| ms == wstart);

            if let Some(&(ms, me, entry_idx)) = vocab_hit {
                let entry = &self.vocab_entries[entry_idx];
                let color = Self::color_for_entry(entry);
                tokens.push(WordToken {
                    text: raw[ms..me].to_string(),
                    definition: Some(entry.definition.clone()),
                    vocab_id: Some(entry.id),
                    color: Some(color),
                });
                // Skip all words covered by this phrase match
                while word_idx < words.len() && words[word_idx].0 < me {
                    word_idx += 1;
                }
            } else {
                let word_text = &raw[wstart.._wend];
                // Strip punctuation from the word for lookup
                let lookup_key: String = word_text.chars().filter(|c| c.is_alphabetic() || *c == '\'').collect();
                let definition = self.dict.lookup(&lookup_key).map(|s| s.to_string());
                tokens.push(WordToken {
                    text: word_text.to_string(),
                    definition,
                    vocab_id: None,
                    color: None,
                });
                word_idx += 1;
            }
        }
        tokens
    }

    fn color_for_entry(entry: &VocabEntry) -> String {
        match entry.occurrence_count {
            0..=1 => "yellow".to_string(),
            2..=4 => "orange".to_string(),
            _ => "red".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dictionary::EcdictDictionary;

    fn make_dict() -> std::sync::Arc<EcdictDictionary> {
        std::sync::Arc::new(EcdictDictionary::load("resources/ecdict.db", 100_000).unwrap())
    }

    fn make_annotator_with_vocab(entries: Vec<VocabEntry>) -> Annotator {
        let mut a = Annotator::new(make_dict());
        a.rebuild_automaton(entries);
        a
    }

    fn vocab(id: i64, entry: &str, definition: &str, count: u32) -> VocabEntry {
        VocabEntry {
            id,
            entry: entry.to_string(),
            definition: definition.to_string(),
            occurrence_count: count,
            familiarity: 0,
        }
    }

    #[test]
    fn test_annotates_single_vocab_word() {
        let a = make_annotator_with_vocab(vec![vocab(1, "leverage", "充分利用", 3)]);
        let line = a.annotate("we should leverage this", 1, 1, 0);
        let tok = line.tokens.iter().find(|t| t.text == "leverage").unwrap();
        assert_eq!(tok.definition.as_deref(), Some("充分利用"));
        assert_eq!(tok.color.as_deref(), Some("orange")); // count=3 → orange
    }

    #[test]
    fn test_phrase_suppresses_contained_word() {
        let a = make_annotator_with_vocab(vec![
            vocab(1, "look forward to", "期待", 1),
            vocab(2, "forward", "向前", 0),
        ]);
        let line = a.annotate("I look forward to the meeting", 1, 1, 0);
        // The phrase "look forward to" should be a single token
        assert!(
            line.tokens.iter().any(|t| t.text == "look forward to"),
            "phrase should be one token"
        );
        // "forward" alone should NOT appear as a token
        assert!(
            !line.tokens.iter().any(|t| t.text == "forward"),
            "contained word should be suppressed"
        );
    }

    #[test]
    fn test_color_thresholds() {
        let a = make_annotator_with_vocab(vec![
            vocab(1, "alpha", "甲", 0),   // yellow
            vocab(2, "beta",  "乙", 3),   // orange
            vocab(3, "gamma", "丙", 7),   // red
        ]);
        let line = a.annotate("alpha beta gamma", 1, 1, 0);
        let colors: Vec<_> = line.tokens.iter().map(|t| t.color.as_deref()).collect();
        assert_eq!(colors, vec![Some("yellow"), Some("orange"), Some("red")]);
    }

    #[test]
    fn test_unannotated_word_has_no_vocab_id() {
        let a = make_annotator_with_vocab(vec![]);
        let line = a.annotate("hello world", 1, 1, 0);
        for tok in &line.tokens {
            assert!(tok.vocab_id.is_none());
        }
    }

    #[test]
    fn test_serde_camelcase() {
        // Verify that serialized JSON uses camelCase keys (matching TS interfaces)
        let token = WordToken {
            text: "test".to_string(),
            definition: Some("测试".to_string()),
            vocab_id: Some(1),
            color: Some("yellow".to_string()),
        };
        let json = serde_json::to_string(&token).unwrap();
        assert!(json.contains("\"vocabId\""), "expected camelCase 'vocabId', got: {}", json);
        assert!(!json.contains("\"vocab_id\""), "should not contain snake_case 'vocab_id'");

        let line = AnnotatedLine {
            line_id: 1,
            meeting_id: 2,
            tokens: vec![],
            raw_text: "hi".to_string(),
            timestamp_ms: 0,
        };
        let json = serde_json::to_string(&line).unwrap();
        assert!(json.contains("\"lineId\""), "expected camelCase 'lineId'");
        assert!(json.contains("\"meetingId\""), "expected camelCase 'meetingId'");
        assert!(json.contains("\"rawText\""), "expected camelCase 'rawText'");
        assert!(json.contains("\"timestampMs\""), "expected camelCase 'timestampMs'");
    }
}
