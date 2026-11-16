import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CatalogCard } from '../core/types';
import type { ReviewCard } from '../state/session';
import { CandidateList } from './CandidateList';
import { CardCrop } from './CardCrop';
import { ConfirmedBody } from './ConfirmedBody';
import { errorText, pickCard, saveCard } from './reviewActions';
import { Message } from './Notice';
import { radius, space, usePalette } from './theme';

const CROP_WIDTH = 96;

export function ReviewBlock({ card }: { card: ReviewCard }) {
  const palette = usePalette();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = card.row.userConfirmed === true;

  const onPick = (chosen: CatalogCard): void => {
    setError(null);
    pickCard(card, chosen).catch((err: unknown) => {
      console.error('[review] pick failed:', errorText(err));
      setError('That pick could not be applied. Try again.');
    });
  };
  const onSave = (): void => {
    setSaving(true);
    setError(null);
    saveCard(card)
      .catch((err: unknown) => {
        console.error('[review] save failed:', errorText(err));
        setError('The card could not be saved to the library. Try again.');
      })
      .finally(() => setSaving(false));
  };

  return (
    <View style={[styles.block, { backgroundColor: palette.surface, borderColor: confirmed ? palette.ok : palette.border }]}>
      <View style={styles.row}>
        <CardCrop uri={card.cropUri} width={CROP_WIDTH} />
        <View style={styles.body}>
          {confirmed ? <ConfirmedBody card={card} saving={saving} onSave={onSave} /> : <CandidateList card={card} onPick={onPick} />}
        </View>
      </View>
      {error ? <Message tone="error" text={error} onDismiss={() => setError(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.md },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  body: { flex: 1 },
});
