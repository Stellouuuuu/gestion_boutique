import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Header } from '../../components/Header';
import { ScreenScroll } from '../../components/ScreenScroll';
import { PinPad } from '../../components/PinPad';
import { useTheme } from '../../theme/useTheme';
import { getSetting, setSetting, SETTINGS_KEYS } from '../../db/settings';
import { useAdminSession } from '../../lib/AdminSession';
import { useToast } from '../../components/Toast';

type Step = 'loading' | 'unlock' | 'create-1' | 'create-2';

export default function PinScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const { unlock } = useAdminSession();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('loading');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const existing = await getSetting(db, SETTINGS_KEYS.pin);
      setStep(existing ? 'unlock' : 'create-1');
    })();
  }, [db]);

  const goIn = useCallback(() => {
    unlock();
    router.replace('/admin');
  }, [unlock]);

  const onComplete = async (code: string) => {
    if (step === 'unlock') {
      const existing = await getSetting(db, SETTINGS_KEYS.pin);
      if (code === existing) {
        setPin('');
        goIn();
      } else {
        setPin('');
        setError('Code incorrect.');
        showToast('Code incorrect');
      }
      return;
    }
    if (step === 'create-1') {
      setFirstPin(code);
      setPin('');
      setError(null);
      setStep('create-2');
      return;
    }
    if (step === 'create-2') {
      if (code === firstPin) {
        await setSetting(db, SETTINGS_KEYS.pin, code);
        setPin('');
        goIn();
      } else {
        setPin('');
        setError('Les deux codes sont différents. Recommencez.');
        setFirstPin('');
        setStep('create-1');
      }
    }
  };

  const label =
    step === 'unlock'
      ? 'Tapez le code pour modifier la liste.'
      : step === 'create-1'
        ? 'Choisissez un code à 4 chiffres pour protéger cette section.'
        : 'Retapez le même code pour confirmer.';

  return (
    <ScreenScroll>
      <Header title="Gérer les articles" />
      {step !== 'loading' && (
        <View>
          <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
          {error && <Text style={[styles.error, { color: colors.bad }]}>{error}</Text>}
          <PinPad value={pin} onChange={setPin} onComplete={onComplete} />
        </View>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 18, textAlign: 'center', marginTop: 8 },
  error: { fontSize: 16, textAlign: 'center', marginTop: 10, fontWeight: '700' },
});
