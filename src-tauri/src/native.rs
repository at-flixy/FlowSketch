use crate::{process, protocol::{self, AnalyzeRequest, NativeRequest}};
use serde_json::Value;
use std::{collections::HashMap, path::{Path,PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};

// Tauri resource_dir may be a Windows verbatim path. Clang constructs forward-slash
// include paths; verbatim Win32 paths do not normalize those separators.
fn clang_path(path: &Path) -> String {
    let text=path.to_string_lossy().replace('\\',"/");
    if let Some(rest)=text.strip_prefix("//?/UNC/") { format!("//{}",rest) }
    else { text.strip_prefix("//?/").unwrap_or(&text).to_string() }
}

#[derive(Clone)]
pub struct NativeHost {
    executable: PathBuf,
    toolchain: PathBuf,
    context_digest: String,
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}
impl NativeHost {
    pub fn new(resources: PathBuf) -> Self {
        let packaged_executable=resources.join("analyzer/flowsketch-analyzer.exe");
        let packaged_toolchain=resources.join("toolchain");
        let (executable,toolchain)=if packaged_executable.is_file() && packaged_toolchain.is_dir() {
            (packaged_executable,packaged_toolchain)
        } else {
            let project=PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
            (project.join("native/analyzer/build/bin/flowsketch-analyzer.exe"),project.join("tools/llvm-mingw-20261006-ucrt-x86_64"))
        };
        let context_digest=protocol::digest(b"flowsketch-v1/c++17/clang23.1.3/llvm-mingw20261006/ucrt-x64/stdlib-captured-only");
        Self{executable,toolchain,context_digest,jobs:Arc::new(Mutex::new(HashMap::new()))}
    }
    pub fn cancel(&self, request_id: &str) {
        if let Ok(jobs)=self.jobs.lock() { if let Some(flag)=jobs.get(request_id) { flag.store(true,Ordering::SeqCst); } }
    }
    #[cfg(feature="webdriver")]
    pub fn evidence_info(&self) -> Value {
        serde_json::json!({"executable":self.executable,"toolchain":self.toolchain,"clangToolchainArgument":clang_path(&self.toolchain),"contextDigest":self.context_digest,"jobMemoryLimitBytes":1_073_741_824u64,"timeoutSeconds":15,"sourceExecuted":false})
    }
    pub fn analyze(&self, request: AnalyzeRequest) -> Value {
        if let Err(message)=protocol::validate_request(&request) { return protocol::failure(&request,&self.context_digest,"INPUT_ERROR","INPUT_LIMIT_OR_FORMAT",&message); }
        if !self.executable.is_file() || !self.toolchain.join("include/c++/v1").is_dir() {
            return protocol::failure(&request,&self.context_digest,"FAILURE","ANALYZER_UNAVAILABLE","Компонент анализа недоступен. Проверьте установку приложения.");
        }
        let cancelled=Arc::new(AtomicBool::new(false));
        {
            let mut jobs=match self.jobs.lock() { Ok(j)=>j, Err(_)=>return protocol::failure(&request,&self.context_digest,"FAILURE","JOB_STATE","Не удалось создать фоновое задание.") };
            if jobs.contains_key(&request.request_id) { return protocol::failure(&request,&self.context_digest,"FAILURE","DUPLICATE_REQUEST","Задание с таким идентификатором уже выполняется."); }
            for flag in jobs.values() { flag.store(true,Ordering::SeqCst); }
            jobs.insert(request.request_id.clone(),cancelled.clone());
        }
        let start=Instant::now();
        let native_request=NativeRequest{protocol_version:1,request_id:&request.request_id,source_revision:request.source_revision,source_digest:protocol::digest(request.source.as_bytes()),context_digest:&self.context_digest,source:&request.source,function_id:&request.function_id,operation:&request.operation};
        let bytes=serde_json::to_vec(&native_request).expect("Serializable native request");
        let result=process::run(&self.executable,&["--toolchain-root".into(),clang_path(&self.toolchain)],&bytes,cancelled.clone(),Duration::from_secs(15),protocol::MAX_OUTPUT);
        if let Ok(mut jobs)=self.jobs.lock() { jobs.remove(&request.request_id); }
        if cancelled.load(Ordering::SeqCst) { return protocol::failure(&request,&self.context_digest,"CANCELLED","CANCELLED","Построение отменено."); }
        let mut response=match result {
            Ok(output)=>match serde_json::from_slice::<Value>(&output) {
                Ok(value)=>value,
                Err(_)=>return protocol::failure(&request,&self.context_digest,"FAILURE","PROTOCOL_JSON","Анализатор вернул поврежденный ответ."),
            },
            Err(process::Failure::Cancelled)=>return protocol::failure(&request,&self.context_digest,"CANCELLED","CANCELLED","Построение отменено."),
            Err(process::Failure::Timeout)=>return protocol::failure(&request,&self.context_digest,"FAILURE","ANALYZER_TIMEOUT","Анализ превысил 15 секунд. Уменьшите функцию или исходник."),
            Err(process::Failure::MemoryLimit)=>return protocol::failure(&request,&self.context_digest,"FAILURE","MEMORY_LIMIT","Анализ превысил лимит памяти 1 GiB. Уменьшите функцию или исходник."),
            Err(process::Failure::OutputLimit)=>return protocol::failure(&request,&self.context_digest,"FAILURE","OUTPUT_LIMIT","Ответ анализатора превысил допустимый размер."),
            Err(process::Failure::System(detail))=>{
                #[cfg(debug_assertions)] eprintln!("FlowSketch native process failure: {}",detail);
                return protocol::failure(&request,&self.context_digest,"FAILURE","ANALYZER_PROCESS","Компонент анализа завершился со сбоем.");
            },
        };
        if let Err(message)=protocol::validate_response(&response,&request,&self.context_digest) { return protocol::failure(&request,&self.context_digest,"FAILURE","PROTOCOL_MISMATCH",&message); }
        if response.get("functionId").is_none() { if let Some(id)=response.get("selectedFunctionId").cloned() { response["functionId"]=id; } }
        response["elapsedMs"]=serde_json::json!(start.elapsed().as_millis() as u64);
        response
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;
    #[test] fn tauri_verbatim_paths_are_compatible_with_clang_include_paths() {
        assert_eq!(clang_path(Path::new(r"\\?\C:\Приложения\Flow Sketch\toolchain")),"C:/Приложения/Flow Sketch/toolchain");
        assert_eq!(clang_path(Path::new(r"\\?\UNC\server\share\toolchain")),"//server/share/toolchain");
        assert_eq!(clang_path(Path::new(r"C:\FlowSketch\toolchain")),"C:/FlowSketch/toolchain");
    }
}
impl Drop for NativeHost {
    fn drop(&mut self) {
        if Arc::strong_count(&self.jobs)==1 { if let Ok(jobs)=self.jobs.lock() { for flag in jobs.values(){flag.store(true,Ordering::SeqCst);} } }
    }
}
