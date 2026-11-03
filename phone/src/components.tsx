// The handful of building blocks the screen is made of. Each one carries its
// own accessibility role, label and state, so the screen reads correctly with
// VoiceOver / TalkBack without the screen having to think about it.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useA11y } from './a11y';
import { font, radius, space, touch, type, usePalette } from './theme';

export type Tone = 'ok' | 'busy' | 'warn' | 'danger' | 'idle';

// A screen's root view, kept clear of the status bar, the notch and the
// navigation bar. React Native's own SafeAreaView does this on iOS only, and
// Android draws apps edge to edge.
export function Screen(props: ViewProps) {
  const inset = useSafeAreaInsets();
  return (
    <View
      {...props}
      style={[{ flex: 1, paddingTop: inset.top, paddingBottom: inset.bottom, paddingLeft: inset.left, paddingRight: inset.right }, props.style]}
    />
  );
}

export function Card(props: { children: ReactNode; title?: string }) {
  const c = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {props.title ? (
        <Text style={[styles.cardTitle, { color: c.textMuted }]} accessibilityRole="header">
          {props.title}
        </Text>
      ) : null}
      {props.children}
    </View>
  );
}

// One connection: its name, its state in words, and the one thing to do
// about it. The dot's color repeats what the words say.
export function StatusRow(props: {
  tone: Tone;
  title: string;
  detail: string;
  action?: { label: string; onPress: () => void; disabled?: boolean };
  children?: ReactNode;
}) {
  const c = usePalette();
  const { largeText } = useA11y();
  const dot = props.tone === 'ok' ? c.ok : props.tone === 'danger' ? c.danger : props.tone === 'warn' ? c.warn : props.tone === 'busy' ? c.accent : c.textMuted;
  const action = props.action ? <Button label={props.action.label} onPress={props.action.onPress} disabled={props.action.disabled} kind="secondary" size="small" /> : null;
  return (
    <View style={styles.statusRow}>
      <View style={styles.statusTop}>
        <View style={styles.statusText} accessible accessibilityLabel={`${props.title}. ${props.detail.replace(/ · /g, ', ')}`}>
          <Text style={[styles.rowTitle, { color: c.text }]}>{props.title}</Text>
          <View style={styles.detailRow}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={[styles.rowDetail, { color: c.textMuted }]}>{props.detail}</Text>
          </View>
        </View>
        {props.action && !largeText ? action : null}
      </View>
      {/* Large text: the action moves under the words, so neither gets squeezed. */}
      {props.children || (props.action && largeText) ? (
        <View style={styles.statusChildren}>
          {props.action && largeText ? action : null}
          {props.children}
        </View>
      ) : null}
    </View>
  );
}

// A label without its leading symbol ("‹ Back" → "Back"), so a screen reader
// says the word, and Voice Control matches what the person reads.
export const spoken = (label: string) => label.replace(/^[‹›▶■◉✓!]\s*/u, '');

// The hint on Start / Stop. On iOS, VoiceOver's two-finger double-tap (the
// "magic tap") also starts and stops the app (App.tsx).
export const startHint = (active: boolean, app?: string) =>
  `${active ? 'Stops' : 'Starts'} ${app ?? 'the app'} and the microphone.${Platform.OS === 'ios' ? ' A two-finger double-tap also does this.' : ''}`;

export function Button(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'quiet';
  size?: 'small' | 'large';
  flex?: boolean;
  hint?: string;
}) {
  const c = usePalette();
  const kind = props.kind ?? 'primary';
  const bg = kind === 'primary' ? c.accentFill : kind === 'secondary' ? c.surfaceAlt : 'transparent';
  const fg = kind === 'primary' ? c.onAccent : kind === 'secondary' ? c.text : c.accent;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken(props.label)}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: !!props.disabled }}
      hitSlop={props.size === 'small' ? 8 : 0}
      style={({ pressed }) => [
        styles.button,
        props.size === 'small' ? styles.buttonSmall : null,
        props.size === 'large' ? styles.buttonLarge : null,
        props.flex ? styles.flex : null,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? c.control : 'transparent' },
        pressed ? styles.pressed : null,
        props.disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.buttonText, props.size === 'large' ? styles.buttonTextLarge : null, { color: fg }]}>{props.label}</Text>
    </Pressable>
  );
}

// A card that stays folded until its title is pressed. What is inside is not
// mounted while it is folded, so a picture in there uses no memory until it opens.
export function Disclosure(props: { title: string; summary?: string; children: ReactNode }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={props.summary ? `${props.title}. ${props.summary}` : props.title}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        style={({ pressed }) => [styles.disclosureHead, pressed ? styles.pressed : null]}
      >
        <Text style={[styles.cardTitle, { color: c.textMuted }]}>{props.title}</Text>
        {props.summary && !open ? (
          <Text style={[styles.disclosureSummary, { color: c.textMuted }]} numberOfLines={1}>
            {props.summary}
          </Text>
        ) : (
          <View style={styles.flex} />
        )}
        <Text style={[styles.disclosureGlyph, { color: c.textMuted }]}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? props.children : null}
    </View>
  );
}

