//! Fixed-executable native jobs, started suspended and assigned before execution.
use std::{io::{Read, Write}, path::Path, process::{Child, Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc}, time::{Duration, Instant}};

#[derive(Debug)]
pub enum Failure { Cancelled, Timeout, MemoryLimit, OutputLimit, System(String) }
impl From<std::io::Error> for Failure { fn from(error: std::io::Error) -> Self { Self::System(error.to_string()) } }

struct ChildOwner(Child);
impl Drop for ChildOwner { fn drop(&mut self) { let _=self.0.kill(); let _=self.0.wait(); } }

#[cfg(windows)]
mod windows_job {
    use super::*;
    use std::{mem::{size_of, zeroed}, os::windows::{io::AsRawHandle, process::CommandExt}};
    use windows_sys::Win32::{Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE}, System::{Diagnostics::{ToolHelp::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, THREADENTRY32, TH32CS_SNAPTHREAD}, Debug::{SetErrorMode,SEM_FAILCRITICALERRORS,SEM_NOGPFAULTERRORBOX}}, IO::{CreateIoCompletionPort,GetQueuedCompletionStatus}, SystemServices::{JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT,JOB_OBJECT_MSG_JOB_MEMORY_LIMIT}, JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, JobObjectAssociateCompletionPortInformation, SetInformationJobObject, TerminateJobObject, JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY}, Threading::{OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME}}};
    pub struct Job { handle:HANDLE, port:HANDLE }
    impl Drop for Job { fn drop(&mut self) { unsafe { CloseHandle(self.handle);CloseHandle(self.port); } } }
    impl Job {
        pub fn assign(child: &Child, memory_limit: usize) -> Result<Self, Failure> {
            unsafe {
                let handle=CreateJobObjectW(std::ptr::null(),std::ptr::null());
                if handle.is_null() { return Err(std::io::Error::last_os_error().into()); }
                let port=CreateIoCompletionPort(INVALID_HANDLE_VALUE,std::ptr::null_mut(),0,1);
                if port.is_null(){CloseHandle(handle);return Err(std::io::Error::last_os_error().into());}
                let job=Self{handle,port};
                let completion=JOBOBJECT_ASSOCIATE_COMPLETION_PORT{CompletionKey:std::ptr::null_mut(),CompletionPort:port};
                if SetInformationJobObject(handle,JobObjectAssociateCompletionPortInformation,&completion as *const _ as *const _,size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32)==0 { return Err(std::io::Error::last_os_error().into()); }
                let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=zeroed();
                limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_PROCESS_MEMORY|JOB_OBJECT_LIMIT_JOB_MEMORY;
                limits.ProcessMemoryLimit=memory_limit;limits.JobMemoryLimit=memory_limit;
                if SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&limits as *const _ as *const _,size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32)==0
                    || AssignProcessToJobObject(handle,child.as_raw_handle() as HANDLE)==0 { return Err(std::io::Error::last_os_error().into()); }
                Ok(job)
            }
        }
        pub fn memory_exceeded(&self)->bool {
            unsafe {
                let mut message=0u32;let mut key=0usize;let mut overlapped=std::ptr::null_mut();
                while GetQueuedCompletionStatus(self.port,&mut message,&mut key,&mut overlapped,0)!=0 {
                    if message==JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT || message==JOB_OBJECT_MSG_JOB_MEMORY_LIMIT { return true; }
                }
                false
            }
        }
        pub fn terminate(&self) { unsafe { TerminateJobObject(self.handle,1); } }
    }
    pub fn suspended(command: &mut Command) {
        static ERROR_MODE:std::sync::Once=std::sync::Once::new();
        ERROR_MODE.call_once(||unsafe{SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);});
        command.creation_flags(CREATE_NO_WINDOW|CREATE_SUSPENDED);
    }
    pub fn resume(child: &Child) -> Result<(), Failure> {
        unsafe {
            let snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD,0);
            if snapshot==INVALID_HANDLE_VALUE { return Err(std::io::Error::last_os_error().into()); }
            let mut entry:THREADENTRY32=zeroed();entry.dwSize=size_of::<THREADENTRY32>() as u32;
            let mut found=None;
            if Thread32First(snapshot,&mut entry)!=0 {
                loop {
                    if entry.th32OwnerProcessID==child.id() { found=Some(entry.th32ThreadID);break; }
                    if Thread32Next(snapshot,&mut entry)==0 { break; }
                }
            }
            CloseHandle(snapshot);
            let id=found.ok_or_else(||Failure::System("Suspended process has no primary thread".into()))?;
            let thread=OpenThread(THREAD_SUSPEND_RESUME,0,id);
            if thread.is_null() { return Err(std::io::Error::last_os_error().into()); }
            let resumed=ResumeThread(thread);CloseHandle(thread);
            if resumed==u32::MAX { return Err(std::io::Error::last_os_error().into()); }
            Ok(())
        }
    }
}

