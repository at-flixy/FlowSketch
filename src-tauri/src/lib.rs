mod files;
mod native;
mod process;
mod protocol;

use serde_json::Value;
use tauri::Manager;

#[tauri::command]
async fn analyze(request: protocol::AnalyzeRequest, host: tauri::State<'_, native::NativeHost>) -> Result<Value, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.analyze(request)).await.map_err(|_| "Сбой фонового задания.".to_string())
}
#[tauri::command]
fn cancel(request_id: String, host: tauri::State<'_, native::NativeHost>) -> Result<(), String> { host.cancel(&request_id); Ok(()) }

#[cfg(feature="webdriver")]
#[tauri::command]
fn runtime_info(host: tauri::State<'_, native::NativeHost>) -> Value { host.evidence_info() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder=tauri::Builder::default();
    #[cfg(feature="webdriver")]
    let builder=builder.plugin(tauri_plugin_wdio_webdriver::init());
    let builder=builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            app.manage(native::NativeHost::new(resources));
            Ok(())
        });
    #[cfg(feature="webdriver")]
    let builder=builder.invoke_handler(tauri::generate_handler![analyze, cancel, files::open_cpp, files::open_project, files::save_project, files::save_export, runtime_info]);
    #[cfg(not(feature="webdriver"))]
    let builder=builder.invoke_handler(tauri::generate_handler![analyze, cancel, files::open_cpp, files::open_project, files::save_project, files::save_export]);
    builder
        .run(tauri::generate_context!())
        .expect("Could not run FlowSketch");
}
