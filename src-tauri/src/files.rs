use crate::protocol::{MAX_PROJECT, MAX_SOURCE};
use serde::Serialize;
use serde_json::Value;
use std::{fs::{self, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use tauri_plugin_dialog::DialogExt;
use tauri::Manager;

fn dialog(app: &tauri::AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let picker=app.dialog().file();
    if let Some(window)=app.get_webview_window("main") { picker.set_parent(&window) } else { picker }
}
// The test build automates only the path selection. File IO and validation remain real.
// No test path or WebDriver endpoint is compiled into the distributed prototype.
fn choose(picker: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>, name: &str, save: bool) -> Result<Option<PathBuf>,String> {
    #[cfg(feature="webdriver")]
    if let Ok(directory)=std::env::var("FLOWSKETCH_TEST_DIRECTORY") {
        let directory=fs::canonicalize(directory).map_err(|_|"Папка проверки не найдена.".to_string())?;
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("spikes/tauri/evidence");
        let root=fs::canonicalize(root).map_err(|_|"Папка доказательств не найдена.".to_string())?;
        if !directory.starts_with(&root) { return Err("Папка проверки находится вне evidence.".into()); }
        return Ok(Some(directory.join(name)));
    }
    let _=name;
    let path=if save { picker.blocking_save_file() } else { picker.blocking_pick_file() };
    path.map(selected_path).transpose()
}

#[derive(Serialize)]
pub struct SourceFile { source: String, path: String }
#[derive(Serialize)]
pub struct ProjectFile { project: Value, path: String }
fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>,String> {
    let file=fs::File::open(path).map_err(|_|"Не удалось открыть файл. Проверьте доступ к нему.".to_string())?;
    if file.metadata().map_err(|_|"Не удалось прочитать сведения о файле.".to_string())?.len()>limit as u64 { return Err("Размер файла превышает допустимый предел.".into()); }
    let mut bytes=Vec::new();file.take((limit+1) as u64).read_to_end(&mut bytes).map_err(|_|"Не удалось прочитать файл.".to_string())?;
    if bytes.len()>limit { return Err("Размер файла превышает допустимый предел.".into()); }
    Ok(bytes)
}
fn source_text(bytes: Vec<u8>) -> Result<String,String> {
    let source=String::from_utf8(bytes).map_err(|_|"Файл не является UTF-8. Сохраните его в UTF-8 и откройте снова; данные не заменены.".to_string())?;
    if source.split('\n').count()>5000 { return Err("Исходник превышает 5000 строк.".into()); }
    Ok(source)
}
pub fn validate_project(project: &Value) -> Result<(),String> {
    if project["schemaVersion"] != 1 { return Err("Версия проекта не поддерживается. Оригинальный файл не изменен.".into()); }
    let source=project["source"].as_str().ok_or("В проекте отсутствует исходный код.")?;
    if source.len()>MAX_SOURCE || source.split('\n').count()>5000 { return Err("Исходник в проекте превышает допустимый предел.".into()); }
    if project["title"].as_str().is_none_or(|s|s.len()>512) || project["sourceRevision"].as_u64().is_none() { return Err("Повреждены свойства проекта.".into()); }
    let style=&project["style"];
    if !["educational","monochrome","cool","contrast"].contains(&style["templateId"].as_str().unwrap_or("")) || style["fontFamily"]!="Liberation Sans" { return Err("Шаблон или шрифт проекта не поддерживается.".into()); }
    if style["fontSize"].as_f64().is_none_or(|v|!(12.0..=24.0).contains(&v)) || style["strokeWidth"].as_f64().is_none_or(|v|!(0.5..=4.0).contains(&v)) { return Err("Размер шрифта или толщина линии вне допустимого диапазона.".into()); }
    for key in ["nodeFill","decisionFill","terminalFill","textColor","lineColor","background"] {
        let color=style[key].as_str().ok_or("В проекте отсутствует цвет оформления.")?;
        if color.len()!=7 || !color.starts_with('#') || !color[1..].chars().all(|c|c.is_ascii_hexdigit()) { return Err("Некорректный цвет оформления.".into()); }
    }
    if project.get("graph").is_some() || project.get("analysis").is_some() { return Err("Проект содержит непроверенный результат. Откройте исходник и постройте схему заново.".into()); }
    Ok(())
}
fn extension(path: PathBuf, expected: &str) -> Result<PathBuf,String> {
    if path.extension().is_some_and(|e|e.eq_ignore_ascii_case(expected)) { Ok(path) }
    else { Err(format!("Укажите расширение .{}. Выбранный файл не изменен.",expected)) }
}
pub fn atomic_write(path: &Path, bytes: &[u8], backup: bool) -> Result<(),String> {
    let parent=path.parent().ok_or("Не удалось определить папку сохранения.")?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Не удалось определить время сохранения.")?.as_nanos();
    let temporary=parent.join(format!(".flowsketch-{}-{}.tmp",std::process::id(),stamp));
    let mut file=OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_|"Не удалось создать файл в выбранной папке.".to_string())?;
    let result=(||{
        file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|_|"Не удалось записать файл; данные остаются в приложении.".to_string())?;
        drop(file);
        if backup && path.is_file() {
            let backup_path=path.with_extension("flowsketch.bak");
            fs::copy(path,backup_path).map_err(|_|"Не удалось сохранить резервную копию. Оригинальный проект не изменен.".to_string())?;
        }
        fs::rename(&temporary,path).map_err(|_|"Не удалось завершить сохранение. Оригинальный файл не изменен.".to_string())?;
        Ok(())
    })();
    if result.is_err() { let _=fs::remove_file(&temporary); }
    result
}
fn selected_path(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf,String> {
    path.into_path().map_err(|_|"Выберите локальный файл на этом компьютере.".to_string())
}
#[tauri::command]
pub async fn open_cpp(app: tauri::AppHandle) -> Result<Option<SourceFile>,String> {
    tauri::async_runtime::spawn_blocking(move||{
        let Some(path)=choose(dialog(&app).add_filter("Исходник C++",&["cpp"]),"input.cpp",false)? else { return Ok(None); };
        if !path.extension().is_some_and(|e|e.eq_ignore_ascii_case("cpp")) { return Err("Выберите файл с расширением .cpp.".into()); }
        let source=source_text(read_limited(&path,MAX_SOURCE)?)?;
        Ok(Some(SourceFile{source,path:path.to_string_lossy().into_owned()}))
    }).await.map_err(|_|"Не удалось открыть диалог выбора файла.".to_string())?
}
#[tauri::command]
pub async fn open_project(app: tauri::AppHandle) -> Result<Option<ProjectFile>,String> {
    tauri::async_runtime::spawn_blocking(move||{
        let Some(path)=choose(dialog(&app).add_filter("Проект FlowSketch",&["flowsketch"]),"project.flowsketch",false)? else { return Ok(None); };
        let bytes=read_limited(&path,MAX_PROJECT)?;
        let project:Value=serde_json::from_slice(&bytes).map_err(|_|"Файл проекта поврежден или имеет другой формат.".to_string())?;
        validate_project(&project)?;
        Ok(Some(ProjectFile{project,path:path.to_string_lossy().into_owned()}))
    }).await.map_err(|_|"Не удалось открыть диалог проекта.".to_string())?
}
#[tauri::command]
pub async fn save_project(app: tauri::AppHandle,project: Value) -> Result<Option<String>,String> {
    validate_project(&project)?;
    let bytes=serde_json::to_vec_pretty(&project).map_err(|_|"Не удалось подготовить проект к сохранению.".to_string())?;
    if bytes.len()>MAX_PROJECT { return Err("Размер проекта превышает допустимый предел.".into()); }
    tauri::async_runtime::spawn_blocking(move||{
        let Some(path)=choose(dialog(&app).add_filter("Проект FlowSketch",&["flowsketch"]).set_file_name("Схема.flowsketch"),"project.flowsketch",true)? else { return Ok(None); };
        let path=extension(path,"flowsketch")?;atomic_write(&path,&bytes,true)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|_|"Не удалось открыть диалог сохранения.".to_string())?
}
fn validate_export(bytes: &[u8],format: &str) -> Result<(),String> {
    if bytes.is_empty() || bytes.len()>64*1024*1024 { return Err("Экспорт превышает допустимый размер файла.".into()); }
    match format {
        "svg"=>{
            let text=std::str::from_utf8(bytes).map_err(|_|"Поврежден векторный экспорт.".to_string())?;
            if !text.trim_start().starts_with("<svg") || !text.contains("</svg>") { return Err("Поврежден векторный экспорт.".into()); }
        },
        "png"=>{
            if bytes.len()<24 || &bytes[..8]!=b"\x89PNG\r\n\x1a\n" { return Err("Поврежден PNG экспорт.".into()); }
            let width=u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as u64;
            let height=u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as u64;
            if width==0 || height==0 || width>16384 || height>16384 || width*height>64_000_000 { return Err("PNG превышает пределы размера. Выберите SVG.".into()); }
        },
        "pdf"=>{ if !bytes.starts_with(b"%PDF-") { return Err("Поврежден PDF экспорт.".into()); } },
        _=>return Err("Формат экспорта не поддерживается.".into()),
    }
    Ok(())
}
#[tauri::command]
pub async fn save_export(app: tauri::AppHandle,bytes: Vec<u8>,format: String,filename: String) -> Result<Option<String>,String> {
    validate_export(&bytes,&format)?;
    let clean_name=filename.chars().filter(|c|!c.is_control()&&!r#"\/:*?"<>|"#.contains(*c)).take(100).collect::<String>();
    tauri::async_runtime::spawn_blocking(move||{
        let Some(path)=choose(dialog(&app).add_filter("Схема",&[format.as_str()]).set_file_name(if clean_name.is_empty(){"Схема"}else{&clean_name}),&format!("diagram.{}",format),true)? else { return Ok(None); };
        let path=extension(path,&format)?;atomic_write(&path,&bytes,false)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|_|"Не удалось открыть диалог экспорта.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn corrupt_project_and_unsafe_colors_do_not_replace_source() {
        let mut project=json!({"schemaVersion":1,"title":"test","source":"int f(){return 1;}","sourceRevision":0,"style":{"templateId":"cool","fontFamily":"Liberation Sans","fontSize":14,"strokeWidth":1.5,"nodeFill":"#ffffff","decisionFill":"#ffffff","terminalFill":"#ffffff","textColor":"#111111","lineColor":"#111111","background":"#ffffff"}});
        assert!(validate_project(&project).is_ok());project["schemaVersion"]=json!(2);assert!(validate_project(&project).is_err());
        project["schemaVersion"]=json!(1);project["style"]["nodeFill"]=json!("url(https://example.com)");assert!(validate_project(&project).is_err());
    }
    #[test] fn atomic_replace_preserves_previous_project_as_backup() {
        let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();let folder=std::env::temp_dir().join(format!("flowsketch-file-test-{}-{}",std::process::id(),stamp));fs::create_dir(&folder).unwrap();let path=folder.join("test.flowsketch");
        atomic_write(&path,b"first",true).unwrap();atomic_write(&path,b"second",true).unwrap();
        assert_eq!(fs::read(&path).unwrap(),b"second");assert_eq!(fs::read(path.with_extension("flowsketch.bak")).unwrap(),b"first");
        fs::remove_file(&path).unwrap();fs::remove_file(path.with_extension("flowsketch.bak")).unwrap();fs::remove_dir(folder).unwrap();
    }
    #[test] fn malformed_utf8_and_oversized_png_are_explicit_errors() {
        assert!(source_text(vec![0xff,0xfe]).is_err());assert_eq!(source_text(b"\xef\xbb\xbfint f(){}\r\n".to_vec()).unwrap(),"\u{feff}int f(){}\r\n");
        let mut png=vec![0;24];png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");png[16..20].copy_from_slice(&20000u32.to_be_bytes());png[20..24].copy_from_slice(&20000u32.to_be_bytes());assert!(validate_export(&png,"png").is_err());
    }
}
