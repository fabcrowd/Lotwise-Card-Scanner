import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';

import { libraryCsv } from '../data/library';
import { library, writeShareFile } from '../device/files';
import { Button } from './Button';
import { Message } from './Notice';
import { SettingsSection } from './SettingsSection';

export function ExportSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const share = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const { name, csv, count, notIncluded } = libraryCsv(await library.all());
      const left = notIncluded > 0
        ? `${notIncluded} ${notIncluded === 1 ? 'card was' : 'cards were'} left out because the price is out of date. Pull down on the Library to refresh prices.`
        : null;
      if (count === 0) {
        setMessage(left ?? 'There are no cards in the library to export.');
        return;
      }
      setMessage(left);
      const text = '﻿' + csv;
      if (await Sharing.isAvailableAsync()) {
        const uri = await writeShareFile(name, text);
        await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
      } else {
        await Clipboard.setStringAsync(text);
        setMessage('Sharing is not available on this device, so the CSV was copied to the clipboard.');
      }
    } catch (err) {
      console.error('[settings] export failed:', err instanceof Error ? err.message : err);
      setError('The library could not be exported. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Export">
      <Button label="Share library as CSV" busy={busy} onPress={() => void share()} />
      {message ? <Message text={message} /> : null}
      {error ? <Message tone="error" text={error} onDismiss={() => setError(null)} /> : null}
    </SettingsSection>
  );
}
