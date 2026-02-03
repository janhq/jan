//! Message queue module for async processing

pub mod async_queue;

pub use async_queue::MessageQueue;
pub use async_queue::MessageQueueConsumer;