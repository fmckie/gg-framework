use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
    Fatal,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StackFrame {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub fn_: String,
    pub in_app: bool,
}

// Manual ser/de to map `fn_` → `fn` to match the universal wire format.
impl StackFrame {
    pub fn to_wire(&self) -> serde_json::Value {
        serde_json::json!({
            "file": self.file,
            "line": self.line,
            "col": self.col,
            "fn": self.fn_,
            "in_app": self.in_app,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CodeContext {
    pub file: String,
    pub error_line: u32,
    pub lines: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct WireEvent {
    pub event_id: String,
    pub project_key: String,
    pub fingerprint: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub message: String,
    pub stack: Vec<serde_json::Value>,
    pub code_context: Option<CodeContext>,
    pub runtime: String,
    pub manual_report: bool,
    pub level: Level,
    pub occurred_at: String,
}
