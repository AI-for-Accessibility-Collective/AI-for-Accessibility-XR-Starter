// XR Starter: the phone app. It connects the glasses to the app running on a
// laptop, and keeps its own logic small (see link.ts).
//
//   Laptop    which laptop to use. Set by scanning the dashboard's QR code
//             with the Camera app, or typed in by hand.
//   Glasses   scan, connect, battery. Remembered across launches.
//   App       Start / Stop, what the app is doing, what it heard and said.
//
// Built once by the organiser and shared at the event. Teams do not need to
// change it: their app runs on their laptop.

import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import BluetoothSdk, { DeviceModels, type Device } from '@mentra/bluetooth-sdk';
import { useMentraBluetooth } from '@mentra/bluetooth-sdk/react';
import type { Phase } from '../../src/starter/protocol.ts';
import { Button, Card, Pulse, StatusRow, type Tone } from './components';
import { useLink } from './link';
import { cleanLaptop, glassesStore, laptopStore, parsePairingLink, type Laptop } from './storage';
import { radius, space, type, usePalette } from './theme';

async function androidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ];
  const results = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => results[p] === PermissionsAndroid.RESULTS.GRANTED);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PHASE_TEXT: Record<Phase, string> = {
  off: '',
  idle: 'Ready. The microphone is off until the app asks you something.',
  listening: 'Listening. Speak when you are ready.',
  thinking: 'Working on it…',
  speaking: 'Speaking. It listens again when it finishes.',
};

