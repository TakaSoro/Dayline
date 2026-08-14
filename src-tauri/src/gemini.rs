use crate::models::GeminiActivity;
use reqwest::Client;
use serde_json::json;

const GEMINI_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

pub async fn analyze_journal(
    api_key: &str,
    title: &str,
    content: &str,
) -> Result<Vec<GeminiActivity>, String> {
    let client = Client::new();

    let prompt = format!(
        r#"Analyze the following journal entry and extract a list of activities or things the user did.
For each activity, assign a category such as: Work, Health, Social, Learning, Creative, Travel, Food, Exercise, Entertainment, Personal, or another fitting category.

Return ONLY valid JSON in this exact format (no markdown, no code fences):
{{"activities": [{{"description": "activity description", "category": "CategoryName"}}]}}

Journal title: {title}

Journal content:
{content}"#
    );

    let body = json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json"
        }
    });

    let response = client
        .post(format!("{GEMINI_URL}?key={api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Gemini API: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error ({status}): {error_text}"));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {e}"))?;

    let text = response_json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or("No text in Gemini response")?;

    let parsed: crate::models::GeminiResponse =
        serde_json::from_str(text).map_err(|e| format!("Failed to parse activities JSON: {e}"))?;

    Ok(parsed.activities)
}
