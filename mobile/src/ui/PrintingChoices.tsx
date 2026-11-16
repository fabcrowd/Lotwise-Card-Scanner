import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, usePalette } from './theme';

export function printingLabel(printing: string): string {
  const spaced = printing.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface PrintingChoicesProps {
  printings: readonly string[];
  selected: string | null;
  onPick: (printing: string) => void;
}

/** The printing is the user's pick: every printing is a choice, and none is chosen for them. */
export function PrintingChoices({ printings, selected, onPick }: PrintingChoicesProps) {
  const palette = usePalette();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, { color: palette.ask }]}>Which printing is it?</Text>
      <View style={styles.row}>
        {printings.map((printing) => {
          const on = printing === selected;
          return (
            <Pressable
              key={printing}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={printingLabel(printing)}
              onPress={() => onPick(printing)}
              style={[
                styles.choice,
                { borderColor: on ? palette.ok : palette.borderStrong, backgroundColor: on ? palette.okTint : palette.surface },
              ]}
            >
              <Text style={[styles.text, { color: on ? palette.ok : palette.ink }]}>{printingLabel(printing)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  heading: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '700' },
});