export default function App() {
  useKeepAwake();
  const c = usePalette();
  const scheme = useColorScheme();
  const [problem, setProblem] = useState('');

  // ── Laptop ────────────────────────────────────────────────────────────────
  const [laptop, setLaptopState] = useState<Laptop | null>(() => laptopStore.load());
  const setLaptop = (l: Laptop | null) => {
    laptopStore.save(l);
    setLaptopState(l);
  };
  const [formOpen, setFormOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [codeInput, setCodeInput] = useState('');

  // The dashboard's QR code opens xrstarter://connect?url=…&token=…
  useEffect(() => {
    const use = (link: string | null) => {
      const l = link ? parsePairingLink(link) : null;
      if (l) {
        setLaptop(l);
        setFormOpen(false);
      }
    };
    void Linking.getInitialURL().then(use);
    const sub = Linking.addEventListener('url', (e) => use(e.url));
    return () => sub.remove();
  }, []);

  // ── Glasses ───────────────────────────────────────────────────────────────
  const mentra = useMentraBluetooth({
    autoConnectDefault: true,
    defaultDeviceStorage: glassesStore,
    defaultModel: DeviceModels.MentraLive,
    scanTimeoutMs: 10_000,
    onError: (e) => setProblem(errorText(e)),
  });
  const g = mentra.glasses;
  const wifi = g.connected ? g.wifi : null;
  const wifiOn = wifi ? wifi.state === 'connected' : null;
  const battery = g.connected ? g.battery.level : null;
  const [scanned, setScanned] = useState(false);

  // The glasses button belongs to the app: no gallery photo on a press.
  useEffect(() => {
    if (g.connected && g.ready) void mentra.setGalleryModeEnabled(false).catch(() => {});
  }, [g.connected, g.connected && g.ready]);

  const link = useLink(laptop, { connected: g.connected, wifi: wifiOn, battery });
  const state = link.state;
  const active = !!state?.active;
  const phase: Phase = state?.phase ?? 'off';

  const scan = async () => {
    setProblem('');
    if (!(await androidPermissions())) return setProblem('Allow Bluetooth and the microphone to find your glasses.');
    try {
      await mentra.scan.start();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setScanned(true);
    }
  };
  const connect = async (device: Device) => {
    setProblem('');
    try {
      await mentra.connect(device);
      await mentra.setDefaultDevice(device);
    } catch (e) {
      setProblem(`Could not connect to ${device.name}. ${errorText(e)}`);
    }
  };
  const forgetGlasses = () =>
    Alert.alert('Disconnect the glasses?', 'This phone will stop reconnecting to them on its own.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void mentra.disconnect().then(() => mentra.clearDefaultDevice()).catch((e) => setProblem(errorText(e))) },
    ]);

  // Optional: photos are quicker over Wi-Fi than over Bluetooth.
  const [wifiOpen, setWifiOpen] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [joining, setJoining] = useState(false);
  const joinWifi = async () => {
    setProblem('');
    setJoining(true);
    try {
      const r = await BluetoothSdk.sendWifiCredentials(ssid.trim(), password);
      if (r.state === 'connected') {
        setPassword('');
        setWifiOpen(false);
      } else setProblem(r.error === 'wrong_password' ? 'That Wi-Fi password did not work.' : `The glasses could not join “${ssid.trim()}”.`);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setJoining(false);
    }
  };

  // ── Rows ──────────────────────────────────────────────────────────────────
  const laptopRow: { tone: Tone; title: string; detail: string } =
    !laptop ? { tone: 'warn', title: 'Laptop', detail: 'Not chosen yet. Scan the QR code on the laptop’s dashboard with this phone’s Camera app.' }
    : link.status === 'connected' ? { tone: 'ok', title: 'Laptop', detail: `Connected to “${link.detail}”` }
    : link.status === 'refused' ? { tone: 'danger', title: 'Laptop', detail: 'The pairing code was refused. Scan the QR code again.' }
    : link.status === 'replaced' ? { tone: 'warn', title: 'Laptop', detail: link.detail }
    : link.status === 'offline' ? { tone: 'warn', title: 'Laptop', detail: `Cannot reach ${laptop.url}. Is “bun run dev” running? Is this phone on the same Wi-Fi? Retrying…` }
    : { tone: 'busy', title: 'Laptop', detail: `Connecting to ${laptop.url}…` };

  const linkState = g.connected ? 'connected' : g.connection.state;
  const glassesRow: { tone: Tone; detail: string } =
    g.connected ? { tone: 'ok', detail: `Connected${battery != null ? ` · battery ${battery}%` : ''}` }
    : linkState !== 'disconnected' ? { tone: 'busy', detail: linkState === 'scanning' ? 'Looking for glasses nearby…' : 'Connecting…' }
    : mentra.defaultDevice ? { tone: 'warn', detail: `Not connected to ${mentra.defaultDevice.name}. Are they switched on and nearby?` }
    : { tone: 'warn', detail: 'Not connected. Switch the glasses on, then scan.' };

  const blockedBy = link.status !== 'connected' ? 'Connect to the laptop first.' : !g.connected ? 'Connect the glasses first.' : null;
  const headline = active ? 'Live' : !blockedBy ? 'Ready' : 'Getting ready';
  const headlineTone = active ? c.stop : !blockedBy ? c.ok : c.warn;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <View style={s.flex}>
              <Text style={[s.subtitle, { color: c.textMuted }]}>Hackathon kit</Text>
              <Text style={[s.title, { color: c.text }]} accessibilityRole="header">XR Starter</Text>
            </View>
            <View style={[s.pill, { borderColor: headlineTone }]} accessible accessibilityLabel={`Status: ${headline}`}>
              <View style={[s.pillDot, { backgroundColor: headlineTone }]} />
              <Text style={[s.pillText, { color: c.text }]}>{headline}</Text>
            </View>
          </View>

          {/* The app, first once the glasses and laptop are connected. */}
          {link.status === 'connected' ? (
            <Card title={state?.app ?? 'App'}>
              <Pressable
                onPress={() => link.setActive(!active)}
                disabled={!!blockedBy && !active}
                accessibilityRole="switch"
                accessibilityLabel="App"
                accessibilityValue={{ text: active ? 'On' : 'Off' }}
                accessibilityHint={active ? 'Stops the app and the microphone' : 'Starts the app and the microphone'}
                accessibilityState={{ checked: active, disabled: !!blockedBy && !active }}
                style={({ pressed }) => [s.power, { backgroundColor: active ? c.stop : c.go }, pressed ? s.pressed : null, blockedBy && !active ? s.disabled : null]}
              >
                <Text style={s.powerText}>{active ? '■  Stop' : '▶  Start'}</Text>
              </Pressable>
              <View style={s.phaseRow} accessibilityLiveRegion="polite">
                {active ? <Pulse color={phase === 'listening' ? c.ok : c.accent} active={phase !== 'off'} /> : null}
                <Text style={[s.phase, { color: c.text }]}>{!active ? blockedBy ?? 'Press Start, then just talk.' : PHASE_TEXT[phase] || state?.status}</Text>
              </View>
              {state?.problem ? <Text style={[s.help, { color: c.danger }]} accessibilityRole="alert">! {state.problem}</Text> : null}
              {active && state?.heard ? (
                <View style={s.turn}>
                  <Text style={[s.who, { color: c.textMuted }]}>You said</Text>
                  <Text style={[s.heard, { color: c.text }]}>“{state.heard}”</Text>
                </View>
              ) : null}
              {active && state?.said ? (
                <View style={s.turn} accessibilityLiveRegion="polite">
                  <Text style={[s.who, { color: c.textMuted }]}>{state.captions ? 'Captions' : 'App said'}</Text>
                  <Text style={[state.captions ? s.caption : s.said, { color: c.text }]}>{state.said}</Text>
                </View>
              ) : null}
              {active ? <TypeBox onSend={link.type} /> : null}
            </Card>
          ) : null}

          <Card title="Connect">
            <StatusRow
              tone={laptopRow.tone}
              title={laptopRow.title}
              detail={laptopRow.detail}
              action={laptop && !formOpen ? { label: 'Change', onPress: () => (setUrlInput(laptop.url), setCodeInput(laptop.token), setFormOpen(true)) } : undefined}
            >
              {!laptop && !formOpen ? <Button label="Type the address instead" kind="secondary" onPress={() => setFormOpen(true)} /> : null}
              {formOpen ? (
                <>
                  <Field label="Address on the dashboard" value={urlInput} onChangeText={setUrlInput} placeholder="http://192.168.1.20:3000" />
                  <Field label="Pairing code" value={codeInput} onChangeText={setCodeInput} placeholder="ABCD2345" />
                  <View style={s.row}>
                    <Button label="Connect" flex disabled={!urlInput.trim() || !codeInput.trim()} onPress={() => {
                      const l = cleanLaptop(urlInput, codeInput);
                      if (l) setLaptop(l);
                      setFormOpen(false);
                    }} />
                    <Button label="Cancel" kind="secondary" flex onPress={() => setFormOpen(false)} />
                  </View>
                </>
              ) : null}
              {link.status === 'replaced' && laptop ? <Button label="Use this phone again" kind="secondary" onPress={() => setLaptop({ ...laptop })} /> : null}
            </StatusRow>
            <Divider />
            <StatusRow
              tone={glassesRow.tone}
              title="Glasses"
              detail={glassesRow.detail}
              action={
                g.connected ? { label: 'Disconnect', onPress: forgetGlasses }
                : linkState === 'disconnected' ? { label: scanned ? 'Scan again' : 'Scan', onPress: () => void scan(), disabled: mentra.busy }
                : undefined
              }
            >
              {!g.connected && mentra.scan.devices.map((d) => <Button key={d.id} label={`Connect to ${d.name}`} kind="secondary" disabled={mentra.busy} onPress={() => void connect(d)} />)}
              {!g.connected && scanned && !mentra.scan.active && mentra.scan.devices.length === 0 ? (
                <Text style={[s.help, { color: c.textMuted }]}>No glasses found yet. Check they are switched on, and close the Mentra app and other XR apps, which can hold the connection.</Text>
              ) : null}
              {g.connected && Platform.OS === 'ios' ? (
                <Text style={[s.help, { color: c.textMuted }]}>To hear the app in the glasses, also pick them in Settings › Bluetooth. iPhone does not let an app do that.</Text>
              ) : null}
            </StatusRow>
            {g.connected ? (
              <>
                <Divider />
                <StatusRow
                  tone={wifiOn ? 'ok' : 'idle'}
                  title="Glasses Wi-Fi (optional)"
                  detail={wifiOn && wifi?.state === 'connected' ? `On “${wifi.ssid}”. Photos can go straight to the laptop.` : 'Off. Photos travel through this phone over Bluetooth, which is slower.'}
                  action={!wifiOn && !wifiOpen ? { label: 'Set up', onPress: () => setWifiOpen(true) } : undefined}
                >
                  {wifiOpen ? (
                    <>
                      <Field label="Network name" value={ssid} onChangeText={setSsid} />
                      <Field label="Password" value={password} onChangeText={setPassword} secure />
                      <View style={s.row}>
                        <Button label={joining ? 'Joining…' : 'Join'} flex disabled={!ssid.trim() || joining} onPress={() => void joinWifi()} />
                        <Button label="Cancel" kind="secondary" flex onPress={() => setWifiOpen(false)} />
                      </View>
                    </>
                  ) : null}
                </StatusRow>
              </>
            ) : null}
            {problem ? (
              <View style={[s.notice, { backgroundColor: c.dangerSoft, borderColor: c.danger }]} accessibilityRole="alert">
                <Text style={[s.noticeText, { color: c.text }]}>! {problem}</Text>
                <Button label="Dismiss" kind="quiet" size="small" onPress={() => setProblem('')} />
              </View>
            ) : null}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TypeBox(props: { onSend: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim()) props.onSend(text.trim());
    setText('');
  };
  if (!open) return <Button label="Type instead of speaking" kind="quiet" onPress={() => setOpen(true)} />;
  return (
    <View style={s.typeRow}>
      <View style={s.flex}>
        <Field label="Type what you would say" value={text} onChangeText={setText} autoFocus onSubmit={send} />
      </View>
      <Button label="Send" disabled={!text.trim()} onPress={send} />
    </View>
  );
}

