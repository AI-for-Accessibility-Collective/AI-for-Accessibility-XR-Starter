// "Use this phone as the glasses": the phone's camera, microphone and
// loudspeaker, and a button on the screen, stand in for Mentra Live. The
// laptop sees a simulator (link.ts), so the team's app runs as it would on
// the glasses.
//
// Laid out for a phone held sideways, like a camera app: the camera fills the
// screen, and the controls sit in a column at the side. Portrait works too.
// The screen turns with the phone, also when the phone's rotation lock is on.
// The glasses have no Start button, so the app starts when this screen
// connects, and Exit stops it. When the app stops for another reason (Stop on
// the dashboard, or 20 idle minutes), the screen offers to start it again.
//
// Accessibility: the screen reader starts on the app's name. On iOS, a
// two-finger double-tap presses the glasses button, and the two-finger scrub
// exits. The glasses button has a long-press action for screen readers. The
// light shows its color as a word too. Captions stay on or off as the person
// left them.

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Accelerometer } from 'expo-sensors';
import type { LightColor } from '../../src/starter/protocol.ts';
import { useA11ySettings, useFocusOn } from './a11y';
import { Button, Pulse, Screen } from './components';
import type { Link } from './link';
import { showTextStore } from './storage';
import { font, italic, radius, space, touch, type, usePalette } from './theme';

const LED: Record<LightColor, string> = { red: '#e5484d', green: '#30a46c', blue: '#3e63dd', orange: '#f76b15', white: '#ffffff' };
const LONG_PRESS_MS = 700;
const READER = Platform.OS === 'ios' ? 'VoiceOver' : 'TalkBack';
const BUTTON_HINT =
  Platform.OS === 'ios'
    ? 'Double-tap to press. For a long press, swipe up or down to Long press, then double-tap. A two-finger double-tap also presses it.'
    : 'Double-tap to press. Double-tap and hold for a long press.';
// Control labels grow to 1.4x at most, so the side column keeps its shape at large text sizes.
const CONTROL_TEXT_MAX = 1.4;
// Words over the camera sit on this, so they stay readable over a bright scene.
const SCRIM = 'rgba(0,0,0,0.72)';

// True once `on` has held for `ms`. It hides states that pass in a moment,
// such as the laptop restarting after a team saves a file.
function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) {
      setHeld(false);
      return;
    }
    const t = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return held && on;
}

// The phone's rotation lock keeps apps upright, and a phone held as the
// glasses is usually sideways. So this screen reads the accelerometer and
// turns itself to the way the phone is held. Leaving the screen gives the
// phone's own setting back.
const { OrientationLock } = ScreenOrientation;
function useTurnWithPhone(): void {
  useEffect(() => {
    // Android reports gravity with the opposite sign to iOS.
    const k = Platform.OS === 'android' ? -1 : 1;
    let shown: ScreenOrientation.OrientationLock | null = null;
    let seen: ScreenOrientation.OrientationLock | null = null;
    let steady = 0;
    Accelerometer.setUpdateInterval(200);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const gx = x * k;
      const gy = y * k;
      // Flat on a table: keep the way it is.
      if (Math.abs(z) > 0.8) return;
      // Close to 45°, or upside down: keep the way it is.
      const next =
        Math.abs(gx) > Math.abs(gy) + 0.25 ? (gx > 0 ? OrientationLock.LANDSCAPE_LEFT : OrientationLock.LANDSCAPE_RIGHT)
        : -gy > Math.abs(gx) + 0.25 ? OrientationLock.PORTRAIT_UP
        : null;
      if (next == null) return;
      // Turn after a steady half second, so a quick tilt does not flip the screen.
      steady = next === seen ? steady + 1 : 1;
      seen = next;
      if (steady >= 3 && next !== shown) {
        shown = next;
        void ScreenOrientation.lockAsync(next).catch(() => {});
      }
    });
    return () => {
      sub.remove();
      void ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);
}

