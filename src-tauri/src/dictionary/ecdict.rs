use rust_stemmers::{Algorithm, Stemmer};
use rusqlite::{Connection, Result};
use std::collections::HashMap;

struct DictEntry {
    translation: String,
    frq: u32,
}

pub struct EcdictDictionary {
    /// Maps lowercase entry → translation + frequency rank
    entries: HashMap<String, DictEntry>,
    /// Words sorted by frequency rank (ascending: most common first)
    sorted_words: Vec<(String, String, u32)>, // (word, first_line_def, frq)
    stemmer: Stemmer,
}

/// Frequency rank threshold: words with frq above this are considered
/// "difficult" and auto-added to vocab. frq is a rank (1 = most common).
/// 3000 filters out ~3000 most common words (the, go, think, believe, …).
pub const AUTO_VOCAB_FRQ_THRESHOLD: u32 = 3000;

impl EcdictDictionary {
    /// Load top `limit` entries by frequency from the ECDICT SQLite file.
    /// limit=100_000 covers virtually all business/meeting vocabulary.
    pub fn load(ecdict_path: &str, limit: u32) -> Result<Self> {
        let conn = Connection::open(ecdict_path)?;
        let mut stmt = conn.prepare(
            "SELECT word, translation, frq FROM stardict
             WHERE translation != '' AND frq > 0
             ORDER BY frq DESC LIMIT ?",
        )?;
        let entries: HashMap<String, DictEntry> = stmt
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, String>(0)?.to_lowercase(),
                    DictEntry {
                        translation: row.get::<_, String>(1)?,
                        frq: row.get::<_, u32>(2)?,
                    },
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
        let mut sorted_words: Vec<(String, String, u32)> = entries
            .iter()
            .map(|(word, e)| {
                let def = e.translation.lines().next().unwrap_or(&e.translation).to_string();
                (word.clone(), def, e.frq)
            })
            .collect();
        sorted_words.sort_by_key(|(_w, _d, frq)| *frq);

        Ok(Self { entries, sorted_words, stemmer: Stemmer::create(Algorithm::English) })
    }

    /// Look up a word or phrase. Returns the first line of the translation field.
    pub fn lookup(&self, word: &str) -> Option<&str> {
        self.entries
            .get(&word.to_lowercase())
            .map(|e| {
                // ECDICT translation field uses \n-separated lines; take first
                e.translation.lines().next().unwrap_or(e.translation.as_str())
            })
    }

    /// Return the frequency rank for a word (1 = most common). None if not in dict.
    pub fn frequency(&self, word: &str) -> Option<u32> {
        self.entries.get(&word.to_lowercase()).map(|e| e.frq)
    }

    /// Total number of words with frequency data.
    pub fn total_words(&self) -> u32 {
        self.sorted_words.len() as u32
    }

    /// Get a slice of words sorted by frequency for calibration UI.
    /// offset is 0-based, returns (word, definition, frq) tuples.
    pub fn calibration_words(&self, offset: u32, limit: u32) -> Vec<crate::commands::settings::CalibrationWord> {
        let start = (offset as usize).min(self.sorted_words.len());
        let end = (start + limit as usize).min(self.sorted_words.len());
        self.sorted_words[start..end]
            .iter()
            .enumerate()
            .map(|(i, (word, def, frq))| crate::commands::settings::CalibrationWord {
                rank: (start + i) as u32,
                word: word.clone(),
                definition: def.clone(),
                frq: *frq,
            })
            .collect()
    }

    /// Check if a word is "difficult" enough to auto-add to vocabulary.
    pub fn is_difficult(&self, word: &str) -> bool {
        match self.frequency(word) {
            Some(frq) => frq > AUTO_VOCAB_FRQ_THRESHOLD,
            None => false, // unknown word — skip, could be a name or typo
        }
    }

