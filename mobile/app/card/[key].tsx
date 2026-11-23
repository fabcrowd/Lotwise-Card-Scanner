import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { thumbUrl } from '../../src/core/ext';
import { priceRow } from '../../src/core/pricing';
import type { SavedCard } from '../../src/core/types';
import { dropCrop, library } from '../../src/device/files';
import { Button } from '../../src/ui/Button';
import { CardCrop } from '../../src/ui/CardCrop';
import { detailsLine } from '../../src/ui/cardDetails';
import { FullNotice, Message } from '../../src/ui/Notice';
import { PriceArea } from '../../src/ui/PriceArea';
import { CARD_ASPECT, radius, space, usePalette } from '../../src/ui/theme';

const IMAGE_WIDTH = 140;

export default function CardScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [card, setCard] = useState<SavedCard | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    library.byKey(key).then(setCard).catch((err: unknown) => {
      console.error('[card] load failed:', err instanceof Error ? err.message : err);
      setCard(null);
    });
  }, [key]);

  if (card === undefined) return <View style={{ flex: 1, backgroundColor: palette.bg }} />;
  if (card === null) {
    return <FullNotice title="This card is no longer in the library." body="" actions={[{ label: 'Back', onPress: () => router.back() }]} />;
  }

  const run = async (work: () => Promise<void>, failure: string): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      console.error('[card] action failed:', err instanceof Error ? err.message : err);
      setError(failure);
    }
  };
  const pick = (printing: string): Promise<void> =>
    run(async () => setCard((await library.update(card.key, { printing })) ?? card), 'The printing could not be saved.');
  const refresh = (): Promise<void> =>
    run(async () => {
      const priced = await priceRow({ ...card.row, pricing: true });
      if (priced.priceError) throw new Error('no price');
      setCard((await library.update(card.key, { row: priced })) ?? card);
    }, 'No price found. The last price is kept. Try again later.');
  const copy = (): Promise<void> =>
    run(async () => {
      await Clipboard.setStringAsync(detailsLine(card));
      setMessage('Copied.');
    }, 'The details could not be copied.');
  const remove = (): void => {
    Alert.alert('Delete this card?', 'It is removed from your library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void run(async () => {
          dropCrop(card.cropUri);
          await library.remove(card.key);
          router.back();
        }, 'The card could not be deleted.'),
      },
    ]);
  };

  const identity = card.row.identity;
  const art = thumbUrl(identity);
  return (
    <ScrollView style={{ backgroundColor: palette.bg }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.pictures}>
        <CardCrop uri={card.cropUri} width={IMAGE_WIDTH} />
        {art ? (
          <Image source={{ uri: art }} contentFit="cover" style={styles.art} accessibilityIgnoresInvertColors accessibilityLabel="Catalog picture" />
        ) : null}
      </View>
      <Text style={[styles.name, { color: palette.ink }]}>{identity?.name ?? 'Unnamed card'}</Text>
      <Text style={[styles.detail, { color: palette.ink2 }]}>Set: {identity?.set ?? 'Unknown'}</Text>
      <Text style={[styles.detail, { color: palette.ink2 }]}>Number: {identity?.number ?? 'Unknown'}</Text>
      <PriceArea row={card.row} printing={card.printing} onPrinting={(p) => void pick(p)} onRetry={() => void refresh()} />
      <Text style={[styles.detail, { color: palette.ink3 }]}>Scanned {new Date(card.savedAt).toLocaleDateString()}</Text>
      {message ? <Message text={message} /> : null}
      {error ? <Message text={error} tone="error" onDismiss={() => setError(null)} /> : null}
      <View style={styles.buttons}>
        <Button label="Copy details" onPress={() => void copy()} />
        <Button label="Refresh price" onPress={() => void refresh()} />
        <Button label="Delete" variant="danger" onPress={remove} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.sm },
  pictures: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  art: { width: IMAGE_WIDTH, aspectRatio: CARD_ASPECT, borderRadius: radius.sm },
  name: { fontSize: 24, fontWeight: '700' },
  detail: { fontSize: 14 },
  buttons: { gap: space.sm, marginTop: space.md },
});
