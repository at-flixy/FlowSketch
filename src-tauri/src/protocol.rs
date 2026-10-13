use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const MAX_SOURCE: usize = 256 * 1024;
pub const MAX_OUTPUT: usize = 16 * 1024 * 1024;
pub const MAX_PROJECT: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyzeRequest {
    pub source: String,
    pub source_revision: u64,
    pub request_id: String,
    pub function_id: Option<String>,
    pub operation: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRequest<'a> {
    pub protocol_version: u8,
    pub request_id: &'a str,
    pub source_revision: u64,
    pub source_digest: String,
    pub context_digest: &'a str,
    pub source: &'a str,
    pub function_id: &'a Option<String>,
    pub operation: &'a str,
}
pub fn digest(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }
pub fn validate_request(request: &AnalyzeRequest) -> Result<(), String> {
    if request.source.len() > MAX_SOURCE { return Err("Исходник превышает 256 KiB.".into()); }
    if request.source.split('\n').count() > 5000 { return Err("Исходник превышает 5000 строк.".into()); }
    if request.source.trim().is_empty() { return Err("Вставьте программу или функцию C++.".into()); }
    if request.source.contains('\0') { return Err("Исходник содержит нулевой символ. Проверьте кодировку файла.".into()); }
    if request.request_id.is_empty() || request.request_id.len() > 128 || !request.request_id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c)) {
        return Err("Некорректный идентификатор задания.".into());
    }
    if !["analyze", "discover"].contains(&request.operation.as_str()) { return Err("Неизвестная операция анализа.".into()); }
    if request.function_id.as_ref().is_some_and(|id| id.len() > 512 || id.contains('\0')) { return Err("Некорректный идентификатор функции.".into()); }
    Ok(())
}
pub fn failure(request: &AnalyzeRequest, context_digest: &str, status: &str, code: &str, message: &str) -> Value {
    json!({"protocolVersion":1,"requestId":request.request_id,"sourceRevision":request.source_revision,"sourceDigest":digest(request.source.as_bytes()),"contextDigest":context_digest,"analyzerVersion":"flowsketch-host-0.1.0","status":status,"functions":[],"graph":null,"diagnostics":[{"code":code,"severity":"error","message":message}]})
}
pub fn validate_response(response: &Value, request: &AnalyzeRequest, context_digest: &str) -> Result<(), String> {
    if response["protocolVersion"] != 1 || response["requestId"] != request.request_id || response["sourceRevision"] != request.source_revision
        || response["sourceDigest"] != digest(request.source.as_bytes()) || response["contextDigest"] != context_digest {
        return Err("Ответ анализатора относится к другой ревизии или протоколу.".into());
    }
    let status = response["status"].as_str().ok_or("В ответе отсутствует статус.")?;
    if !["DISCOVERED","BUILT_NORMAL_FLOW","BUILT_WITH_ABSTRACTION","INPUT_ERROR","CONTEXT_REQUIRED","UNSUPPORTED","CANCELLED","FAILURE"].contains(&status) {
        return Err("Неизвестный статус анализатора.".into());
    }
    if !response["functions"].is_array() || !response["diagnostics"].is_array() { return Err("Поврежденная структура ответа анализатора.".into()); }
    if status.starts_with("BUILT_") {
        let graph = &response["graph"];
        let nodes = graph["nodes"].as_array().ok_or("В графе отсутствуют блоки.")?;
        let edges = graph["edges"].as_array().ok_or("В графе отсутствуют связи.")?;
        if nodes.is_empty() || nodes.len()>500 || edges.len()>1000 { return Err("Граф превышает допустимое число блоков или связей.".into()); }
        let mut ids = std::collections::HashSet::new();
        for node in nodes {
            let id=node["id"].as_str().ok_or("Блок без идентификатора.")?;
            if !ids.insert(id) { return Err("Повторяющийся идентификатор блока.".into()); }
            if !["terminator","process","decision","io","call","connector"].contains(&node["kind"].as_str().unwrap_or("")) { return Err("Неизвестный тип блока.".into()); }
            if !node["label"].is_string() { return Err("Поврежденная подпись блока.".into()); }
        }
        let mut edge_ids = std::collections::HashSet::new();
        for edge in edges {
            if !edge_ids.insert(edge["id"].as_str().ok_or("Связь без идентификатора.")?) || !ids.contains(edge["source"].as_str().unwrap_or("")) || !ids.contains(edge["target"].as_str().unwrap_or("")) {
                return Err("Связь содержит неизвестный или повторяющийся идентификатор.".into());
            }
            if !edge["role"].is_string() { return Err("В связи отсутствует смысл перехода.".into()); }
        }
    } else if !response["graph"].is_null() { return Err("Неготовый ответ содержит готовый граф.".into()); }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request()->AnalyzeRequest { AnalyzeRequest{source:"int f(){return 1;}".into(),source_revision:2,request_id:"test-1".into(),function_id:None,operation:"analyze".into()} }
    #[test] fn stale_protocol_response_is_rejected() {
        let request=request(); let mut response=failure(&request,"context","UNSUPPORTED","TEST","Unsupported");
        assert!(validate_response(&response,&request,"context").is_ok());
        response["sourceRevision"]=json!(1); assert!(validate_response(&response,&request,"context").is_err());
        response["sourceRevision"]=json!(2); response["sourceDigest"]=json!("wrong"); assert!(validate_response(&response,&request,"context").is_err());
    }
    #[test] fn broken_edge_and_partial_graph_cannot_publish() {
        let request=request();let mut response=failure(&request,"context","BUILT_NORMAL_FLOW","TEST","test");
        response["graph"]=json!({"nodes":[{"id":"a","kind":"terminator","label":"Start"}],"edges":[{"id":"e","source":"a","target":"missing","role":"normal"}]});
        assert!(validate_response(&response,&request,"context").is_err());
        response["status"]=json!("UNSUPPORTED");assert!(validate_response(&response,&request,"context").is_err());
    }
    #[test] fn input_limits_are_explicit_and_not_truncation() {
        let mut request=request();request.source="a".repeat(MAX_SOURCE+1);assert!(validate_request(&request).is_err());
        request.source="a\n".repeat(5001);assert!(validate_request(&request).is_err());
        request.source="int f(){return 1;}".into();request.request_id="../shell".into();assert!(validate_request(&request).is_err());
    }
}
