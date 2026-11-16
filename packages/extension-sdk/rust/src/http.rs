/// Guest-side helpers for the host-brokered HTTP v3 import.
///
/// This module intentionally contains no ambient network implementation.

pub const DEFAULT_READ_BYTES: u32 = 16 * 1024;
pub const DEFAULT_MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Header {
    pub name: String,
    pub value: String,
}

/// Mirrors `glixo:http/types@3.0.0`. This is a request value, not authority:
/// the host validates its URL, method, headers, endpoint handle and grants.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub url: String,
    pub method: String,
    pub headers: Vec<Header>,
    pub body: Option<Vec<u8>>,
    pub content_type: Option<String>,
    pub timeout_ms: Option<u32>,
    pub max_response_bytes: Option<u32>,
    pub accepted_status_min: Option<u16>,
    pub accepted_status_max: Option<u16>,
    pub endpoint_handle: Option<String>,
    /// Invocation-scoped secret slot name, never secret contents or a lease id.
    pub secret_handle: Option<String>,
    pub auth_header: Option<String>,
    pub auth_scheme: Option<String>,
}

pub trait Broker {
    fn start(&mut self, request: Request) -> Result<u32, String>;
    fn status(&mut self, handle: u32) -> Result<u16, String>;
    fn response_headers(&mut self, handle: u32) -> Result<Vec<Header>, String>;
    fn read(&mut self, handle: u32, max_bytes: u32) -> Result<Option<Vec<u8>>, String>;
    fn cancel(&mut self, handle: u32);
    fn drop_response(&mut self, handle: u32);
}

/// Pull-based, bounded NDJSON reader. It owns the tiny broker adapter value so
/// providers can keep it in their stream table between separate WIT calls.
pub struct NdjsonStream<B: Broker> {
    broker: B,
    handle: u32,
    pending: Vec<u8>,
    eof: bool,
    released: bool,
    max_line_bytes: usize,
}

impl<B: Broker> NdjsonStream<B> {
    pub fn open(mut broker: B, request: Request, max_line_bytes: usize) -> Result<Self, String> {
        let handle = broker.start(request)?;
        Ok(Self {
            broker,
            handle,
            pending: Vec::new(),
            eof: false,
            released: false,
            max_line_bytes: max_line_bytes.max(1),
        })
    }

    pub fn handle(&self) -> u32 { self.handle }

    pub fn status(&mut self) -> Result<u16, String> {
        self.broker.status(self.handle)
    }

    pub fn response_headers(&mut self) -> Result<Vec<Header>, String> {
        self.broker.response_headers(self.handle)
    }

    pub fn next_line(&mut self) -> Result<Option<Vec<u8>>, String> {
        loop {
            if let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
                if end > self.max_line_bytes { return Err("ndjson_line_too_large".into()); }
                let mut line: Vec<u8> = self.pending.drain(..=end).collect();
                line.pop();
                if line.last() == Some(&b'\r') { line.pop(); }
                return Ok(Some(line));
            }
            if self.pending.len() > self.max_line_bytes {
                return Err("ndjson_line_too_large".into());
            }
            if self.eof {
                if self.pending.is_empty() { return Ok(None); }
                let mut line = std::mem::take(&mut self.pending);
                if line.last() == Some(&b'\r') { line.pop(); }
                return Ok(Some(line));
            }
            match self.broker.read(self.handle, DEFAULT_READ_BYTES)? {
                Some(chunk) if !chunk.is_empty() => {
                    self.pending.extend_from_slice(&chunk);
                    if self.pending.len() > self.max_line_bytes && !self.pending.contains(&b'\n') {
                        return Err("ndjson_line_too_large".into());
                    }
                }
                Some(_) => continue,
                None => self.eof = true,
            }
        }
    }

    pub fn cancel(&mut self) {
        if !self.released {
            self.broker.cancel(self.handle);
            self.release();
        }
    }

    pub fn close(&mut self) { self.release(); }

    fn release(&mut self) {
        if !self.released {
            self.broker.drop_response(self.handle);
            self.released = true;
        }
    }
}

impl<B: Broker> Drop for NdjsonStream<B> {
    fn drop(&mut self) { self.release(); }
}
