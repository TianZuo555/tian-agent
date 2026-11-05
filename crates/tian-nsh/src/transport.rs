//! Bounded JSON-lines framing over the existing private Unix socket.

use serde_json::Value;
use std::{cell::Cell, os::unix::net::UnixStream as StdStream, path::Path, rc::Rc};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{
        UnixStream,
        unix::{OwnedReadHalf, OwnedWriteHalf},
    },
    sync::{Mutex, Notify},
};

pub(crate) const MAX_RECEIVE: usize = 16 * 1024 * 1024;
pub(crate) const MAX_SEND: usize = 1024 * 1024;
// Read from the service source at build time, so a protocol bump cannot drift.
include!(concat!(env!("OUT_DIR"), "/protocol.rs"));

pub(crate) fn validate_path(path: &str) -> Result<(), String> {
    if !Path::new(path).is_absolute() || path.len() > 100 || path.contains('\0') {
        return Err("Use an absolute Unix socket path of at most 100 UTF-8 bytes".into());
    }
    Ok(())
}

pub(crate) fn encode(message: &Value) -> Result<Vec<u8>, String> {
    let mut frame = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    frame.push(b'\n');
    if frame.len() > MAX_SEND {
        return Err("Service request exceeds the 1 MiB limit".into());
    }
    Ok(frame)
}

async fn read_frame(reader: &mut BufReader<OwnedReadHalf>) -> Result<Value, String> {
    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf().await.map_err(|e| e.to_string())?;
        if available.is_empty() {
            return Err("Resident service disconnected".into());
        }
        let newline = available.iter().position(|b| *b == b'\n');
        let count = newline.map_or(available.len(), |at| at + 1);
        if frame.len() + count > MAX_RECEIVE {
            return Err("Service frame exceeds the 16 MiB limit".into());
        }
        frame.extend_from_slice(&available[..count]);
        reader.consume(count);
        if newline.is_some() {
            if frame == b"\n" || frame == b"\r\n" {
                frame.clear();
                continue;
            }
            return serde_json::from_slice(&frame)
                .map_err(|e| format!("Invalid service JSON: {e}"));
        }
    }
}

fn validate_ready(value: &Value) -> Result<(), String> {
    let info = &value["info"];
    if value["type"] != "ready"
        || info["protocolVersion"].as_u64() != Some(SERVICE_PROTOCOL)
        || !info["serviceVersion"].is_string()
        || !info["releaseId"].is_string()
        || info["databaseVersion"].as_u64().is_none()
        || info["pid"].as_u64().is_none()
        || !info["startedAt"].is_string()
    {
        return Err("Incompatible resident service handshake".into());
    }
    Ok(())
}

struct Inner {
    read: Mutex<BufReader<OwnedReadHalf>>,
    write: Mutex<OwnedWriteHalf>,
    closer: StdStream,
    closed: Cell<bool>,
    queued: Cell<usize>,
    cancel: Notify,
}

impl Inner {
    fn close(&self) {
        self.closed.set(true);
        let _ = self.closer.shutdown(std::net::Shutdown::Both);
        self.cancel.notify_waiters();
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.close();
    }
}

#[derive(Clone)]
pub(crate) struct Peer(Rc<Inner>);

impl Peer {
    pub(crate) async fn connect(path: &str) -> Result<Self, String> {
        validate_path(path)?;
        let stream = UnixStream::connect(path).await.map_err(|e| e.to_string())?;
        Self::from_stream(stream).await
    }

    async fn from_stream(stream: UnixStream) -> Result<Self, String> {
        let standard = stream.into_std().map_err(|e| e.to_string())?;
        let closer = standard.try_clone().map_err(|e| e.to_string())?;
        let (read, write) = UnixStream::from_std(standard)
            .map_err(|e| e.to_string())?
            .into_split();
        let mut read = BufReader::new(read);
        validate_ready(&read_frame(&mut read).await?)?;
        Ok(Self(Rc::new(Inner {
            read: Mutex::new(read),
            write: Mutex::new(write),
            closer,
            closed: Cell::new(false),
            queued: Cell::new(0),
            cancel: Notify::new(),
        })))
    }