function Divider() {
  const c = usePalette();
  return <View style={[s.divider, { backgroundColor: c.border }]} />;
}

// A text input with a label that stays visible.
function Field(props: { label: string; value: string; onChangeText: (t: string) => void; secure?: boolean; autoFocus?: boolean; placeholder?: string; onSubmit?: () => void }) {
  const c = usePalette();
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: c.textMuted }]}>{props.label}</Text>
      <TextInput
        style={[s.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]}
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

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  subtitle: { fontSize: type.caption, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { fontSize: type.title + 2, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  pillDot: { width: 8, height: 8, borderRadius: radius.pill },
  pillText: { fontSize: type.caption + 1, fontWeight: '700' },
  power: { minHeight: 96, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  powerText: { color: '#ffffff', fontSize: type.display, fontWeight: '800' },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  phase: { flex: 1, fontSize: type.lead, lineHeight: 25 },
  turn: { gap: space.xs },
  who: { fontSize: type.caption, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  heard: { fontSize: type.lead, lineHeight: 26, fontStyle: 'italic' },
  said: { fontSize: type.speech, lineHeight: 31 },
  caption: { fontSize: 30, lineHeight: 40, fontWeight: '700' },
  help: { fontSize: type.caption + 1, lineHeight: 20 },
  row: { flexDirection: 'row', gap: space.md },
  typeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  noticeText: { fontSize: type.body, lineHeight: 22 },
  field: { gap: space.xs },
  fieldLabel: { fontSize: type.caption + 1, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: radius.md, minHeight: 52, paddingHorizontal: space.md, fontSize: type.body },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
});
