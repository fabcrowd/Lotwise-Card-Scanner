import { useEffect, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { clearPptKey, getPptKey, savePptKey } from '../core/ext';
import { Button } from './Button';
import { Message } from './Notice';
import { Note, SettingsSection } from './SettingsSection';
import { radius, space, usePalette } from './theme';

export function KeySection() {
  const palette = usePalette();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPptKey()
      .then((key) => setSaved(Boolean(key)))
      .catch((err: unknown) => {
        console.error('[settings] key read failed:', err instanceof Error ? err.message : err);
        setError('The saved key could not be read.');
      });
  }, []);

  const save = async (): Promise<void> => {
    setError(null);
    try {
      await savePptKey(value.trim());
      setValue('');
      setSaved(true);
    } catch (err) {
      console.error('[settings] key save failed:', err instanceof Error ? err.message : err);
      setError('The key could not be saved.');
    }
  };

  const remove = async (): Promise<void> => {
    setError(null);
    try {
      await clearPptKey();
      setSaved(false);
    } catch (err) {
      console.error('[settings] key remove failed:', err instanceof Error ? err.message : err);
      setError('The key could not be removed.');
    }
  };

  return (
    <SettingsSection title="Price service key (optional)">
      <Note text={saved === null ? 'Checking…' : saved ? 'A key is saved' : 'No key saved'} />
      <TextInput
        value={value}
        onChangeText={setValue}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="PokemonPriceTracker API key"
        placeholderTextColor={palette.ink3}
        accessibilityLabel="Price service key"
        style={[styles.input, { color: palette.ink, borderColor: palette.borderStrong, backgroundColor: palette.surface }]}
      />
      <Button label="Save" variant="primary" disabled={value.trim().length === 0} onPress={() => void save()} />
      <Button label="Remove" disabled={saved !== true} onPress={() => void remove()} />
      {error ? <Message tone="error" text={error} onDismiss={() => setError(null)} /> : null}
      <Note text="Stored in this device's keychain. Used only to ask that service for condition prices." />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
});
