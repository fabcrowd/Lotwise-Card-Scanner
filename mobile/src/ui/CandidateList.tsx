// The "Which card is this?" half of a review block: the scanner's candidates, a search, and a way out.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { findCards } from '../core/ext';
import type { CatalogCard } from '../core/types';
import { loadEngine } from '../device/engine';
import { removeReviewCard, type ReviewCard } from '../state/session';
import { Button } from './Button';
import { CandidateRow } from './CandidateRow';
import { Message } from './Notice';
import { radius, space, usePalette } from './theme';

const MIN_QUERY = 2;
const SEARCH_LIMIT = 20;

function useSearch(query: string): { results: CatalogCard[]; error: string | null } {
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      setResults([]);
      return;
    }
    let cancelled = false;
    loadEngine()
      .then(({ meta }) => {
        if (cancelled) return;
        setError(null);
        setResults(findCards(meta, text, { limit: SEARCH_LIMIT }));
      })
      .catch((err: unknown) => {
        console.error('[review] search failed:', err instanceof Error ? err.message : err);
        if (!cancelled) setError('Search is not available right now. Check that the card models are downloaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [query]);
  return { results, error };
}

interface CandidateListProps {
  card: ReviewCard;
  onPick: (card: CatalogCard) => void;
}

export function CandidateList({ card, onPick }: CandidateListProps) {
  const palette = usePalette();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const { results, error } = useSearch(query);
  const { row } = card;
  const candidates = row.candidates ?? [];
  const showResults = searching && query.trim().length >= MIN_QUERY;
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: palette.ask }]}>Which card is this?</Text>
      {row.titleContradicts ? (
        <Text style={[styles.note, { color: palette.ink2 }]}>The card&apos;s title reads &quot;{row.titleContradicts}&quot;.</Text>
      ) : null}
      {row.numberRead ? <Text style={[styles.note, { color: palette.ink2 }]}>Number on the card: {row.numberRead}</Text> : null}
      {candidates.map((candidate, index) => (
        <CandidateRow key={candidate.id} row={row} candidate={candidate} best={index === 0} onPick={onPick} />
      ))}
      {searching ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          placeholder="Card name or number"
          placeholderTextColor={palette.ink3}
          accessibilityLabel="Search for the card"
          style={[styles.input, { color: palette.ink, borderColor: palette.borderStrong, backgroundColor: palette.surface }]}
        />
      ) : (
        <Button label="Search for the card" onPress={() => setSearching(true)} />
      )}
      {error ? <Message tone="error" text={error} /> : null}
      {showResults && !error && results.length === 0 ? <Text style={[styles.note, { color: palette.ink2 }]}>No cards found.</Text> : null}
      {showResults && !error
        ? results.map((found) => <CandidateRow key={found.id} row={row} candidate={found} best={false} onPick={onPick} />)
        : null}
      <Button label="Not a card / remove" variant="danger" onPress={() => removeReviewCard(card.id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  title: { fontSize: 17, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
});
