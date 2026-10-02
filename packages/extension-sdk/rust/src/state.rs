pub trait ScopedState {
    fn get(&mut self, key: &str) -> Result<Option<String>, String>;
    fn set(&mut self, key: &str, value: &str) -> Result<(), String>;
    fn list(&mut self, prefix: &str) -> Result<Vec<String>, String>;
    fn delete(&mut self, key: &str) -> Result<bool, String>;
}
