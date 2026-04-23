use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use futures_util::StreamExt;
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaChatMessage, LlamaModel},
    sampling::LlamaSampler,
};
use tauri::{AppHandle, Emitter, Manager};

// HY-MT1.5-1.8B (Tencent Hunyuan MT) — English→Chinese translation model
const HYMT_URL: &str =
    "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-Q4_K_M.gguf";
const HYMT_FILENAME: &str = "HY-MT1.5-1.8B-Q4_K_M.gguf";

const MAX_OUTPUT_TOKENS: usize = 128;
const N_CTX: u32 = 1024;

// ── Loaded model (backend + model live together so lifetimes align) ──────────

pub struct LoadedModel {
    pub backend: LlamaBackend,
    pub model: LlamaModel,
}

// llama.cpp types are not marked Send/Sync in Rust, but the underlying C
// objects are thread-safe when accessed serially behind a Mutex.
unsafe impl Send for LoadedModel {}
unsafe impl Sync for LoadedModel {}

pub struct TranslationState {
    pub loaded: Arc<Mutex<Option<LoadedModel>>>,
}

// ── Path helpers ─────────────────────────────────────────────────────────────

pub fn hymt_model_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("models")
        .join(HYMT_FILENAME)
}

pub fn hymt_model_exists(app: &AppHandle) -> bool {
    let p = hymt_model_path(app);
    p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

// ── Download ─────────────────────────────────────────────────────────────────

/// Download HY-MT GGUF, emitting `hymt-download-progress` (0.0–1.0),
/// `hymt-download-done`, or `hymt-download-error`.
pub async fn download_hymt(app: AppHandle) {
    let dest = hymt_model_path(&app);
    std::fs::create_dir_all(dest.parent().unwrap()).ok();

    let client = reqwest::Client::new();
    let response = match client.get(HYMT_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit("hymt-download-error", e.to_string());
            return;
        }
    };

    if !response.status().is_success() {
        let _ = app.emit("hymt-download-error", format!("HTTP {}", response.status()));
        return;
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let mut file = match std::fs::File::create(&dest) {
        Ok(f) => f,
        Err(e) => {
            let _ = app.emit("hymt-download-error", e.to_string());
            return;
        }
    };

    use std::io::Write;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                if file.write_all(&bytes).is_err() {
                    let _ = app.emit("hymt-download-error", "write failed");
                    std::fs::remove_file(&dest).ok();
                    return;
                }
                downloaded += bytes.len() as u64;
                if total > 0 {
                    let _ = app.emit(
                        "hymt-download-progress",
                        downloaded as f32 / total as f32,
                    );
                }
            }
            Err(e) => {
                let _ = app.emit("hymt-download-error", e.to_string());
                std::fs::remove_file(&dest).ok();
                return;
            }
        }
    }
    let _ = app.emit("hymt-download-done", ());
}

// ── Lazy load ─────────────────────────────────────────────────────────────────

/// Load the model into `state.loaded` if not already loaded.
/// Must be called from a blocking context (e.g. spawn_blocking).
pub fn ensure_loaded(state: &Arc<Mutex<Option<LoadedModel>>>, model_path: &PathBuf) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }

    let backend = LlamaBackend::init().map_err(|e| format!("llama backend: {e}"))?;
    // n_gpu_layers(99) offloads all layers to Metal on Apple Silicon
    let model_params = LlamaModelParams::default().with_n_gpu_layers(99);
    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
        .map_err(|e| format!("load model: {e}"))?;

    *guard = Some(LoadedModel { backend, model });
    Ok(())
}

// ── Inference ─────────────────────────────────────────────────────────────────

/// Build the user message content following official HY-MT1.5 prompt templates.
fn build_user_content(selection: &str, context: Option<&str>) -> String {
    match context {
        Some(ctx) if !ctx.is_empty() && ctx != selection => {
            format!(
                "{ctx}\n参考上面的信息，把下面的文本翻译成中文，注意不需要翻译上文，也不要额外解释：\n{selection}"
            )
        }
        _ => {
            // 中外互译模板: no context
            format!(
                "将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\n{selection}"
            )
        }
    }
}

/// Run translation inference. Must be called from a blocking context.
pub fn translate_sync(
    loaded: &LoadedModel,
    selection: &str,
    context: Option<&str>,
) -> Result<String, String> {
    let content = build_user_content(selection, context);

    // Use the model's built-in chat template (Hunyuan tokens, not standard ChatML)
    let tmpl = loaded.model.chat_template(None)
        .map_err(|e| format!("chat_template: {e}"))?;
    let msg = LlamaChatMessage::new("user".into(), content)
        .map_err(|e| format!("chat msg: {e}"))?;
    // add_ass=false per HY-MT README (add_generation_prompt=False)
    let prompt = loaded.model.apply_chat_template(&tmpl, &[msg], false)
        .map_err(|e| format!("apply_chat_template: {e}"))?;

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(NonZeroU32::new(N_CTX).unwrap()));
    let mut ctx = loaded
        .model
        .new_context(&loaded.backend, ctx_params)
        .map_err(|e| format!("context: {e}"))?;

    let tokens = loaded
        .model
        .str_to_token(&prompt, AddBos::Never)
        .map_err(|e| format!("tokenize: {e}"))?;

    if tokens.is_empty() {
        return Err("empty token list".into());
    }

    let n_prompt = tokens.len();
    let batch_cap = (n_prompt + MAX_OUTPUT_TOKENS).max(N_CTX as usize);
    let mut batch = LlamaBatch::new(batch_cap, 1);

    for (i, &tok) in tokens.iter().enumerate() {
        batch
            .add(tok, i as i32, &[0], i == n_prompt - 1)
            .map_err(|e| format!("batch.add: {e}"))?;
    }

    ctx.decode(&mut batch).map_err(|e| format!("decode prompt: {e}"))?;

    // Sampling params recommended by HY-MT1.5 README
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::penalties(64, 1.05, 0.0, 0.0), // repetition_penalty=1.05, last 64 tokens
        LlamaSampler::top_k(20),
        LlamaSampler::top_p(0.6, 1),
        LlamaSampler::temp(0.7),
        LlamaSampler::dist(0),                        // sample from resulting distribution
    ]);

    let mut output = String::new();
    let mut n_cur = n_prompt as i32;
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    for _ in 0..MAX_OUTPUT_TOKENS {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if loaded.model.is_eog_token(token) {
            break;
        }

        let piece = loaded
            .model
            .token_to_piece(token, &mut decoder, false, None)
            .map_err(|e| format!("token_to_piece: {e}"))?;
        output.push_str(&piece);

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|e| format!("batch.add gen: {e}"))?;
        n_cur += 1;
        ctx.decode(&mut batch).map_err(|e| format!("decode step: {e}"))?;
    }

    Ok(output.trim().to_string())
}