    /// Look up a word's definition only if its frequency rank exceeds `threshold`
    /// (i.e. it's a "difficult" word by the user's calibration). Also tries Snowball
    /// stemming. Returns None if the word is too common or not in the dictionary.
    pub fn lookup_if_difficult<'a>(&'a self, word: &str, threshold: u32) -> Option<&'a str> {
        let lower = word.to_lowercase();
        if let Some(e) = self.entries.get(&lower) {
            return if e.frq > threshold {
                Some(e.translation.lines().next().unwrap_or(&e.translation))
            } else {
                None // found but too common
            };
        }
        // Snowball stem fallback
        let stemmed = self.stemmer.stem(&lower).to_string();
        if stemmed != lower {
            if let Some(e) = self.entries.get(&stemmed) {
                return if e.frq > threshold {
                    Some(e.translation.lines().next().unwrap_or(&e.translation))
                } else {
                    None
                };
            }
            let stem_e = format!("{stemmed}e");
            if let Some(e) = self.entries.get(&stem_e) {
                return if e.frq > threshold {
                    Some(e.translation.lines().next().unwrap_or(&e.translation))
                } else {
                    None
                };
            }
        }
        None
    }

    /// Look up translation + difficulty for auto-vocab.
    /// Tries exact match first, then Snowball stem, all validated against dict.
    /// Returns (base_word, definition, is_difficult).
    pub fn lookup_with_difficulty(&self, word: &str) -> Option<(String, &str, bool)> {
        let lower = word.to_lowercase();

        // 1. Exact match
        if let Some(e) = self.entries.get(&lower) {
            let def = e.translation.lines().next().unwrap_or(e.translation.as_str());
            return Some((lower, def, e.frq > AUTO_VOCAB_FRQ_THRESHOLD));
        }

        // 2. Snowball stem — validated against dict
        let stemmed = self.stemmer.stem(&lower).to_string();
        if stemmed != lower {
            if let Some(e) = self.entries.get(&stemmed) {
                let def = e.translation.lines().next().unwrap_or(e.translation.as_str());
                return Some((stemmed, def, e.frq > AUTO_VOCAB_FRQ_THRESHOLD));
            }
            // Snowball can over-stem; try stem+e (e.g. "leverag" → "leverage")
            let stem_e = format!("{stemmed}e");
            if let Some(e) = self.entries.get(&stem_e) {
                let def = e.translation.lines().next().unwrap_or(e.translation.as_str());
                return Some((stem_e, def, e.frq > AUTO_VOCAB_FRQ_THRESHOLD));
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_test_dict() -> EcdictDictionary {
        EcdictDictionary::load("resources/ecdict.db", 100_000).unwrap()
    }

    #[test]
    fn test_lookup_common_word() {
        let dict = load_test_dict();
        let result = dict.lookup("the");
        assert!(result.is_some(), "expected 'the' to be in dictionary");
    }

    #[test]
    fn test_lookup_case_insensitive() {
        let dict = load_test_dict();
        assert_eq!(dict.lookup("leverage"), dict.lookup("LEVERAGE"));
    }

    #[test]
    fn test_lookup_unknown_word() {
        let dict = load_test_dict();
        assert!(dict.lookup("xyzqnotrealword123").is_none());
    }

    #[test]
    fn test_returns_single_line() {
        let dict = load_test_dict();
        // Find any word that has a definition
        if let Some(def) = dict.lookup("run") {
            assert!(!def.contains('\n'), "definition should be single line, got: {}", def);
        }
    }

    #[test]
    fn test_difficulty_common_word() {
        let dict = load_test_dict();
        // "the" should not be difficult
        assert!(!dict.is_difficult("the"));
        assert!(!dict.is_difficult("go"));
    }

    #[test]
    fn test_difficulty_uncommon_word() {
        let dict = load_test_dict();
        // "paradigm" frq=5201, should be difficult (> 3000)
        assert!(dict.is_difficult("paradigm"));
    }
}
