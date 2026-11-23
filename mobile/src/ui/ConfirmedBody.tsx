// The confirmed half of a review block: the name, the price, the printing choices, change and save.

import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { updateReviewCard, type ReviewCard } from '../state/session';
import { Button } from './Button';
import { PriceArea } from './PriceArea';
import { Tag } from './Tag';
import { changeCard, canSave, retryPrice } from './reviewActions';
import { space, usePalette } from './theme';

interface ConfirmedBodyProps {
  card: ReviewCard;
  saving: boolean;
  onSave: () => void;
}

export function ConfirmedBody({ card, saving, onSave }: ConfirmedBodyProps) {
  const palette = usePalette();
  const identity = card.row.identity;
  const detail = [identity?.set, identity?.number].filter(Boolean).join(' · ');
  return (
    <View style={styles.wrap}>
      <Tag text="Confirmed" tone="ok" />
      <Text style={[styles.name, { color: palette.ink }]}>{identity?.name ?? 'Unnamed card'}</Text>
      {detail ? <Text style={[styles.detail, { color: palette.ink2 }]}>{detail}</Text> : null}
      <PriceArea
        row={card.row}
        printing={card.printing}
        onPrinting={(printing) => updateReviewCard(card.id, { printing })}
        onRetry={() => void retryPrice(card)}
      />
      {card.savedKey ? (
        <View style={styles.actions}>
          <Text style={[styles.saved, { color: palette.ok }]}>Saved</Text>
          <Button label="View" onPress={() => router.push(`/card/${encodeURIComponent(card.savedKey ?? '')}`)} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Change card" onPress={() => changeCard(card)} />
          <Button label="Save to library" variant="primary" busy={saving} disabled={!canSave(card)} onPress={onSave} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, alignItems: 'flex-start' },
  name: { fontSize: 18, fontWeight: '700' },
  detail: { fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  saved: { fontSize: 15, fontWeight: '700' },
});
