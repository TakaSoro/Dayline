use crate::models::{Activity, Journal, JournalSummary, TimelineDay};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let images_dir = app_data_dir.join("images");
        std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

        let db_path = app_data_dir.join("journal.db");
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS journals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                journal_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                activity_date TEXT NOT NULL,
                FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn create_journal(&self, title: String, content: String) -> Result<Journal, String> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO journals (title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![title, content, now, now],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        Ok(Journal {
            id,
            title,
            content,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_journal(
        &self,
        id: i64,
        title: String,
        content: String,
    ) -> Result<Journal, String> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE journals SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
                params![title, content, now, id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("Journal not found".into());
        }
        self.get_journal(id)
    }

    pub fn delete_journal(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn
            .execute("DELETE FROM journals WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Err("Journal not found".into());
        }
        Ok(())
    }

    pub fn get_journal(&self, id: i64) -> Result<Journal, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, title, content, created_at, updated_at FROM journals WHERE id = ?1",
            params![id],
            |row| {
                Ok(Journal {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    pub fn list_journals(&self) -> Result<Vec<JournalSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at, content FROM journals ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let content: String = row.get(4)?;
                let preview: String = content.chars().take(120).collect();
                Ok(JournalSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    preview,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn replace_activities(
        &self,
        journal_id: i64,
        activity_date: &str,
        activities: &[(String, String)],
    ) -> Result<Vec<Activity>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM activities WHERE journal_id = ?1",
            params![journal_id],
        )
        .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for (description, category) in activities {
            conn.execute(
                "INSERT INTO activities (journal_id, description, category, activity_date) VALUES (?1, ?2, ?3, ?4)",
                params![journal_id, description, category, activity_date],
            )
            .map_err(|e| e.to_string())?;
            let id = conn.last_insert_rowid();
            result.push(Activity {
                id,
                journal_id,
                description: description.clone(),
                category: category.clone(),
                activity_date: activity_date.to_string(),
            });
        }
        Ok(result)
    }

    pub fn get_activities_for_journal(&self, journal_id: i64) -> Result<Vec<Activity>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, journal_id, description, category, activity_date FROM activities WHERE journal_id = ?1 ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![journal_id], |row| {
                Ok(Activity {
                    id: row.get(0)?,
                    journal_id: row.get(1)?,
                    description: row.get(2)?,
                    category: row.get(3)?,
                    activity_date: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_timeline(&self, category: Option<String>) -> Result<Vec<TimelineDay>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut activities = Vec::new();

        if let Some(cat) = category.filter(|c| !c.is_empty()) {
            let mut stmt = conn
                .prepare(
                    "SELECT id, journal_id, description, category, activity_date FROM activities WHERE category = ?1 ORDER BY activity_date DESC, id DESC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![cat], |row| {
                    Ok(Activity {
                        id: row.get(0)?,
                        journal_id: row.get(1)?,
                        description: row.get(2)?,
                        category: row.get(3)?,
                        activity_date: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            activities = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, journal_id, description, category, activity_date FROM activities ORDER BY activity_date DESC, id DESC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(Activity {
                        id: row.get(0)?,
                        journal_id: row.get(1)?,
                        description: row.get(2)?,
                        category: row.get(3)?,
                        activity_date: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            activities = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        }

        let mut days: Vec<TimelineDay> = Vec::new();
        for activity in activities {
            let date_key = activity.activity_date.chars().take(10).collect::<String>();
            if let Some(day) = days.iter_mut().find(|d| d.date == date_key) {
                day.activities.push(activity);
            } else {
                days.push(TimelineDay {
                    date: date_key,
                    activities: vec![activity],
                });
            }
        }
        Ok(days)
    }

    pub fn get_categories(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT DISTINCT category FROM activities ORDER BY category ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            Ok(Some(row.get(0).map_err(|e| e.to_string())?))
        } else {
            Ok(None)
        }
    }
}
