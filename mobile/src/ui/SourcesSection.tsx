import { useState } from 'react';
import { Text } from 'react-native';

import { type SourceStatus, checkDataSources } from '../core/assets';
import { refreshPriceSnapshot } from '../core/ext';
import { Button } from './Button';
import { Message } from './Notice';
import { SettingsSection } from './SettingsSection';
import { usePalette } from './theme';

export function SourcesSection() {
  const palette = usePalette();
  const [statuses, setStatuses] = useState<SourceStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const test = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    try {
      setStatuses(await checkDataSources());
    } catch (err) {
      console.error('[settings] connection test failed:', err instanceof Error ? err.message : err);
      setError('The connection test could not run. Check your connection.');
    } finally {
      setChecking(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    setResult(null);
    try {
      const snapshot = await refreshPriceSnapshot();
      if (snapshot) setResult('The price file is up to date.');
      else setError('The price file could not be refreshed. Try again later.');
    } catch (err) {
      console.error('[settings] price file refresh failed:', err instanceof Error ? err.message : err);
      setError('The price file could not be refreshed. Try again later.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SettingsSection title="Data sources">
      <Button label="Test connection" busy={checking} onPress={() => void test()} />
      {statuses?.map((status) => (
        <Text key={status.name} style={{ color: status.ok ? palette.ok : palette.danger, fontSize: 14 }}>
          {status.name}: {status.ok ? 'Reachable' : status.detail}
        </Text>
      ))}
      <Button label="Refresh price file" busy={refreshing} onPress={() => void refresh()} />
      {result ? <Message text={result} /> : null}
      {error ? <Message tone="error" text={error} onDismiss={() => setError(null)} /> : null}
    </SettingsSection>
  );
}
