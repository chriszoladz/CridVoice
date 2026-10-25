//! Exclusive writes to one model folder, without blocking other downloads.
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub struct ModelOperations {
    active: Arc<Mutex<HashSet<String>>>,
}

pub struct ModelLease {
    active: Arc<Mutex<HashSet<String>>>,
    id: String,
}

impl ModelOperations {
    pub fn acquire(&self, id: &str) -> Result<ModelLease, String> {
        if !self.active.lock().unwrap().insert(id.to_string()) {
            return Err(
                "Another operation is already modifying this model. Wait for it to finish.".into(),
            );
        }
        Ok(ModelLease {
            active: self.active.clone(),
            id: id.to_string(),
        })
    }
}

impl Drop for ModelLease {
    fn drop(&mut self) {
        self.active.lock().unwrap().remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removal_reservation_blocks_same_model_download_but_not_other_models() {
        let operations = ModelOperations::default();
        let removal = operations.acquire("speech").unwrap();
        assert!(operations.acquire("speech").is_err());
        let other_download = operations.acquire("cleanup").unwrap();
        drop(removal);
        assert!(operations.acquire("speech").is_ok());
        drop(other_download);
    }

    #[tokio::test]
    async fn cancellation_drops_reservation_so_a_retry_can_start() {
        let operations = Arc::new(ModelOperations::default());
        let worker_operations = operations.clone();
        let (ready, started) = tokio::sync::oneshot::channel();
        let worker = tokio::spawn(async move {
            let _lease = worker_operations.acquire("speech").unwrap();
            ready.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        started.await.unwrap();
        assert!(operations.acquire("speech").is_err());
        worker.abort();
        let _ = worker.await;
        assert!(operations.acquire("speech").is_ok());
    }
}
