import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatUsd } from '../../src/core/ext';
import { priceRow } from '../../src/core/pricing';
import type { SavedCard } from '../../src/core/types';
import { libraryTotal, searchLibrary } from '../../src/data/library';
import { library } from '../../src/device/files';
import { LibraryRow } from '../../src/ui/LibraryRow';
import { Message } from '../../src/ui/Notice';
import { radius, space, usePalette } from '../../src/ui/theme';

export default function LibraryScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setCards(await library.all());
    } catch (err) {
      console.error('[library] load failed:', err instanceof Error ? err.message : err);
      setMessage('The library could not be opened.');
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const refreshPrices = async (): Promise<void> => {
    const all = await library.all();
    let failed = 0;
    setMessage(null);
    for (const [index, card] of all.entries()) {
      setProgress(`Updating prices… ${index + 1} of ${all.length}`);
      try {
        const priced = await priceRow({ ...card.row, pricing: true });
        if (priced.priceError) failed += 1;
        else await library.update(card.key, { row: priced });
      } catch (err) {
        console.error('[library] refresh failed:', err instanceof Error ? err.message : err);
        failed += 1;
      }
    }
    setProgress(null);
    if (failed > 0) setMessage(`${failed} ${failed === 1 ? 'card' : 'cards'} could not be updated. Their last price is kept.`);
    await load();
  };

  const shown = searchLibrary(cards, query);
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg, paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: palette.ink }]}>Library</Text>
        <Text style={[styles.summary, { color: palette.ink2 }]}>
          {shown.length} {shown.length === 1 ? 'card' : 'cards'} · Total {formatUsd(libraryTotal(shown))} Near Mint
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your cards"
          placeholderTextColor={palette.ink3}
          accessibilityLabel="Search your cards"
          autoCorrect={false}
          style={[styles.input, { color: palette.ink, borderColor: palette.borderStrong, backgroundColor: palette.surface }]}
        />
        {progress ? <Text style={[styles.summary, { color: palette.ask }]}>{progress}</Text> : null}
        {message ? <Message text={message} tone="error" onDismiss={() => setMessage(null)} /> : null}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(card) => card.key}
        renderItem={({ item }) => <LibraryRow card={item} />}
        contentContainerStyle={[styles.list, { paddingBottom: space.xl }]}
        refreshControl={<RefreshControl refreshing={progress !== null} onRefresh={() => void refreshPrices()} />}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: palette.ink2 }]}>
            {cards.length === 0 ? 'No cards yet. Scan a card to add it.' : 'No saved card matches that search.'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm },
  title: { fontSize: 28, fontWeight: '700' },
  summary: { fontSize: 14, fontWeight: '600' },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  list: { paddingHorizontal: space.lg, gap: space.sm },
  empty: { fontSize: 15, paddingVertical: space.xl },
});
