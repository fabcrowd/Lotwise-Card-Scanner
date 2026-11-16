import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { usePalette } from '../src/ui/theme';

export default function RootLayout() {
  const palette = usePalette();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.ink,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="review" options={{ title: 'Review cards' }} />
        <Stack.Screen name="card/[key]" options={{ title: 'Card' }} />
      </Stack>
    </>
  );
}
