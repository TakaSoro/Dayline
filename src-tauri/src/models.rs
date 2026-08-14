use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Journal {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalSummary {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: i64,
    pub journal_id: i64,
    pub description: String,
    pub category: String,
    pub activity_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineDay {
    pub date: String,
    pub activities: Vec<Activity>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiActivity {
    pub description: String,
    pub category: String,
}

#[derive(Debug, Deserialize)]
pub struct GeminiResponse {
    pub activities: Vec<GeminiActivity>,
}
