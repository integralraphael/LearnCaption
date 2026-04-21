use std::sync::Arc;
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use serde::Deserialize;
use tauri::Emitter;

use super::{CaptionPipeline, RawCaption};

pub const WS_PORT: u16 = 52340;

#[derive(Deserialize, Debug)]
pub struct ExtensionMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub text: Option<String>,
    pub platform: Option<String>,
}

pub fn parse_message(raw: &str) -> Option<ExtensionMessage> {
    serde_json::from_str(raw).ok()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Bind the WebSocket port. Call this BEFORE creating any DB state
/// so bind failures don't leave orphaned rows.
pub async fn bind() -> Result<TcpListener, String> {
    TcpListener::bind(format!("127.0.0.1:{WS_PORT}"))
        .await
        .map_err(|e| format!("WS server failed to bind on port {WS_PORT}: {e}"))
}

/// Accept connections from the already-bound listener.
/// Runs until the tokio task is aborted via JoinHandle::abort().
pub async fn run(listener: TcpListener, pipeline: Arc<CaptionPipeline>) {
    while let Ok((stream, _)) = listener.accept().await {
        let pipeline = pipeline.clone();
        tokio::spawn(async move {
            let ws = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            let (_, mut read) = ws.split();
            let mut last_platform = String::new();

            while let Some(Ok(Message::Text(text))) = read.next().await {
                let msg = match parse_message(&text) {
                    Some(m) => m,
                    None => continue,
                };
                if msg.msg_type != "caption" {
                    continue;
                }
                if let Some(caption_text) = msg.text {
                    let platform = msg.platform.as_deref().unwrap_or("browser");
                    if platform != last_platform {
                        let _ = pipeline.app().emit("source-changed", platform);
                        last_platform = platform.to_string();
                    }
                    pipeline.process(RawCaption {
                        text: caption_text,
                        timestamp_ms: now_ms(),
                    });
                }
            }
            // Note: do NOT emit source-changed "none" here.
            // stop_browser_capture is the authoritative state transition.
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_caption_message() {
        let json = r#"{"type":"caption","text":"Hello everyone","platform":"meet"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "caption");
        assert_eq!(msg.text.as_deref(), Some("Hello everyone"));
        assert_eq!(msg.platform.as_deref(), Some("meet"));
    }

    #[test]
    fn test_parse_message_without_platform() {
        let json = r#"{"type":"caption","text":"Hello"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "caption");
        assert!(msg.platform.is_none());
    }

    #[test]
    fn test_parse_invalid_json_returns_none() {
        assert!(parse_message("not json").is_none());
    }

    #[test]
    fn test_parse_non_caption_type() {
        let json = r#"{"type":"ping","text":"hello"}"#;
        let msg = parse_message(json).unwrap();
        assert_eq!(msg.msg_type, "ping");
    }
}
