// The price of a confirmed card (product rules 2 to 4): never before the user's pick, Near Mint, one printing.

import { StyleSheet, Text, View } from 'react-native';

import { formatUsd, listPrintings, quotedPrice, sourceFooter } from '../core/ext';
import type { ScanRow } from '../core/types';
import { Button } from './Button';
import { PrintingChoices } from './PrintingChoices';
import { space, usePalette } from './theme';

interface PriceAreaProps {
  row: ScanRow;
  printing: string | null;
  onPrinting: (printing: string) => void;
  onRetry: () => void;
}

export function PriceArea({ row, printing, onPrinting, onRetry }: PriceAreaProps) {
  const palette = usePalette();
  if (!row.userConfirmed) return null;
  if (row.pricing) return <Text style={[styles.note, { color: palette.ink2 }]}>Getting price…</Text>;
  const printings = listPrintings(row.price_grid);
  const quote = row.priceError ? null : quotedPrice(row, printing, ['NM']);
  const footer = sourceFooter(row.price_grid);
  if (!quote && (row.priceError || printings.length <= 1)) {
    return (
      <View style={styles.wrap}>
        <Text style={[styles.note, { color: palette.ink2 }]}>No price found</Text>
        <Button label="Retry" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      {printings.length > 1 ? <PrintingChoices printings={printings} selected={printing} onPick={onPrinting} /> : null}
      {quote ? (
        <View>
          <Text style={[styles.price, { color: palette.ink }]}>
            {formatUsd(quote.price)} <Text style={[styles.grade, { color: palette.ink2 }]}>Near Mint</Text>
          </Text>
          {footer ? <Text style={[styles.footer, { color: palette.ink3 }]}>{footer}</Text> : null}
        </View>
      ) : (
        <Text style={[styles.note, { color: palette.ask }]}>Pick a printing to see its price</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  note: { fontSize: 15, fontWeight: '600' },
  price: { fontSize: 24, fontWeight: '700' },
  grade: { fontSize: 14, fontWeight: '600' },
  footer: { fontSize: 12, marginTop: 2 },
});