enum StreamEvent { Input(Result<(),Failure>), Output(Result<Vec<u8>,Failure>), Error(Result<Vec<u8>,Failure>) }
fn read_bounded(mut reader: impl Read, limit: usize) -> Result<Vec<u8>,Failure> {
    let mut bytes=Vec::new();let mut chunk=[0u8;8192];
    loop { let count=reader.read(&mut chunk)?;if count==0 { break; }if bytes.len()+count>limit { return Err(Failure::OutputLimit); }bytes.extend_from_slice(&chunk[..count]); }
    Ok(bytes)
}
pub fn run(executable: &Path, arguments: &[String], input: &[u8], cancelled: Arc<AtomicBool>, timeout: Duration, output_limit: usize) -> Result<Vec<u8>,Failure> {
    run_with_memory(executable,arguments,input,cancelled,timeout,output_limit,1024*1024*1024)
}
fn run_with_memory(executable: &Path, arguments: &[String], input: &[u8], cancelled: Arc<AtomicBool>, timeout: Duration, output_limit: usize, memory_limit: usize) -> Result<Vec<u8>,Failure> {
    if !cfg!(windows) { return Err(Failure::System("Only Windows native jobs are supported".into())); }
    if cancelled.load(Ordering::SeqCst) { return Err(Failure::Cancelled); }
    let started=Instant::now();
    let mut command=Command::new(executable);command.args(arguments).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).env_clear();
    if let Some(system_root)=std::env::var_os("SystemRoot") {
        command.env("SystemRoot",&system_root).env("WINDIR",&system_root);
        let native_dir=executable.parent().unwrap_or(Path::new("."));
        let path=format!("{};{}",native_dir.to_string_lossy(),Path::new(&system_root).join("System32").to_string_lossy());command.env("PATH",path);
    }
    if let Some(temp)=std::env::var_os("TEMP") { command.env("TEMP",&temp).env("TMP",temp); }
    #[cfg(windows)] windows_job::suspended(&mut command);
    let mut child=ChildOwner(command.spawn()?);
    #[cfg(windows)] let job=windows_job::Job::assign(&child.0,memory_limit)?;
    #[cfg(windows)] windows_job::resume(&child.0)?;
    let stdin=child.0.stdin.take().ok_or_else(||Failure::System("Missing input pipe".into()))?;
    let stdout=child.0.stdout.take().ok_or_else(||Failure::System("Missing output pipe".into()))?;
    let stderr=child.0.stderr.take().ok_or_else(||Failure::System("Missing error pipe".into()))?;
    let (sender,receiver)=mpsc::channel();
    let out_sender=sender.clone();let err_sender=sender.clone();let writer_input=input.to_vec();
    let writer=std::thread::spawn(move || { let mut stdin=stdin;let result=stdin.write_all(&writer_input).map_err(Failure::from);drop(stdin);let _=sender.send(StreamEvent::Input(result)); });
    let output_reader=std::thread::spawn(move || { let _=out_sender.send(StreamEvent::Output(read_bounded(stdout,output_limit))); });
    let error_reader=std::thread::spawn(move || { let _=err_sender.send(StreamEvent::Error(read_bounded(stderr,256*1024))); });
    let mut output=None;let mut error_ready=false;let mut input_ready=false;
    let result=loop {
        if cancelled.load(Ordering::SeqCst) { break Err(Failure::Cancelled); }
        #[cfg(windows)] if job.memory_exceeded() { break Err(Failure::MemoryLimit); }
        if started.elapsed()>=timeout { break Err(Failure::Timeout); }
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(StreamEvent::Input(Ok(())))=>input_ready=true,
            Ok(StreamEvent::Input(Err(error)))=>break Err(error),
            Ok(StreamEvent::Output(Ok(bytes)))=>output=Some(bytes),
            Ok(StreamEvent::Error(Ok(_)))=>error_ready=true,
            Ok(StreamEvent::Output(Err(error)))|Ok(StreamEvent::Error(Err(error)))=>break Err(error),
            Err(mpsc::RecvTimeoutError::Disconnected)=>{},
            Err(mpsc::RecvTimeoutError::Timeout)=>{},
        }
        match child.0.try_wait() {
            Ok(Some(status)) if output.is_some() && error_ready && input_ready => {
                if status.success() { break Ok(output.take().unwrap()); }
                break Err(Failure::System(format!("Native exit {:?}",status.code())));
            }
            Ok(_)=>{},Err(error)=>break Err(error.into()),
        }
    };
    #[cfg(windows)] job.terminate();
    let _=child.0.kill();let _=child.0.wait();
    let _=writer.join();let _=output_reader.join();let _=error_reader.join();
    result
}

