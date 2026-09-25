import { StyleSheet, Text, View } from 'react-native';
import { BilansShell } from '../../components/BilansShell';
import { useTheme } from '../../theme/useTheme';

export default function StatistiquesPlaceholder() {
  const { colors } = useTheme();
  return (
    <BilansShell title="Statistiques">
      <View style={[styles.box, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '700' }}>Bientôt</Text>
        <Text style={{ color: colors.muted, marginTop: 8, fontSize: 16 }}>
          Les graphiques pour vendre mieux arriveront à l’étape suivante.
        </Text>
      </View>
    </BilansShell>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 16, padding: 24, marginTop: 8 },
});
