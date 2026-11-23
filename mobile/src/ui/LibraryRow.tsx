import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsd, listPrintings, thumbUrl } from '../core/ext';
import type { SavedCard } from '../core/types';
import { savedPrice } from '../data/library';
import { CARD_ASPECT, radius, space, usePalette } from './theme';

export function priceText(card: SavedCard): string {
  const price = savedPrice(card);
  if (price != null) return formatUsd(price);
  if (card.row.priceError) return 'No price';
  return listPrintings(card.row.price_grid).length > 1 ? 'Pick a printing' : 'No price';
}

export function LibraryRow({ card }: { card: SavedCard }) {
  const palette = usePalette();
  const identity = card.row.identity;
  const art = card.cropUri ?? thumbUrl(identity);
  const detail = [identity?.set, identity?.number].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${identity?.name ?? 'Card'}, ${priceText(card)}`}
      onPress={() => router.push(`/card/${encodeURIComponent(card.key)}`)}
      style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      {art ? (
        <Image source={{ uri: art }} contentFit="cover" style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, { borderWidth: 1, borderColor: palette.border }]} />
      )}
      <View style={styles.text}>
        <Text style={[styles.name, { color: palette.ink }]} numberOfLines={2}>{identity?.name ?? 'Unnamed card'}</Text>
        {detail ? <Text style={[styles.detail, { color: palette.ink2 }]}>{detail}</Text> : null}
      </View>
      <Text style={[styles.price, { color: palette.ink }]}>{priceText(card)}</Text>
    </Pressable>
  );
}

const THUMB_HEIGHT = 60;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, minHeight: 44 },
  thumb: { width: THUMB_HEIGHT * CARD_ASPECT, height: THUMB_HEIGHT, borderRadius: radius.sm },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 13 },
  price: { fontSize: 15, fontWeight: '700' },
});
