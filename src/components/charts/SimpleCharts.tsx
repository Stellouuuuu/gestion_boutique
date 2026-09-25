import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { formatAxeCourt, formatFCFA } from '../../lib/format';
import { useTheme } from '../../theme/useTheme';

export type BarreSimple = { label: string; valeur: number; couleur?: string };

type Props = {
  data: BarreSimple[];
  /** Ligne horizontale (ex. moyenne). */
  ligneMoyenne?: number;
  hauteur?: number;
  /** Toucher → montant complet. */
};

/**
 * Barres verticales via react-native-svg (Android + web).
 * Pas de gifted-charts : gradients / native modules cassent le web Expo.
 */
export function SimpleBarChart({ data, ligneMoyenne, hauteur = 180 }: Props) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(300);
  const [tip, setTip] = useState<string | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setWidth(w);
  };

  const maxVal = Math.max(...data.map((d) => d.valeur), ligneMoyenne ?? 0, 1);
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const chartW = Math.max(width - padL - padR, 40);
  const chartH = hauteur - padT - padB;
  const gap = data.length > 20 ? 1 : 4;
  const barW = Math.max(2, (chartW - gap * (data.length - 1)) / Math.max(data.length, 1));

  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={hauteur}>
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + chartH * (1 - f);
          return (
            <Line
              key={f}
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              stroke={colors.line}
              strokeWidth={1}
            />
          );
        })}
        <SvgText x={2} y={padT + 4} fontSize={10} fill={colors.muted}>
          {formatAxeCourt(maxVal)}
        </SvgText>
        <SvgText x={2} y={padT + chartH} fontSize={10} fill={colors.muted}>
          0
        </SvgText>
        {data.map((d, i) => {
          const h = (d.valeur / maxVal) * chartH;
          const x = padL + i * (barW + gap);
          const y = padT + chartH - h;
          return (
            <Rect
              key={`${d.label}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.valeur > 0 ? 2 : 0)}
              rx={2}
              fill={d.couleur ?? colors.indigo}
              onPress={() => setTip(`${d.label || `#${i + 1}`} : ${formatFCFA(d.valeur)}`)}
            />
          );
        })}
        {ligneMoyenne != null && ligneMoyenne > 0 ? (
          <Line
            x1={padL}
            x2={width - padR}
            y1={padT + chartH * (1 - ligneMoyenne / maxVal)}
            y2={padT + chartH * (1 - ligneMoyenne / maxVal)}
            stroke={colors.sun}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ) : null}
        {data.map((d, i) =>
          d.label ? (
            <SvgText
              key={`lbl-${i}`}
              x={padL + i * (barW + gap) + barW / 2}
              y={hauteur - 8}
              fontSize={9}
              fill={colors.muted}
              textAnchor="middle"
            >
              {d.label}
            </SvgText>
          ) : null
        )}
      </Svg>
      <Pressable onPress={() => setTip(null)}>
        <Text style={[styles.tip, { color: tip ? colors.ink : colors.muted }]}>
          {tip ?? 'Touchez une barre pour le montant exact'}
        </Text>
      </Pressable>
    </View>
  );
}

type HProps = {
  data: { label: string; valeur: number; couleur?: string }[];
  maxHint?: number;
};

export function HorizontalBarChart({ data, maxHint }: HProps) {
  const { colors } = useTheme();
  const maxVal = Math.max(...data.map((d) => d.valeur), maxHint ?? 0, 1);

  return (
    <View style={{ gap: 8 }}>
      {data.map((d) => (
        <View key={d.label}>
          <View style={styles.hRow}>
            <Text style={[styles.hLabel, { color: colors.ink }]} numberOfLines={1}>
              {d.label}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{formatFCFA(d.valeur)}</Text>
          </View>
          <View style={[styles.hTrack, { backgroundColor: colors.line }]}>
            <View
              style={{
                width: `${Math.max(2, (100 * d.valeur) / maxVal)}%`,
                height: 10,
                borderRadius: 5,
                backgroundColor: d.couleur ?? colors.indigo,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

type StackProps = {
  parts: { label: string; valeur: number; couleur: string }[];
  titre: string;
};

/** Deux (ou plus) segments à 100 %, pas de camembert. */
export function Stacked100Bar({ parts, titre }: StackProps) {
  const { colors } = useTheme();
  const total = parts.reduce((s, p) => s + p.valeur, 0) || 1;

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>{titre}</Text>
      <View style={[styles.stack, { backgroundColor: colors.line }]}>
        {parts.map((p) => {
          const pct = (100 * p.valeur) / total;
          if (pct <= 0) return null;
          return (
            <View
              key={p.label}
              style={{
                width: `${pct}%`,
                height: 22,
                backgroundColor: p.couleur,
              }}
            />
          );
        })}
      </View>
      <View style={styles.legend}>
        {parts.map((p) => (
          <Text key={p.label} style={{ color: colors.ink, fontSize: 13 }}>
            <Text style={{ color: p.couleur }}>● </Text>
            {p.label} {Math.round((100 * p.valeur) / total)} %
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: { fontSize: 13, marginTop: 4 },
  hRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  hLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  hTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  stack: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', height: 22 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
