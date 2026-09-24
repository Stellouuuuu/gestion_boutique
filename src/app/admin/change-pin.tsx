import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { PinPad } from '../../components/PinPad';
import { RequireUnlocked } from '../../components/RequireUnlocked';
import { useTheme } from '../../theme/useTheme';
import { useToast } from '../../components/Toast';
import { getSetting, setSetting, SETTINGS_KEYS } from '../../db/settings';

type Step = 'current' | 'new-1' | 'new-2';

export default function ChangePinScreen() {
  return (
    <RequireUnlocked>
      <ChangePinForm />
    </RequireUnlocked>
  );
}

function ChangePinForm() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('current');
  const [pin, setPin] = useState('');
  const [firstNew, setFirstNew] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onComplete = async (code: string) => {
    if (step === 'current') {
      const existing = await getSetting(db, SETTINGS_KEYS.pin);
      if (code === existing) {
        setPin('');
        setError(null);
        setStep('new-1');
      } else {
        setPin('');
        setError('Code incorrect.');
      }
      return;
    }
    if (step === 'new-1') {
      setFirstNew(code);
      setPin('');
      setError(null);
      setStep('new-2');
      return;
    }
    if (step === 'new-2') {
      if (code === firstNew) {
        await setSetting(db, SETTINGS_KEYS.pin, code);
        showToast('Nouveau code enregistré');
        router.replace('/admin');
      } else {
        setPin('');
        setError('Les deux codes sont différents. Recommencez.');
        setFirstNew('');
        setStep('new-1');
      }
    }
  };

  const label =
    step === 'current'
      ? 'Tapez le code actuel.'
      : step === 'new-1'
        ? 'Choisissez le nouveau code.'
        : 'Retapez le nouveau code pour confirmer.';

  return (
    <ScreenScroll>
      <Header title="Changer le code" onBack={() => router.replace('/admin')} />
      <View>
        <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
        {error && <Text style={[styles.error, { color: colors.bad }]}>{error}</Text>}
        <PinPad value={pin} onChange={setPin} onComplete={onComplete} />
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 18, textAlign: 'center', marginTop: 8 },
  error: { fontSize: 16, textAlign: 'center', marginTop: 10, fontWeight: '700' },
});