    pub(crate) async fn next(&self) -> Result<Value, String> {
        if self.0.closed.get() {
            return Err("Service connection is closed".into());
        }
        let result = tokio::select! {
            biased;
            _ = self.0.cancel.notified() => Err("Service connection is closed".into()),
            result = async {
                let mut reader = self.0.read.lock().await;
                read_frame(&mut reader).await
            } => result,
        };
        if result.is_err() {
            self.close();
        }
        result
    }

    pub(crate) async fn send(&self, frame: Vec<u8>) -> Result<(), String> {
        if self.0.closed.get() {
            return Err("Service connection is closed".into());
        }
        if self.0.queued.get() + frame.len() > MAX_SEND * 4 {
            self.close();
            return Err("Service output queue is full".into());
        }
        self.0.queued.set(self.0.queued.get() + frame.len());
        struct Queued<'a>(&'a Cell<usize>, usize);
        impl Drop for Queued<'_> {
            fn drop(&mut self) {
                self.0.set(self.0.get() - self.1);
            }
        }
        let _queued = Queued(&self.0.queued, frame.len());
        let result = tokio::select! {
            biased;
            _ = self.0.cancel.notified() => Err("Service connection is closed".into()),
            result = async {
                let mut writer = self.0.write.lock().await;
                tokio::time::timeout(std::time::Duration::from_secs(30), writer.write_all(&frame))
                    .await.map_err(|_| "Service write timed out".to_owned())?
                    .map_err(|e| e.to_string())
            } => result,
        };
        if result.is_err() {
            self.close();
        }
        result
    }

    pub(crate) fn close(&self) {
        self.0.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ready() -> Value {
        json!({"type":"ready", "info": {
            "protocolVersion": SERVICE_PROTOCOL, "serviceVersion":"1.1.0", "releaseId":"test",
            "databaseVersion":8, "pid":42, "startedAt":"2026-01-01T00:00:00Z"
        }})
    }

    #[test]
    fn rejects_wrong_protocol_and_invalid_paths() {
        let mut value = ready();
        assert!(validate_ready(&value).is_ok());
        value["info"]["protocolVersion"] = json!(0);
        assert!(validate_ready(&value).is_err());
        assert!(validate_path("relative.sock").is_err());
        assert!(validate_path(&format!("/{}", "中".repeat(34))).is_err());
        assert!(validate_path("/tmp/nsh.sock").is_ok());
        assert!(encode(&json!("x".repeat(MAX_SEND))).is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn handles_fragmented_unicode_multiple_frames_and_eof() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let writer = async move {
            let mut bytes = serde_json::to_vec(&ready()).unwrap();
            bytes.extend_from_slice(b"\n\n{\"text\":\"");
            bytes.extend_from_slice("中文".as_bytes());
            bytes.extend_from_slice(b"\"}\n{\"type\":\"result\",\"id\":1}\n");
            for byte in bytes {
                server.write_all(&[byte]).await.unwrap();
                tokio::task::yield_now().await;
            }
        };
        let reader = async {
            let peer = Peer::from_stream(client).await.unwrap();
            assert_eq!(peer.next().await.unwrap()["text"], "中文");
            assert_eq!(peer.next().await.unwrap()["id"], 1);
            assert!(peer.next().await.is_err());
        };
        tokio::join!(writer, reader);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn close_interrupts_pending_read() {
        let (client, mut server) = UnixStream::pair().unwrap();
        server.write_all(&encode(&ready()).unwrap()).await.unwrap();
        let peer = Peer::from_stream(client).await.unwrap();
        let read = peer.next();
        let close = async {
            tokio::task::yield_now().await;
            peer.close();
        };
        let (result, _) = tokio::join!(read, close);
        assert!(result.is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn malformed_and_oversized_frames_fail() {
        for bytes in [b"not json\n".to_vec(), vec![b'x'; MAX_RECEIVE + 1]] {
            let (client, mut server) = UnixStream::pair().unwrap();
            let writer = async move {
                server.write_all(&encode(&ready()).unwrap()).await.unwrap();
                let _ = server.write_all(&bytes).await;
            };
            let reader = async {
                let peer = Peer::from_stream(client).await.unwrap();
                assert!(peer.next().await.is_err());
            };
            tokio::join!(writer, reader);
        }
    }
}
