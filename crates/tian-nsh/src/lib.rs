//! Native service connection for the NSH desktop client.

mod transport;

use nsh_core::prelude::*;
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
use transport::Peer;

/// The native exports used by the desktop screens.
#[native_module("tian/native")]
fn native(registry: &mut Registry) {
    registry.module::<Service>().class::<Connection>();
}

/// Service connection configuration and Unix socket access.
#[module]
pub struct Service;

#[module]
impl Service {
    /// Explicit development paths. The client never creates service files.
    pub fn environment() -> Result<Value, String> {
        let directory = std::env::var("TIAN_AGENT_DATA_DIR")
            .map_err(|_| "Set TIAN_AGENT_DATA_DIR to a throwaway development directory")?;
        let data_dir = PathBuf::from(&directory);
        if !data_dir.is_absolute() {
            return Err("TIAN_AGENT_DATA_DIR must be absolute".into());
        }
        let socket = std::env::var("TIAN_AGENT_SOCKET_PATH")
            .unwrap_or_else(|_| data_dir.join("agent.sock").to_string_lossy().into_owned());
        transport::validate_path(&socket)?;
        if let Ok(home) = std::env::var("HOME") {
            for name in ["tian", "Tian Agent"] {
                let live = PathBuf::from(&home)
                    .join("Library/Application Support")
                    .join(name);
                if data_dir.starts_with(&live) || PathBuf::from(&socket).starts_with(&live) {
                    return Err("Use a throwaway development directory for the NSH client".into());
                }
            }
        }
        Ok(json!({ "dataDir": directory, "socketPath": socket }))
    }

    /// Opens the configured development socket and validates its handshake.
    pub fn connect() -> Result<Later<Connection>, String> {
        let config = Self::environment()?;
        let path = config["socketPath"].as_str().unwrap().to_owned();
        Ok(Later::new(async move {
            let peer = tokio::time::timeout(Duration::from_secs(10), Peer::connect(&path))
                .await
                .map_err(|_| "Service handshake timed out".to_owned())??;
            Ok::<_, String>(Connection { peer })
        }))
    }
}

/// A single service connection. Close it when the screen is disposed.
#[class]
pub struct Connection {
    peer: Peer,
}

#[class]
impl Connection {
    /// Reads the next decoded service result or event. EOF rejects the call.
    pub fn next(&self) -> Later<Value> {
        let peer = self.peer.clone();
        Later::new(async move { peer.next().await })
    }

    /// Sends one bounded service request or client-release message.
    pub fn send(&self, message: Value) -> Result<Later<()>, String> {
        let frame = transport::encode(&message)?;
        let peer = self.peer.clone();
        Ok(Later::new(async move { peer.send(frame).await }))
    }

    /// Interrupts reads and writes without stopping the resident service.
    pub fn close(&self) {
        self.peer.close();
    }
}
