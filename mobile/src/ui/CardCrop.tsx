import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Brackets } from './Brackets';
import { CARD_ASPECT, radius, usePalette } from './theme';

interface CardCropProps {
  uri: string | null;
  width: number;
}

/** A card picture at the card's aspect; an empty bracket frame when there is no picture. */
export function CardCrop({ uri, width }: CardCropProps) {
  const palette = usePalette();
  const box = { width, aspectRatio: CARD_ASPECT };
  if (!uri) {
    return (
      <View style={[box, styles.empty]}>
        <Brackets color={palette.brand} arm={Math.round(width / 4)} thickness={3} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      contentFit="cover"
      accessibilityIgnoresInvertColors
      style={[box, { borderRadius: radius.sm, backgroundColor: palette.surface2 }]}
    />
  );
}

const styles = StyleSheet.create({ empty: { justifyContent: 'center' } });
