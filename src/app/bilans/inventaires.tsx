import { StyleSheet, Text, View } from 'react-native';
import { BilansShell } from '../../components/BilansShell';
import { useTheme } from '../../theme/useTheme';

export default function InventairesPlaceholder() {
  const { colors } = useTheme();
  return (
    <BilansShell title="Inventaires">
      <View style={[styles.box, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '700' }}>Bientôt</Text>
        <Text style={{ color: colors.muted, marginTop: 8, fontSize: 16 }}>
          Le comptage réel (inventaires) arrivera juste après les bilans.
        </Text>
      </View>
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 16, padding: 24, marginTop: 8 },
});
