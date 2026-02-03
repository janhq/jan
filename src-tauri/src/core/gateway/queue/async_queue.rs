use tokio::sync::mpsc;

use super::super::types::GatewayMessage;

#[derive(Debug)]
pub struct MessageQueue {
    sender: mpsc::Sender<GatewayMessage>,
    capacity: usize,
    current_size: std::sync::atomic::AtomicUsize,
    receiver: Option<mpsc::Receiver<GatewayMessage>>,
}

impl MessageQueue {
    pub fn new(capacity: usize) -> Self {
        let (sender, receiver) = mpsc::channel(capacity);

        Self {
            sender,
            capacity,
            current_size: std::sync::atomic::AtomicUsize::new(0),
            receiver: Some(receiver),
        }
    }

    pub async fn send(
        &self,
        message: GatewayMessage,
    ) -> Result<(), tokio::sync::mpsc::error::SendError<GatewayMessage>> {
        self.current_size.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        let result = self.sender.send(message).await;

        if result.is_err() {
            self.current_size.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        }

        result
    }

    pub fn try_send(
        &self,
        message: GatewayMessage,
    ) -> Result<(), tokio::sync::mpsc::error::TrySendError<GatewayMessage>> {
        let current = self.current_size.load(std::sync::atomic::Ordering::SeqCst);
        if current >= self.capacity {
            return Err(tokio::sync::mpsc::error::TrySendError::Full(message));
        }

        match self.sender.try_send(message) {
            Ok(()) => {
                self.current_size.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            }
            Err(e) => {
                if matches!(e, tokio::sync::mpsc::error::TrySendError::Full(_)) {
                    self.current_size.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                }
                Err(e)
            }
        }
    }

    pub fn len(&self) -> usize {
        self.current_size.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn is_full(&self) -> bool {
        self.len() >= self.capacity
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn take_receiver(&mut self) -> Option<mpsc::Receiver<GatewayMessage>> {
        self.receiver.take()
    }
}

#[derive(Debug)]
pub struct MessageQueueConsumer {
    receiver: mpsc::Receiver<GatewayMessage>,
}

impl MessageQueueConsumer {
    pub fn new(capacity: usize) -> (Self, MessageQueue) {
        let (sender, receiver) = mpsc::channel(capacity);

        let queue = MessageQueue {
            sender,
            capacity,
            current_size: std::sync::atomic::AtomicUsize::new(0),
            receiver: None,
        };

        let consumer = Self {
            receiver,
        };

        (consumer, queue)
    }

    pub async fn recv(&mut self) -> Option<GatewayMessage> {
        self.receiver.recv().await
    }

    pub fn from_queue(queue: &mut MessageQueue) -> Option<Self> {
        queue.take_receiver().map(|receiver| Self {
            receiver,
        })
    }
}

impl Clone for MessageQueue {
    fn clone(&self) -> Self {
        panic!("MessageQueue cannot be cloned. Use MessageQueueConsumer.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_send_and_receive() {
        let (mut consumer, queue) = MessageQueueConsumer::new(10);

        let message = GatewayMessage::new(
            crate::core::gateway::types::Platform::Discord,
            "user_1".to_string(),
            "channel_1".to_string(),
            "Test message".to_string(),
        );

        queue.send(message).await.unwrap();
        let received = consumer.recv().await;
        assert!(received.is_some());
    }

    #[tokio::test]
    async fn test_queue_len() {
        let (_, queue) = MessageQueueConsumer::new(5);

        assert_eq!(queue.len(), 0);

        for i in 0..3 {
            let message = GatewayMessage::new(
                crate::core::gateway::types::Platform::Discord,
                format!("user_{}", i),
                "channel_1".to_string(),
                format!("Message {}", i),
            );
            queue.send(message).await.unwrap();
        }

        assert_eq!(queue.len(), 3);
    }

    #[test]
    fn test_is_full() {
        let (_, queue) = MessageQueueConsumer::new(2);
        assert!(!queue.is_full());
    }
}