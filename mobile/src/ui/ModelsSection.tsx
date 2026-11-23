import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  type DownloadProgress, downloadModels, downloadOptionalModels, downloadSizeText, hasAsset, missingAssets, modelsReady,
  optionalAssets, optionalFailureNote, requiredAssets, textReadingReady,
} from '../core/assets';
import { resetEngine } from '../device/engine';
import { deviceModelFiles } from '../device/files';
import { Button } from './Button';
import { Message } from './Notice';
import { Note, SettingsSection } from './SettingsSection';
import { space, usePalette } from './theme';

const MB = 1_000_000;
const mb = (bytes: number): string => (bytes / MB).toFixed(1);

function progressText(p: DownloadProgress): string {
  return `File ${p.fileIndex + 1} of ${p.totalFiles} · ${mb(p.bytesLoaded)} of ${mb(p.bytesTotal)} MB`;
}

function ProgressBar({ fraction }: { fraction: number }) {
  const palette = usePalette();
  return (
    <View style={[styles.track, { backgroundColor: palette.surface2, borderColor: palette.border }]}>
      <View style={[styles.fill, { backgroundColor: palette.brand, width: `${Math.round(Math.min(1, fraction) * 100)}%` }]} />
    </View>
  );
}

/** Re-render key: the file list is read from disk on every render, so bump this after a download. */
export function ModelsSection({ onChanged }: { onChanged: () => void }) {
  const palette = usePalette();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ready = modelsReady(deviceModelFiles);
  const missing = missingAssets(deviceModelFiles);
  const textOn = textReadingReady(deviceModelFiles);

  const download = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setNote(null);
    try {
      await downloadModels(deviceModelFiles, setProgress);
      const failed = await downloadOptionalModels(deviceModelFiles);
      setNote(optionalFailureNote(failed));
      resetEngine();
    } catch (err) {
      console.error('[settings] model download failed:', err instanceof Error ? err.message : err);
      setError(err instanceof Error ? err.message : 'The download failed. Check your connection and try again.');
    } finally {
      setRunning(false);
      setProgress(null);
      onChanged();
    }
  };

  return (
    <SettingsSection title="Card models">
      {[...requiredAssets(), ...optionalAssets()].map((asset) => (
        <Text key={asset.name} style={[styles.file, { color: palette.ink2 }]}>
          {asset.name}: {hasAsset(deviceModelFiles, asset) ? 'ready' : 'not downloaded'}
        </Text>
      ))}
      {ready ? (
        <Note text={`Models are ready. Text reading: ${textOn ? 'on' : 'off'}`} />
      ) : null}
      {ready && !textOn ? (
        <Button label="Download the text reading files" busy={running} onPress={() => void download()} />
      ) : null}
      {ready ? null : (
        <Button label={`Download models (${downloadSizeText(missing)})`} variant="primary" busy={running} onPress={() => void download()} />
      )}
      {progress ? (
        <>
          <Text style={[styles.file, { color: palette.ink }]}>{progressText(progress)}</Text>
          <ProgressBar fraction={progress.bytesTotal > 0 ? progress.bytesLoaded / progress.bytesTotal : 0} />
        </>
      ) : null}
      {error ? <Message tone="error" text={error} /> : null}
      {note ? <Message text={note} /> : null}
      <Note text="Downloaded once from GitHub over Wi-Fi or mobile data. Each file is checked before it is kept." />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  file: { fontSize: 13 },
  track: { height: 10, borderRadius: 5, borderWidth: 1, overflow: 'hidden', marginVertical: space.xs },
  fill: { height: '100%' },
});
