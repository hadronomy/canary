use std::collections::BTreeMap;
use std::sync::Arc;

use tokio::sync::{Mutex, watch};

use crate::files::meta::BlobId;
use crate::files::upload::{UploadEventKind, UploadNotice, UploadSession};

#[derive(Clone, Default)]
pub struct UploadHub {
    slots: Arc<Mutex<BTreeMap<BlobId, watch::Sender<UploadNotice>>>>,
}

impl UploadHub {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn publish(&self, kind: UploadEventKind, session: UploadSession) {
        let notice = UploadNotice { kind, session: session.clone() };
        let mut slots = self.slots.lock().await;
        match slots.get(&session.id()) {
            Some(tx) => {
                let _ = tx.send(notice);
            }
            None => {
                let (tx, _) = watch::channel(notice);
                slots.insert(session.id(), tx);
            }
        }
    }

    pub async fn subscribe(&self, session: UploadSession) -> watch::Receiver<UploadNotice> {
        let id = session.id();
        let mut slots = self.slots.lock().await;
        match slots.get(&id) {
            Some(tx) => tx.subscribe(),
            None => {
                let (tx, rx) =
                    watch::channel(UploadNotice { kind: UploadEventKind::Snapshot, session });
                slots.insert(id, tx);
                rx
            }
        }
    }

    pub async fn drop_upload(&self, id: BlobId) {
        self.slots.lock().await.remove(&id);
    }
}
