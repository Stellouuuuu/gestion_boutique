import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT_TITLE } from '../theme/typography';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Évite l’écran blanc si SQLite/wasm ou un autre module plante au démarrage (web).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AppErrorBoundary', error, info.componentStack);
  }

  private recharger = () => {
    this.setState({ error: null });
    if (typeof globalThis.location !== 'undefined') {
      globalThis.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.box} accessibilityRole="alert">
        <Text style={styles.title}>Une erreur est survenue</Text>
        <Text style={styles.body}>
          L’application n’a pas pu démarrer. Rechargez la page. Si le problème continue, videz le
          cache du site ou réinstallez depuis Safari (Sur l’écran d’accueil).
        </Text>
        <Pressable
          onPress={this.recharger}
          style={styles.btn}
          accessibilityRole="button"
          accessibilityLabel="Recharger"
        >
          <Text style={styles.btnText}>Recharger</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#F3F4F8',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1B1E3A',
    fontFamily: FONT_TITLE,
    marginBottom: 12,
  },
  body: { fontSize: 17, lineHeight: 26, color: '#5C6180', marginBottom: 24 },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: '#27306B',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 17 },
});
