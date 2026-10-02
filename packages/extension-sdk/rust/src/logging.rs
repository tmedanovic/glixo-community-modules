pub trait Logger {
    fn log(&mut self, level: &str, message: &str) -> Result<(), String>;
}
