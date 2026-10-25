use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: String,
    pub raw_text: String,
    pub text: String,
    pub language: String,
    pub app: String,
    pub duration_seconds: f64,
    pub word_count: usize,
    pub mode: String,
    pub inserted: bool,
}
pub struct Store {
    path: PathBuf,
}
impl Store {
    pub fn new(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let s = Self {
            path: root.join("history.sqlite3"),
        };
        let c = s.open()?;
        c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS history_time ON history(created_at DESC);").map_err(|e|e.to_string())?;
        Ok(s)
    }
    fn open(&self) -> Result<Connection, String> {
        let c = Connection::open(&self.path).map_err(|e| e.to_string())?;
        c.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        c.pragma_update(None, "secure_delete", "ON")
            .map_err(|e| e.to_string())?;
        Ok(c)
    }
    pub fn list(&self) -> Result<Vec<HistoryEntry>, String> {
        let c = self.open()?;
        let mut q = c
            .prepare("SELECT data FROM history ORDER BY created_at DESC LIMIT 10000")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            let t = r.map_err(|e| e.to_string())?;
            serde_json::from_str(&t).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn add(&self, e: &HistoryEntry) -> Result<(), String> {
        self.open()?
            .execute(
                "INSERT INTO history(id,created_at,data) VALUES(?1,?2,?3)",
                params![
                    e.id,
                    e.created_at,
                    serde_json::to_string(e).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn delete(&self, id: &str) -> Result<(), String> {
        self.open()?
            .execute("DELETE FROM history WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn clear(&self) -> Result<(), String> {
        self.open()?
            .execute_batch("DELETE FROM history; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
            .map_err(|e| e.to_string())
    }
    pub fn retain_days(&self, days: u32) -> Result<(), String> {
        if days == 0 {
            return Ok(());
        }
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(days as i64)).to_rfc3339();
        self.open()?
            .execute("DELETE FROM history WHERE created_at<?1", [cutoff])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
pub fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let part = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        f.write_all(&data).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&part, path).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_unicode_retention_and_delete() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let s = Store::new(&root).unwrap();
        let e = HistoryEntry {
            id: "a".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            raw_text: "środa".into(),
            text: "W środę.".into(),
            language: "pl".into(),
            app: "Notepad".into(),
            duration_seconds: 4.,
            word_count: 2,
            mode: "dictation".into(),
            inserted: true,
        };
        s.add(&e).unwrap();
        assert_eq!(s.list().unwrap()[0].text, "W środę.");
        s.delete("a").unwrap();
        assert!(s.list().unwrap().is_empty());
        s.clear().unwrap();
        drop(s);
        std::fs::remove_dir_all(root).unwrap();
    }
}