#[cfg(all(test,windows))]
mod tests {
    use super::*;
    use std::sync::OnceLock;
    fn probe()->std::path::PathBuf {
        static PROBE:OnceLock<std::path::PathBuf>=OnceLock::new();
        PROBE.get_or_init(||{
            let project=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
            let output=project.join("src-tauri/target/test-tools/process-probe.exe");std::fs::create_dir_all(output.parent().unwrap()).unwrap();
            let compiler=project.join("tools/cargo/bin/rustc.exe");
            let status=Command::new(compiler).arg(project.join("src-tauri/tests/fixtures/process_probe.rs")).args(["--edition=2021","-O","-o"]).arg(&output).status().unwrap();assert!(status.success());output
        }).clone()
    }
    #[test] fn timeout_covers_blocked_stdin_and_terminates_child() {
        // Test fixture compilation is setup, not part of the native-job deadline.
        let helper=probe();let now=Instant::now();let result=run(&helper,&["sleep".into()],&vec![b'x';256*1024],Arc::new(AtomicBool::new(false)),Duration::from_millis(350),1024);
        assert!(matches!(result,Err(Failure::Timeout)),"{:?}",result);assert!(now.elapsed()<Duration::from_secs(3));
    }
    #[test] fn cancel_during_job_is_bounded() {
        let flag=Arc::new(AtomicBool::new(false));let setter=flag.clone();let helper=probe();
        let thread=std::thread::spawn(move||run(&helper,&["sleep".into()],b"",flag,Duration::from_secs(10),1024));
        std::thread::sleep(Duration::from_millis(150));let now=Instant::now();setter.store(true,Ordering::SeqCst);
        assert!(matches!(thread.join().unwrap(),Err(Failure::Cancelled)));assert!(now.elapsed()<Duration::from_secs(1));
    }
    #[test] fn excessive_output_is_rejected_before_unbounded_read() {
        let result=run(&probe(),&["flood".into()],b"",Arc::new(AtomicBool::new(false)),Duration::from_secs(3),64*1024);
        assert!(matches!(result,Err(Failure::OutputLimit)),"{:?}",result);
    }
    #[test] fn memory_limit_is_enforced_by_windows_job() {
        let result=run_with_memory(&probe(),&["memory".into()],b"",Arc::new(AtomicBool::new(false)),Duration::from_secs(3),1024,64*1024*1024);
        assert!(matches!(result,Err(Failure::MemoryLimit)),"{:?}",result);
    }
    #[test] fn normal_native_io_survives_environment_clear() {
        let result=run(&probe(),&["echo".into()],b"UTF8: schema",Arc::new(AtomicBool::new(false)),Duration::from_secs(3),1024).unwrap();
        assert_eq!(result,b"UTF8: schema");
    }
}
