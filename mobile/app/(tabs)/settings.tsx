import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExportSection } from '../../src/ui/ExportSection';
import { KeySection } from '../../src/ui/KeySection';
import { ModelsSection } from '../../src/ui/ModelsSection';
import { Note, SettingsSection } from '../../src/ui/SettingsSection';
import { SourcesSection } from '../../src/ui/SourcesSection';
import { space, usePalette } from '../../src/ui/theme';

export default function SettingsScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md, paddingBottom: space.xl }]}
    >
      <Text style={[styles.title, { color: palette.ink }]}>Settings</Text>
      <ModelsSection onChanged={refresh} />
      <SourcesSection />
      <KeySection />
      <ExportSection />
      <SettingsSection title="Privacy">
        <Note text="Your photos, your library and your key stay on this device. The app only downloads model and price files, and asks price services about a card you have confirmed." />
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, gap: space.md },
  title: { fontSize: 28, fontWeight: '700' },
});
