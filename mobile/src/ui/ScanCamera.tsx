// The live camera: framing guide, torch, shutter and the photo-library button.

import { CameraView } from 'expo-camera';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brackets } from './Brackets';
import { Button } from './Button';
import type { Photo } from './useScan';
import { CARD_ASPECT, space } from './theme';

interface ScanCameraProps {
  busy: boolean;
  onPhoto: (photo: Photo) => void;
  onChoose: () => void;
  onError: (text: string) => void;
}

const BRAND_ON_DARK = '#A795FF';
const INK_ON_LIGHT = '#17152B';
const SHUTTER = 76;

export function ScanCamera({ busy, onPhoto, onChoose, onError }: ScanCameraProps) {
  const camera = useRef<CameraView>(null);
  const [torch, setTorch] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const guideWidth = Math.min(width * 0.78, height * 0.5 * CARD_ASPECT);

  const capture = async (): Promise<void> => {
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 1, base64: false });
      if (picture) onPhoto({ uri: picture.uri, width: picture.width, height: picture.height });
    } catch (err) {
      console.error('[scan] capture failed:', err instanceof Error ? err.message : err);
      onError('The photo could not be taken. Try again.');
    }
  };

  return (
    <View style={styles.fill}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Button label={torch ? 'Torch on' : 'Torch off'} onPress={() => setTorch((on) => !on)} style={styles.overlayButton} labelColor={INK_ON_LIGHT} />
      </View>
      <View style={styles.center} pointerEvents="none">
        <View style={{ width: guideWidth, aspectRatio: CARD_ASPECT }}>
          <Brackets color={BRAND_ON_DARK} />
        </View>
        <Text style={styles.hint}>Fit one card, or a whole spread, in the frame</Text>
      </View>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.side}>
          <Button label="Choose a photo" onPress={onChoose} disabled={busy} style={styles.overlayButton} labelColor={INK_ON_LIGHT} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan"
          disabled={busy}
          onPress={() => void capture()}
          style={[styles.shutter, { opacity: busy ? 0.4 : 1 }]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <View style={styles.side} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, right: 0, paddingRight: space.lg },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  hint: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: space.xl },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg },
  side: { flex: 1, alignItems: 'flex-start' },
  overlayButton: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: 'rgba(255,255,255,0.92)' },
  shutter: { width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: SHUTTER - 20, height: SHUTTER - 20, borderRadius: (SHUTTER - 20) / 2, backgroundColor: '#FFFFFF' },
});
