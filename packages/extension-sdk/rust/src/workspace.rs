pub trait Workspace {
    fn search(&mut self, handle: &str, query: &str, limit: u32) -> Result<String, String>;
    fn read(&mut self, handle: &str, path: &str, max_bytes: u32) -> Result<String, String>;
}
