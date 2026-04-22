use std::sync::{Arc, Mutex};
use axum::{Router, routing::get, extract::State, Json};
use serde_json::{json, Value};
use tokio::net::TcpListener;

pub const HTTP_PORT: u16 = 52341;

/// Minimal HTTP server. Currently only serves GET /status.
/// Will be extended with full REST API when the web dashboard is built.
pub async fn run(ws_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{HTTP_PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[LearnCaption] HTTP server failed to bind on {HTTP_PORT}: {e}");
            return;
        }
    };

    let app = Router::new()
        .route("/status", get(status_handler))
        .with_state(ws_task);

    println!("[LearnCaption] HTTP server listening on 127.0.0.1:{HTTP_PORT}");
    let _ = axum::serve(listener, app).await;
}

async fn status_handler(
    State(ws_task): State<Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>>,
) -> Json<Value> {
    let capturing = ws_task.lock().unwrap().is_some();
    Json(json!({ "capturing": capturing }))
}
