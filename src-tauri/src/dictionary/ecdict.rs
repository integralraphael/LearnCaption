use rusqlite::{Connection, Result};
use std::collections::HashMap;

pub struct EcdictDictionary {
    /// Maps lowercase entry → Chinese translation string
    entries: HashMap<String, String>,
}

impl EcdictDictionary {
    /// Load top `limit` entries by frequency from the ECDICT SQLite file.
    /// limit=100_000 covers virtually all business/meeting vocabulary.
    pub fn load(ecdict_path: &str, limit: u32) -> Result<Self> {
        let conn = Connection::open(ecdict_path)?;
        let mut stmt = conn.prepare(
            "SELECT word, translation FROM stardict
             WHERE translation != '' AND frq > 0
             ORDER BY frq DESC LIMIT ?",
        )?;
        let entries: HashMap<String, String> = stmt
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, String>(0)?.to_lowercase(),
                    row.get::<_, String>(1)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(Self { entries })
    }

    /// Look up a word or phrase. Returns the first line of the translation field.
    pub fn lookup(&self, word: &str) -> Option<&str> {
        self.entries
            .get(&word.to_lowercase())
            .map(|def| {
                // ECDICT translation field uses \n-separated lines; take first
                def.lines().next().unwrap_or(def.as_str())
            })
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
}
