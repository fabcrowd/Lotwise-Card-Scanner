import { useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { downloadSizeText, missingAssets, modelsReady } from '../../src/core/assets';
import { deviceModelFiles } from '../../src/device/files';
import { FullNotice, Message } from '../../src/ui/Notice';
import { ScanCamera } from '../../src/ui/ScanCamera';
import { space } from '../../src/ui/theme';
import { useScan } from '../../src/ui/useScan';

const toSettings = (): void => router.navigate('/settings');

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const scan = useScan();
  const { recheckModels } = scan;
  const [ready, setReady] = useState(() => modelsReady(deviceModelFiles));

  useFocusEffect(
    useCallback(() => {
      const now = modelsReady(deviceModelFiles);
      setReady(now);
      recheckModels(now);
    }, [recheckModels]),
  );

  if (!ready || scan.modelsMissing) {
    const size = downloadSizeText(missingAssets(deviceModelFiles));
    return (
      <FullNotice
        title="Download the card models first"
        body={`Scanning runs on this device, so the card models (${size}) must be downloaded once.`}
        actions={[{ label: 'Go to Settings', onPress: toSettings, primary: true }]}
      />
    );
  }

  const granted = permission?.granted === true;
  if (!granted) {
    const blocked = permission !== null && !permission.canAskAgain;
    return (
      <View style={styles.fill}>
        <FullNotice
          title={blocked ? 'Camera access is off' : 'Allow the camera'}
          body={
            blocked
              ? 'Turn the camera on for this app in your phone settings to scan live. You can still choose a photo.'
              : 'The camera takes the photo of the card you want to scan. Photos stay on this device. You can also choose a photo.'
          }
          actions={[
            blocked
              ? { label: 'Open settings', onPress: () => void Linking.openSettings(), primary: true }
              : { label: 'Allow camera', onPress: () => void requestPermission(), primary: true },
            { label: 'Choose a photo', onPress: () => void scan.choosePhoto() },
          ]}
        />
        <Overlays scan={scan} top={insets.top} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {focused ? (
        <ScanCamera busy={scan.busy} onPhoto={(photo) => void scan.scan(photo)} onChoose={() => void scan.choosePhoto()} onError={scan.report} />
      ) : null}
      <Overlays scan={scan} top={insets.top} />
    </View>
  );
}

function Overlays({ scan, top }: { scan: ReturnType<typeof useScan>; top: number }) {
  return (
    <>
      {scan.message ? (
        <View style={[styles.message, { top: top + space.sm }]}>
          <Message text={scan.message} onDismiss={scan.dismiss} tone={scan.message.startsWith('No card') ? 'info' : 'error'} />
        </View>
      ) : null}
      {scan.busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.busyText}>Finding cards…</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  message: { position: 'absolute', left: space.lg, right: space.lg },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: space.md },
  busyText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
