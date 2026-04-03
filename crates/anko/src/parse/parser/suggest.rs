//! Suggestion infrastructure.
//!
//! Suggestions are intentionally kept behind a small trait so the ranking
//! strategy can be replaced without disturbing parser logic or diagnostic
//! construction.
//!
//! The default implementation uses Levenshtein edit distance over Unicode
//! scalar values.

use crate::schema::CommandRef;

/// Strategy for producing human-friendly suggestions for mistyped input.
pub(super) trait SuggestionProvider {
    /// Suggest long option names for a command.
    fn suggest_longs(&self, command: CommandRef<'_>, input: &str) -> Vec<String>;

    /// Suggest subcommand names for a command.
    fn suggest_subcommands(&self, command: CommandRef<'_>, input: &str) -> Vec<String>;
}

/// Levenshtein-based suggestion strategy.
///
/// This implementation is deliberately simple and deterministic:
///
/// - candidates are collected from the schema,
/// - each candidate is scored exactly once,
/// - only candidates within `max_distance` are retained,
/// - and the best `limit` suggestions are returned in stable semantic order.
#[derive(Debug, Clone, Copy)]
pub(super) struct LevenshteinSuggester {
    limit: usize,
    max_distance: usize,
}

impl LevenshteinSuggester {
    /// Construct a new suggester with explicit limits.
    pub(super) const fn new(limit: usize, max_distance: usize) -> Self {
        Self { limit, max_distance }
    }
}

impl Default for LevenshteinSuggester {
    fn default() -> Self {
        Self::new(3, 3)
    }
}

impl SuggestionProvider for LevenshteinSuggester {
    fn suggest_longs(&self, command: CommandRef<'_>, input: &str) -> Vec<String> {
        let mut candidates = command
            .args()
            .flat_map(|arg| {
                arg.long()
                    .into_iter()
                    .map(ToOwned::to_owned)
                    .chain(arg.aliases().map(|alias| alias.name().to_owned()))
            })
            .collect::<Vec<_>>();

        candidates.sort_unstable();
        candidates.dedup();

        nearest_candidates(input, candidates, self.max_distance, self.limit)
    }

    fn suggest_subcommands(&self, command: CommandRef<'_>, input: &str) -> Vec<String> {
        let mut candidates = command
            .subcommands()
            .flat_map(|sub| {
                std::iter::once(sub.name().to_owned()).chain(sub.aliases().map(ToOwned::to_owned))
            })
            .collect::<Vec<_>>();

        candidates.sort_unstable();
        candidates.dedup();

        nearest_candidates(input, candidates, self.max_distance, self.limit)
    }
}

/// Rank candidate strings by edit distance and keep the best few.
fn nearest_candidates(
    input: &str,
    candidates: Vec<String>,
    max_distance: usize,
    limit: usize,
) -> Vec<String> {
    let mut ranked = candidates
        .into_iter()
        .map(|candidate| (edit_distance(input, &candidate), candidate))
        .filter(|(score, _)| *score <= max_distance)
        .collect::<Vec<_>>();

    ranked.sort_unstable_by(|(a_score, a), (b_score, b)| a_score.cmp(b_score).then(a.cmp(b)));

    ranked.into_iter().take(limit).map(|(_, candidate)| candidate).collect()
}

/// Compute the Levenshtein edit distance between two strings.
///
/// The comparison is performed over Unicode scalar values (`char`s), not raw
/// UTF-8 bytes, so edits are measured in human-facing characters.
///
/// Complexity:
///
/// - time: `O(a.len() * b.len())` in characters
/// - space: `O(min(a.len(), b.len()))` in characters
fn edit_distance(a: &str, b: &str) -> usize {
    if a == b {
        return 0;
    }

    if a.is_empty() {
        return b.chars().count();
    }

    if b.is_empty() {
        return a.chars().count();
    }

    let a_len = a.chars().count();
    let b_len = b.chars().count();
    let (longer, shorter) = if a_len < b_len { (b, a) } else { (a, b) };

    let shorter = shorter.chars().collect::<Vec<_>>();
    let mut previous = (0..=shorter.len()).collect::<Vec<_>>();
    let mut current = vec![0usize; shorter.len() + 1];

    for (i, longer_ch) in longer.chars().enumerate() {
        current[0] = i + 1;

        for (j, shorter_ch) in shorter.iter().enumerate() {
            let substitution_cost = usize::from(longer_ch != *shorter_ch);

            current[j + 1] =
                (previous[j + 1] + 1).min(current[j] + 1).min(previous[j] + substitution_cost);
        }

        std::mem::swap(&mut previous, &mut current);
    }

    previous[shorter.len()]
}