// A choice between two or three options. Behaves as a radio group for assistive tech.
export function Segmented<T extends string>(props: {
  label: string;
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <View
      style={[styles.segmented, { backgroundColor: c.surfaceAlt, borderColor: c.control }, props.disabled ? styles.disabled : null]}
      accessibilityRole="radiogroup"
      accessibilityLabel={props.label}
    >
      {props.options.map((o) => {
        const selected = props.value === o.value;
        return (
          <Pressable
            key={o.value}
            disabled={props.disabled}
            onPress={() => !selected && props.onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected, disabled: !!props.disabled }}
            style={[styles.segment, selected ? { backgroundColor: c.accentFill } : null]}
          >
            <Text style={[styles.segmentText, { color: selected ? c.onAccent : c.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {selected ? '✓ ' : ''}
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// A softly pulsing dot for "something is happening". Holds still when the
// person has asked their phone to reduce motion.
export function Pulse(props: { color: string; active: boolean }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce || !props.active) return v.setValue(1);
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [props.active, v]);
  return <Animated.View style={[styles.pulse, { backgroundColor: props.color, opacity: v }]} accessible={false} importantForAccessibility="no" />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  cardTitle: { fontSize: type.caption, ...font('700'), letterSpacing: 0.8, textTransform: 'uppercase' },
  statusRow: { gap: space.sm },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statusText: { flex: 1, gap: 2 },
  statusChildren: { gap: space.sm },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill, marginTop: 6 },
  rowTitle: { fontSize: type.body, ...font('600') },
  rowDetail: { ...font(), flexShrink: 1, fontSize: type.caption + 1, lineHeight: 20 },
  button: { minHeight: touch, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 44, paddingHorizontal: space.md },
  buttonLarge: { minHeight: 64 },
  buttonText: { fontSize: type.body, ...font('600'), textAlign: 'center' },
  buttonTextLarge: { fontSize: type.lead, ...font('700') },
  segmented: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs },
  segmentText: { fontSize: type.body, ...font('600') },
  disclosureHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  disclosureSummary: { ...font(), flex: 1, fontSize: type.caption, textAlign: 'right' },
  disclosureGlyph: { ...font(), fontSize: type.lead },
  pulse: { width: 12, height: 12, borderRadius: radius.pill },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  typeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  field: { gap: space.xs },
  fieldLabel: { fontSize: type.caption + 1, ...font('600') },
  input: { ...font(), borderWidth: 1, borderRadius: radius.md, minHeight: 52, paddingHorizontal: space.md, fontSize: type.body },
  logo: { alignSelf: 'flex-start', backgroundColor: '#ffffff', borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: '#d6dae1' },
  logoLarge: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.md },
  logoText: { color: '#111111', fontSize: 19, ...font('800'), letterSpacing: -0.2 },
  logoTextLarge: { fontSize: 30 },
});

// A text input with a label that stays visible.
export function Field(props: { label: string; value: string; onChangeText: (t: string) => void; secure?: boolean; autoFocus?: boolean; placeholder?: string; onSubmit?: () => void }) {
  const c = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{props.label}</Text>
      <TextInput
        style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.control }]}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={props.onSubmit ? 'send' : 'done'}
        onSubmitEditing={props.onSubmit}
        accessibilityLabel={props.label}
      />
    </View>
  );
}

// "Type instead of speaking": what is typed goes to the app as if it were said.
export function TypeBox(props: { onSend: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim()) props.onSend(text.trim());
    setText('');
  };
  if (!open) return <Button label="Type instead of speaking" kind="quiet" onPress={() => setOpen(true)} />;
  return (
    <View style={styles.typeRow}>
      <View style={styles.flex}>
        <Field label="Type what you would say" value={text} onChangeText={setText} autoFocus onSubmit={send} />
      </View>
      <Button label="Send" disabled={!text.trim()} onPress={send} />
    </View>
  );
}

// The ai4a11y mark: a white block with black letters, in the app font. It
// keeps these colours in light and dark mode, so it reads as the mark.
export function Logo(props: { size?: 'small' | 'large' }) {
  const large = props.size === 'large';
  return (
    <View style={[styles.logo, large ? styles.logoLarge : null]} accessible accessibilityLabel="ai4a11y">
      <Text style={[styles.logoText, large ? styles.logoTextLarge : null]}>ai4a11y</Text>
    </View>
  );
}
