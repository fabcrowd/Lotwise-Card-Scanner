// Runs the scan of one photo and moves to Review. Holds the "busy" and message state of the Scan screen.

import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';

import { ModelsMissingError, scanPhoto } from '../device/engine';
import { startReview } from '../state/session';

export interface Photo {
  uri: string;
  width: number;
  height: number;
}

export interface ScanState {
  busy: boolean;
  message: string | null;
  modelsMissing: boolean;
  scan: (photo: Photo) => Promise<void>;
  choosePhoto: () => Promise<void>;
  report: (text: string) => void;
  dismiss: () => void;
  recheckModels: (ready: boolean) => void;
}

const NO_CARD = 'No card found in that photo. Move closer, avoid glare, and try again.';

export function useScan(): ScanState {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [modelsMissing, setModelsMissing] = useState(false);

  const scan = async (photo: Photo): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const cards = await scanPhoto(photo);
      if (cards.length === 0) {
        setMessage(NO_CARD);
        return;
      }
      startReview(cards);
      router.push('/review');
    } catch (err) {
      console.error('[scan] failed:', err instanceof Error ? err.message : err);
      if (err instanceof ModelsMissingError) setModelsMissing(true);
      else setMessage(err instanceof Error ? err.message : 'The photo could not be scanned. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const choosePhoto = async (): Promise<void> => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) await scan({ uri: asset.uri, width: asset.width, height: asset.height });
    } catch (err) {
      console.error('[scan] photo picker failed:', err instanceof Error ? err.message : err);
      setMessage('The photo could not be opened. Try another one.');
    }
  };

  return {
    busy,
    message,
    modelsMissing,
    scan,
    choosePhoto,
    report: setMessage,
    dismiss: () => setMessage(null),
    recheckModels: (ready) => setModelsMissing(!ready),
  };
}
