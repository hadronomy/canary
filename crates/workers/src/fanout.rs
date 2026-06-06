//! Ordered fan-out/fan-in stream helpers.
//!
//! Workflow code often wants the same shape: discover work lazily, keep a
//! bounded number of operations active, and collect results in the original
//! discovery order. [`LookaheadExt::windowed_lookahead`] gives that pattern a
//! small stream API so callers can keep the workflow body focused on domain
//! steps.

use std::collections::VecDeque;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::task::{Context, Poll};

use futures::Stream;
use pin_project_lite::pin_project;

use crate::Lookahead;

/// Adds ordered, bounded lookahead to streams.
pub trait LookaheadExt: Stream + Sized {
    /// Maps stream items into futures while keeping at most `lookahead` futures in flight.
    ///
    /// Results are yielded in the same order as the source stream. Faster later
    /// futures may complete early, but they remain buffered until every older
    /// slot has completed.
    #[inline(always)]
    fn windowed_lookahead<'a, F, Fut, T, E>(
        self,
        lookahead: Lookahead,
        spawn: F,
    ) -> WindowedLookahead<'a, Self, F, Fut, T, E>
    where
        Self: 'a,
        F: FnMut(Self::Item) -> Fut + 'a,
        Fut: Future<Output = std::result::Result<T, E>> + 'a,
    {
        WindowedLookahead::new(self, lookahead, spawn)
    }
}

impl<S> LookaheadExt for S where S: Stream + Sized {}

pin_project! {
    /// Stream returned by [`LookaheadExt::windowed_lookahead`].
    pub struct WindowedLookahead<'a, S, F, Fut, T, E> {
        #[pin]
        upstream: S,
        spawn: F,
        limit: usize,
        buffer: VecDeque<Slot<'a, T, E>>,
        done: bool,
        failed: bool,
        _future: PhantomData<fn() -> Fut>,
    }
}

impl<'a, S, F, Fut, T, E> WindowedLookahead<'a, S, F, Fut, T, E>
where
    S: Stream + 'a,
    F: FnMut(S::Item) -> Fut + 'a,
    Fut: Future<Output = std::result::Result<T, E>> + 'a,
{
    /// Creates a stream that drives a bounded ordered lookahead window.
    pub fn new(upstream: S, lookahead: Lookahead, spawn: F) -> Self {
        let limit = lookahead.get();
        Self {
            upstream,
            spawn,
            limit,
            buffer: VecDeque::with_capacity(limit),
            done: false,
            failed: false,
            _future: PhantomData,
        }
    }
}

impl<'a, S, F, Fut, T, E> Stream for WindowedLookahead<'a, S, F, Fut, T, E>
where
    S: Stream + 'a,
    F: FnMut(S::Item) -> Fut + 'a,
    Fut: Future<Output = std::result::Result<T, E>> + 'a,
{
    type Item = std::result::Result<T, E>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let mut this = self.project();
        if *this.failed {
            return Poll::Ready(None);
        }

        while !*this.done && this.buffer.len() < *this.limit {
            match this.upstream.as_mut().poll_next(cx) {
                Poll::Ready(Some(item)) => {
                    this.buffer.push_back(Slot::InFlight(Box::pin((this.spawn)(item))));
                }
                Poll::Ready(None) => {
                    *this.done = true;
                    break;
                }
                Poll::Pending => break,
            }
        }

        for slot in this.buffer.iter_mut() {
            let Slot::InFlight(fut) = slot else {
                continue;
            };
            match fut.as_mut().poll(cx) {
                Poll::Ready(Ok(value)) => *slot = Slot::Ready(value),
                Poll::Ready(Err(err)) => {
                    *this.failed = true;
                    this.buffer.clear();
                    return Poll::Ready(Some(Err(err)));
                }
                Poll::Pending => {}
            }
        }

        if matches!(this.buffer.front(), Some(Slot::Ready(_))) {
            let Some(Slot::Ready(value)) = this.buffer.pop_front() else {
                unreachable!("front was checked as ready");
            };
            return Poll::Ready(Some(Ok(value)));
        }

        if *this.done && this.buffer.is_empty() {
            return Poll::Ready(None);
        }

        Poll::Pending
    }
}

enum Slot<'a, T, E> {
    InFlight(Pin<Box<dyn Future<Output = std::result::Result<T, E>> + 'a>>),
    Ready(T),
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::pin::Pin;
    use std::rc::Rc;
    use std::task::{Context, Poll};

    use futures::future::ready;
    use futures::stream;
    use futures_util::{StreamExt, TryStreamExt};

    use super::*;

    #[test]
    fn lookahead_does_not_overfill() {
        futures::executor::block_on(async {
            let seen = Rc::new(RefCell::new(Vec::new()));
            let trace = Rc::clone(&seen);
            let mut stream =
                stream::iter(0..5).windowed_lookahead(Lookahead::new(2).unwrap(), move |item| {
                    trace.borrow_mut().push(item);
                    ready(Ok::<_, ()>(item))
                });

            assert_eq!(stream.next().await, Some(Ok(0)));
            assert_eq!(&*seen.borrow(), &[0, 1]);
            assert_eq!(stream.next().await, Some(Ok(1)));
            assert_eq!(&*seen.borrow(), &[0, 1, 2]);
        });
    }

    #[test]
    fn lookahead_preserves_source_order() {
        futures::executor::block_on(async {
            let values = stream::iter([(2, "first"), (0, "second"), (0, "third")])
                .windowed_lookahead(Lookahead::new(3).unwrap(), |(polls, value)| Delay {
                    polls,
                    value,
                })
                .try_collect::<Vec<_>>()
                .await
                .unwrap();

            assert_eq!(values, ["first", "second", "third"]);
        });
    }

    struct Delay {
        polls: usize,
        value: &'static str,
    }

    impl Future for Delay {
        type Output = std::result::Result<&'static str, ()>;

        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
            if self.polls == 0 {
                return Poll::Ready(Ok(self.value));
            }
            self.polls -= 1;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}
