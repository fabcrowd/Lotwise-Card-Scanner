import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { candidateView } from '../core/ext';
import type { CatalogCard, ScanRow } from '../core/types';
import { Tag } from './Tag';
import { CARD_ASPECT, radius, space, usePalette } from './theme';

interface CandidateRowProps {
  row: ScanRow;
  candidate: CatalogCard;
  best: boolean;
  onPick: (card: CatalogCard) => void;
}

/** One card the user can tap to say "this is it". */
export function CandidateRow({ row, candidate, best, onPick }: CandidateRowProps) {
  const palette = usePalette();
  const view = candidateView(row, candidate, { best });
  const detail = [view.set, view.number].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.label}
      onPress={() => onPick(candidate)}
      style={[styles.row, { backgroundColor: palette.askTint, borderColor: palette.ask }]}
    >
      {view.art ? (
        <Image source={{ uri: view.art }} contentFit="cover" style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, { borderWidth: 1, borderColor: palette.border }]} />
      )}
      <View style={styles.text}>
        <Text style={[styles.name, { color: palette.ink }]} numberOfLines={2}>{view.name}</Text>
        {detail ? <Text style={[styles.detail, { color: palette.ink2 }]}>{detail}</Text> : null}
        <View style={styles.tags}>
          {view.agrees ? <Tag text="Name matches the photo" /> : null}
          {best && row.pictureConfirmed ? <Tag text="Strong match" tone="ok" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const THUMB_HEIGHT = 56;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, minHeight: 44 },
  thumb: { width: THUMB_HEIGHT * CARD_ASPECT, height: THUMB_HEIGHT, borderRadius: radius.sm },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 13 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
});