export function PhoneGlasses(props: {
  link: Link;
  hasLaptop: boolean;
  micAllowed: boolean;
  cameraRef: RefObject<CameraView | null>;
  onCameraReady: (ready: boolean) => void;
  onReconnect: () => void;
  onScan: () => void;
  onLeave: () => void;
}) {
  const { link } = props;
  const state = link.state;
  const active = !!state?.active;
  // Connected as this screen's own connection: the one from the glasses step can linger.
  const connected = link.status === 'connected' && link.connectedAs === 'phone';
  const title = state?.app ?? 'XR Starter';
  const c = usePalette();
  const { screenReader, reduceMotion } = useA11ySettings();
  const { width, height, fontScale } = useWindowDimensions();
  const landscape = width > height;
  // The side column widens with the control labels, up to their 1.4x cap.
  const railWidth = RAIL * Math.min(Math.max(fontScale, 1), CONTROL_TEXT_MAX);
  const [camera, requestCamera] = useCameraPermissions();
  const [captionsChosen, setCaptionsChosen] = useState(() => showTextStore.load());
  const [typing, setTyping] = useState(false);
  const [pressNote, setPressNote] = useState('');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<View>(null);
  const captionsRef = useRef<ScrollView>(null);
  useFocusOn(titleRef);
  useTurnWithPhone();

  // Ask once for the camera when the screen opens.
  useEffect(() => {
    if (camera && !camera.granted && camera.canAskAgain) void requestCamera();
  }, [camera?.granted, camera?.canAskAgain]);
  useEffect(() => () => props.onCameraReady(false), []);
  // Android's back button does what Exit does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      props.onLeave();
      return true;
    });
    return () => sub.remove();
  }, [props.onLeave]);
  useEffect(() => () => void (noteTimer.current && clearTimeout(noteTimer.current)), []);

  // Start the app when the laptop first answers, unless it already runs. This
  // is decided once: after a later Stop, the person chooses Start again. After
  // a restart of the laptop, link.ts asks to resume, so the app starts again on its own.
  const decided = useRef(false);
  const start = () => link.setActive(true);
  useEffect(() => {
    if (!connected || !state || decided.current) return;
    decided.current = true;
    if (!state.active) start();
  }, [connected, state != null]);
  const stopped = useHeld(connected && !!state && !active, 1500);
  const away = useHeld(props.hasLaptop && (link.status === 'offline' || link.status === 'connecting'), 4000);

  const press = (kind: 'short' | 'long') => {
    link.button(kind);
    setPressNote(kind === 'long' ? 'Long press sent' : 'Press sent');
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setPressNote(''), 1500);
  };
  const longPress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    press('long');
  };
  // The two-finger double-tap: the glasses button, or Start again when the app is stopped.
  const magicTap = () => {
    if (active) press('short');
    else if (connected) start();
  };

  // The profile can ask for captions. Then they stay on.
  const captionsForced = !!state?.captions;
  const captionsOn = captionsChosen || captionsForced;
  const setCaptions = (on: boolean) => {
    showTextStore.save(on);
    setCaptionsChosen(on);
  };

  const statusLine =
    !props.hasLaptop ? 'Not connected'
    : !connected || !state ? 'Connecting to the laptop…'
    : active ? state.status
    : 'Stopped';

  // One thing to act on, the most pressing first. Connection news is announced by App.tsx.
  const scan = { label: 'Scan QR code', hint: 'Connects to a laptop by its dashboard QR code', onPress: props.onScan };
  const openSettings = () => void Linking.openSettings();
  const notice: { text: string; action?: { label: string; hint?: string; onPress: () => void } } | null =
    !props.hasLaptop ? { text: 'Connect to a laptop first.', action: scan }
    : link.status === 'refused' ? { text: 'The laptop refused the pairing code.', action: scan }
    : link.status === 'replaced' ? { text: link.detail, action: { label: 'Use this phone again', onPress: props.onReconnect } }
    : away ? { text: 'Cannot reach the laptop. Check that “bun run dev” is running, and that this phone is on the same Wi-Fi. Retrying…', action: scan }
    : stopped ? { text: `${title} is stopped.`, action: { label: 'Start again', hint: `Starts ${title}`, onPress: start } }
    : camera && !camera.granted
      ? {
          text: 'The glasses camera uses this phone’s camera.',
          action: camera.canAskAgain ? { label: 'Allow the camera', onPress: () => void requestCamera() } : { label: 'Open Settings', hint: 'Allow the camera for XR Starter', onPress: openSettings },
        }
    : !props.micAllowed ? { text: 'The microphone is off for XR Starter, so the app cannot hear you.', action: { label: 'Open Settings', onPress: openSettings } }
    : null;

  const showCaptions = captionsOn && active && !!(state?.heard || state?.said);

  const cameraArea = (
    <View style={[s.camera, { backgroundColor: c.surface }]}>
      {camera?.granted ? (
        <CameraView
          ref={props.cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          pictureSize="1920x1080"
          animateShutter={!reduceMotion}
          onCameraReady={() => props.onCameraReady(true)}
          onMountError={() => props.onCameraReady(false)}
          accessibilityLabel="Camera preview. The glasses camera sees this."
        />
      ) : null}
      <View style={s.overlay} pointerEvents="box-none">
        <View style={s.overlayTop} pointerEvents="box-none">
          <View
            ref={titleRef}
            style={[s.chip, s.titleChip]}
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${title}. ${statusLine}`}
            accessibilityHint={screenReader ? `${READER} plays through the phone speaker, so the microphone can hear it. Talk after ${READER} finishes.` : undefined}
          >
            {active ? <Pulse color={state?.phase === 'listening' ? c.ok : c.accent} active /> : null}
            <View style={s.shrink}>
              <Text style={s.chipTitle} numberOfLines={2}>{title}</Text>
              <Text style={s.chipStatus} numberOfLines={2}>{statusLine}</Text>
            </View>
          </View>
          {link.light ? (
            <View style={s.chip} accessible accessibilityLabel={`Glasses light: ${link.light}`}>
              <View style={[s.led, { backgroundColor: LED[link.light], shadowColor: LED[link.light] }]} />
              <Text style={s.chipTitle}>Light: {link.light}</Text>
            </View>
          ) : null}
        </View>

        {state?.problem ? (
          <View style={[s.problem, { backgroundColor: c.dangerSoft, borderColor: c.danger }]}>
            <Text style={[s.noticeText, { color: c.text }]}>! {state.problem}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={[s.notice, landscape ? s.noticeRow : null, { backgroundColor: c.surface, borderColor: c.warn }]}>
            <Text style={[s.noticeText, landscape ? s.shrink : s.center, { color: c.text }]}>{notice.text}</Text>
            {notice.action ? <Button label={notice.action.label} hint={notice.action.hint} size="small" onPress={notice.action.onPress} /> : null}
          </View>
        ) : null}

        {/* The captions take the room left over, and scroll when it is short. */}
        <View style={s.spacer} pointerEvents="none" />
        {showCaptions ? (
          <ScrollView
            ref={captionsRef}
            style={s.captions}
            contentContainerStyle={s.captionsInner}
            onContentSizeChange={() => captionsRef.current?.scrollToEnd({ animated: false })}
          >
            {state?.heard ? (
              <Text style={s.heard} accessibilityLabel={`You said: ${state.heard}`}>You: {state.heard}</Text>
            ) : null}
            {state?.said ? (
              <Text style={state.captions ? s.saidLarge : s.said} accessibilityLabel={`${title} said: ${state.said}`}>{state.said}</Text>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );

  const exitControl = (
    <Control label="Exit" onPress={props.onLeave} hint={active ? `Stops ${title} and returns to the XR Starter screen` : 'Returns to the XR Starter screen'} />
  );
  const captionsControl = (
    <Control
      label="Captions"
      role="switch"
      on={captionsOn}
      locked={captionsForced}
      onPress={() => setCaptions(!captionsChosen)}
      hint={captionsForced ? 'The profile turns captions on.' : 'Shows what you said and what the app said. The glasses have no screen.'}
    />
  );
  const typeControl = (
    <Control label="Type" expanded={typing && active} onPress={() => setTyping(!(typing && active))} hint="Sends typed words to the app, the same as speaking" />
  );
  const glassesButton = (
    <Pressable
      onPressIn={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})}
      onPress={() => press('short')}
      onLongPress={longPress}
      delayLongPress={LONG_PRESS_MS}
      disabled={!active}
      accessibilityRole="button"
      accessibilityLabel="Glasses button"
      accessibilityHint={BUTTON_HINT}
      accessibilityState={{ disabled: !active }}
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Long press' }]}
      onAccessibilityAction={(e) => press(e.nativeEvent.actionName === 'longpress' ? 'long' : 'short')}
      style={[s.buttonCol, !active ? s.disabled : null]}
    >
      {({ pressed }) => (
        <>
          <View style={[s.big, { borderColor: c.text }, pressed ? s.bigPressed : null]}>
            <View style={[s.bigInner, { backgroundColor: c.surfaceAlt }]} />
          </View>
          <Text style={[s.buttonLabel, { color: c.text }]} maxFontSizeMultiplier={CONTROL_TEXT_MAX}>Glasses button</Text>
          <Text style={[s.buttonNote, { color: c.textMuted }]} maxFontSizeMultiplier={CONTROL_TEXT_MAX}>{pressNote || 'Tap or hold'}</Text>
        </>
      )}
    </Pressable>
  );
  const typeBar = typing && active ? <TypeBar onSend={link.type} /> : null;

  return (
    <Screen style={[s.root, { backgroundColor: c.bg }]} onMagicTap={magicTap} onAccessibilityEscape={props.onLeave}>
      <StatusBar barStyle="light-content" hidden={landscape} />
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        {/* The camera keeps its place in the tree in both orientations, so turning the phone
            keeps the same camera view. On Android, a closing camera view releases the camera
            of the view that replaces it. */}
        <View style={[s.flex, landscape ? s.row : s.portrait]}>
          {landscape ? null : (
            <View style={s.topRow}>
              {exitControl}
              <View style={s.flex} />
              {captionsControl}
              {typeControl}
            </View>
          )}
          <View style={[s.flex, s.cameraCol, landscape ? s.cameraSide : null]}>
            {cameraArea}
            {typeBar}
          </View>
          {landscape ? (
            // The column scrolls when the keyboard or large text leaves it short.
            <ScrollView style={[s.rail, { width: railWidth }]} contentContainerStyle={s.railInner} keyboardShouldPersistTaps="handled">
              {exitControl}
              {glassesButton}
              <View style={s.railGroup}>
                {captionsControl}
                {typeControl}
              </View>
            </ScrollView>
          ) : (
            <View style={s.bottom}>{glassesButton}</View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// A control in the side column: a button, or a switch with its track drawn.
function Control(props: {
  label: string;
  onPress: () => void;
  hint?: string;
  role?: 'button' | 'switch';
  on?: boolean;
  locked?: boolean; // shown as on, and the press does nothing
  expanded?: boolean;
}) {
  const c = usePalette();
  const isSwitch = props.role === 'switch';
  const lit = isSwitch ? !!props.on : !!props.expanded;
  return (
    <Pressable
      onPress={props.locked ? undefined : props.onPress}
      accessibilityRole={props.role ?? 'button'}
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={isSwitch ? { checked: !!props.on, disabled: !!props.locked } : props.expanded != null ? { expanded: props.expanded } : undefined}
      hitSlop={4}
      style={({ pressed }) => [s.control, { borderColor: c.control, backgroundColor: lit ? c.surfaceAlt : 'transparent' }, pressed ? s.pressed : null]}
    >
      <Text style={[s.controlText, { color: c.text }]} maxFontSizeMultiplier={CONTROL_TEXT_MAX}>{props.label}</Text>
      {isSwitch ? (
        <View style={[s.track, props.on ? { backgroundColor: c.accentFill, borderColor: c.accentFill } : { borderColor: c.control }]}>
          <View style={[s.thumb, { backgroundColor: props.on ? '#ffffff' : c.control }, props.on ? s.thumbOn : null]} />
        </View>
      ) : null}
    </Pressable>
  );
}

// What is typed goes to the app as if it were said. It stays open for the next message.
function TypeBar(props: { onSend: (text: string) => void }) {
  const c = usePalette();
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim()) props.onSend(text.trim());
    setText('');
  };
  return (
    <View style={s.typeBar}>
      <TextInput
        style={[s.input, { color: c.text, backgroundColor: c.surface, borderColor: c.control }]}
        value={text}
        onChangeText={setText}
        autoFocus
        placeholder="Type what you would say"
        placeholderTextColor={c.textMuted}
        returnKeyType="send"
        onSubmitEditing={send}
        submitBehavior="submit"
        accessibilityLabel="Type what you would say"
      />
      <Button label="Send" size="small" disabled={!text.trim()} onPress={send} />
    </View>
  );
}

const BIG = 96;
const RAIL = 168;

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
  cameraCol: { gap: space.sm },
  // Landscape: the camera, and the control column at the side.
  cameraSide: { padding: space.sm, paddingRight: 0 },
  rail: { flexGrow: 0 },
  railInner: { flexGrow: 1, justifyContent: 'space-between', alignItems: 'stretch', padding: space.sm, gap: space.md },
  railGroup: { gap: space.sm },
  // Portrait: the controls above the camera, the glasses button below it.
  portrait: { padding: space.sm, gap: space.sm },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  bottom: { alignItems: 'center', paddingVertical: space.sm },

  camera: { flex: 1, minHeight: 120, borderRadius: radius.lg, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, padding: space.sm, gap: space.sm },
  overlayTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  spacer: { flex: 1, minHeight: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: SCRIM, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  titleChip: { flexShrink: 1, maxWidth: '75%' },
  chipTitle: { color: '#ffffff', fontSize: type.body, ...font('700') },
  chipStatus: { color: '#d3d9e1', fontSize: type.caption + 1, ...font() },
  led: { width: 14, height: 14, borderRadius: radius.pill, shadowRadius: 6, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } },
  problem: { borderWidth: 1, borderRadius: radius.md, padding: space.md },
  notice: { alignSelf: 'center', maxWidth: 560, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.md, alignItems: 'center' },
  noticeRow: { flexDirection: 'row' },
  noticeText: { ...font(), fontSize: type.body, lineHeight: 23 },
  captions: { flexGrow: 0, flexShrink: 1, maxHeight: '50%', backgroundColor: SCRIM, borderRadius: radius.md },
  captionsInner: { padding: space.md, gap: space.xs },
  heard: { ...italic, color: '#d3d9e1', fontSize: type.body, lineHeight: 23 },
  said: { ...font('600'), color: '#ffffff', fontSize: type.lead, lineHeight: 26 },
  saidLarge: { ...font('700'), color: '#ffffff', fontSize: 26, lineHeight: 34 },

  control: { minHeight: touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5 },
  controlText: { fontSize: type.body, ...font('600') },
  track: { width: 36, height: 22, borderRadius: radius.pill, borderWidth: 1.5, justifyContent: 'center', paddingHorizontal: 2 },
  thumb: { width: 15, height: 15, borderRadius: radius.pill },
  thumbOn: { alignSelf: 'flex-end' },

  buttonCol: { alignItems: 'center', gap: 2 },
  big: { width: BIG, height: BIG, borderRadius: BIG / 2, borderWidth: 4, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  bigInner: { width: BIG - 18, height: BIG - 18, borderRadius: (BIG - 18) / 2 },
  bigPressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
  buttonLabel: { fontSize: type.body, ...font('700'), textAlign: 'center' },
  buttonNote: { fontSize: type.caption, ...font(), textAlign: 'center' },

  typeBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { ...font(), flex: 1, minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: type.body },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
