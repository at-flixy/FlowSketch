use std::io::{Read, Write};
fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("sleep")=>std::thread::sleep(std::time::Duration::from_secs(30)),
        Some("flood")=>{let chunk=[b'x';8192];loop{if std::io::stdout().write_all(&chunk).is_err(){break;}}},
        Some("memory")=>{let mut bytes=vec![0u8;128*1024*1024];for index in (0..bytes.len()).step_by(4096){bytes[index]=1;}std::hint::black_box(bytes);std::io::stdout().write_all(b"allocation succeeded").unwrap();},
        Some("echo")=>{let mut bytes=Vec::new();std::io::stdin().read_to_end(&mut bytes).unwrap();std::io::stdout().write_all(&bytes).unwrap();},
        _=>std::process::exit(2),
    }
}
