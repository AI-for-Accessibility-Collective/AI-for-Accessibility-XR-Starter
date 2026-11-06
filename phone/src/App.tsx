// XR Starter: the phone app. It connects the glasses to the app running on a
// laptop, and keeps its own logic small (see link.ts).
//
// The main screen shows one step at a time, each with one thing to do:
//   1. Laptop    scan the dashboard's QR code (QrScanner.tsx, or the Camera
//                app), or type the address in.
//   2. Glasses   connect Mentra Live, or use this phone as the glasses
//                (PhoneGlasses.tsx). The phone remembers both.
//   3. App       Start / Stop, what the app is doing, what it heard and said.
//                Settings for the glasses sit under More options.
//
// Built once by the organiser and shared at the event. Teams do not need to
// change it: their app runs on their laptop.
//
// Accessibility (a11y.ts): VoiceOver / TalkBack hear connection changes,
// Start and Stop, and problems, through announce(). The app's own words are
// not announced: the app speaks them. On iOS, a two-finger double-tap starts
// and stops the app.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import type { CameraView } from 'expo-camera';
import BluetoothSdk, { DeviceModels, type Device } from '@mentra/bluetooth-sdk';
import { useBluetoothEvent, useMentraBluetooth } from '@mentra/bluetooth-sdk/react';
import type { Phase } from '../../src/starter/protocol.ts';
import { announce, useAnnounce, useFocusOn } from './a11y';
import { Button, Card, Field, Logo, Pulse, Screen, StatusRow, TypeBox, startHint } from './components';
import { useLink, type PhoneParts } from './link';
import { PhoneGlasses } from './PhoneGlasses';
import { QrScanner } from './QrScanner';
import { cleanLaptop, glassesStore, laptopStore, modeStore, parsePairingLink, type Laptop, type Mode } from './storage';
import { DarkScreen, font, italic, radius, space, type, usePalette } from './theme';

// Android asks for these at run time (iOS asks on first use, from the
// descriptions in app.json). Location is on the list because Android 12+
// delivers no scan results without it. Notifications are left out: the SDK's
// connection notice is optional, and each prompt is one more step.
// After a second refusal Android stops asking, and Settings is the way back.
async function androidPermissions(): Promise<'granted' | 'refused' | 'settings'> {
  if (Platform.OS !== 'android') return 'granted';
  const needed = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ];
  const results = Object.values(await PermissionsAndroid.requestMultiple(needed));
  const { GRANTED, NEVER_ASK_AGAIN } = PermissionsAndroid.RESULTS;
  return results.every((r) => r === GRANTED) ? 'granted' : results.includes(NEVER_ASK_AGAIN) ? 'settings' : 'refused';
}

// Expo wraps a native error as "Call to function 'X' has been rejected.
// → Caused by: <reason>". The reason is the part a person can act on.
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('→ Caused by:').pop()!.trim();
const errorCode = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String(e.code) : '');
const updateErrorText = (reason?: string) =>
  reason === 'no_internet' ? 'The glasses’ Wi-Fi has no internet connection. Connect them to another network, then try again.'
  : reason ? `The glasses reported: ${reason.replace(/_/g, ' ')}.`
  : 'The glasses stopped the update.';

export default function App() {
  useKeepAwake();
  const c = usePalette();
  const scheme = useColorScheme();
  // What went wrong, and whether Settings is where to fix it.
  const [{ problem, inSettings }, setProblemState] = useState({ problem: '', inSettings: false });
  const setProblem = (text: string, settings = false) => setProblemState({ problem: text, inSettings: settings });

  // ── Laptop ────────────────────────────────────────────────────────────────
  const [laptop, setLaptopState] = useState<Laptop | null>(() => laptopStore.load());
  const [reached, setReached] = useState(false); // the laptop answered since it was chosen
  const setLaptop = (l: Laptop | null) => {
    laptopStore.save(l);
    setLaptopState(l);
    setReached(false);
  };
  const [formOpen, setFormOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  // Android's back button closes the address form, as Cancel does.
  useEffect(() => {
    if (!formOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setFormOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [formOpen]);

  // The dashboard's QR code opens xrstarter://connect?url=…&token=…
  useEffect(() => {
    const use = (link: string | null) => {
      const l = link ? parsePairingLink(link) : null;
      if (l) {
        setLaptop(l);
        setFormOpen(false);
        setScanning(false);
      }
    };
    void Linking.getInitialURL().then(use);
    const sub = Linking.addEventListener('url', (e) => use(e.url));
    return () => sub.remove();
  }, []);

  // ── Glasses ───────────────────────────────────────────────────────────────
  // Bluetooth switched off shows on the glasses card, with a way to turn it on.
  // Other errors show in the notice at the bottom.
  const [bluetoothOff, setBluetoothOff] = useState(false);
  const glassesError = (e: unknown, prefix = '') => {
    if (errorCode(e) === 'bluetooth_powered_off') setBluetoothOff(true);
    else setProblem(prefix + errorText(e));
  };
  const mentra = useMentraBluetooth({
    autoConnectDefault: true,
    defaultDeviceStorage: glassesStore,
    defaultModel: DeviceModels.MentraLive,
    scanTimeoutMs: 10_000,
    onError: (e) => glassesError(e),
  });
  const g = mentra.glasses;
  const wifi = g.connected ? g.wifi : null;
  const wifiOn = wifi ? wifi.state === 'connected' : null;
  const battery = g.connected ? g.battery.level : null;
  // The name to look for in Bluetooth settings.
  const glassesName = (g.connected ? g.device.bluetoothName : undefined) ?? mentra.defaultDevice?.name ?? null;
  const [scanned, setScanned] = useState(false);

  // ── Glasses software ──────────────────────────────────────────────────────
  // The SDK works with the glasses software of its own release. Older glasses
  // connect, and then their mic, button and camera fail, so the app checks
  // after each connection and asks for the update before Start. The glasses
  // download it over their Wi-Fi and restart during it, and the update goes
  // on after each restart.
  const [update, setUpdate] = useState<'unknown' | 'checking' | 'current' | 'needed' | 'running' | 'failed'>('unknown');
  const [updatePercent, setUpdatePercent] = useState(0);
  const [updateError, setUpdateError] = useState('');
  const ready = g.connected && g.ready;
  const checks = useRef(0);
  const checkGlasses = () => {
    const id = ++checks.current;
    setUpdate('checking');
    BluetoothSdk.checkForOtaUpdate().then(
      (needed) => id === checks.current && setUpdate(needed ? 'needed' : 'current'),
      // Without an answer (no internet on the phone), the glasses are used as they are.
      () => id === checks.current && setUpdate('current'),
    );
  };
  useEffect(() => {
    if (!ready) {
      if (update !== 'running') {
        checks.current++;
        setUpdate('unknown');
      }
    } else if (update === 'running') {
      // Back after a restart during the update: finished when nothing is left to install.
      const id = ++checks.current;
      BluetoothSdk.checkForOtaUpdate().then((needed) => id === checks.current && !needed && setUpdate('current'), () => {});
    } else checkGlasses();
  }, [ready]);
  const [updateTick, setUpdateTick] = useState(0); // one per report from the glasses
  useBluetoothEvent('ota_status', (e) => {
    setUpdateTick((n) => n + 1);
    if (e.status === 'in_progress' || e.status === 'step_complete') {
      setUpdate('running');
      setUpdatePercent(e.overall_percent);
    } else if (e.status === 'complete' && update === 'running') {
      announce('The glasses update finished.');
      checkGlasses();
    } else if (e.status === 'failed' && update === 'running') {
      // On connecting, the glasses also report an earlier update. It counts during an update only.
      setUpdate('failed');
      setUpdateError(updateErrorText(e.error_message));
    }
  });
  // Glasses that go quiet: older software accepts the update and then does
  // nothing when its Wi-Fi has no internet. Limits as in Mentra's own update
  // flow: 90 s to begin, and 6 min between reports once it runs (a system
  // install reports little). A restart in between does not count.
  useEffect(() => {
    if (update !== 'running' || !g.connected) return;
    const started = updatePercent > 0;
    const timer = setTimeout(() => {
      setUpdate('failed');
      setUpdateError(
        started
          ? 'The glasses stopped reporting progress. Switch them off and on, then try again.'
          : 'The glasses did not begin the download. Their Wi-Fi may have no internet: join a phone hotspot, then try again.',
      );
    }, started ? 6 * 60_000 : 90_000);
    return () => clearTimeout(timer);
  }, [update, g.connected, updatePercent > 0, updateTick]);
  const startUpdate = async () => {
    setUpdateError('');
    setUpdatePercent(0);
    setUpdate('running');
    try {
      await BluetoothSdk.startOtaUpdate();
    } catch (e) {
      setUpdate('failed');
      setUpdateError(errorText(e));
    }
  };

  // Speech reaches the glasses through the phone's Bluetooth media audio,
  // which the phone connects next to the SDK's own link. Until it does, the
  // phone's speaker plays it.
  const [glassesAudio, setGlassesAudio] = useState(false);
  useBluetoothEvent('audio_connected', () => setGlassesAudio(true));
  useBluetoothEvent('audio_disconnected', () => setGlassesAudio(false));
  useBluetoothEvent('audio_pairing_needed', () => setGlassesAudio(false));

  // The glasses button belongs to the app: no gallery photo on a press.
  // Straight to the SDK, so a slow answer from the glasses stays out of the notice.
  useEffect(() => {
    if (ready && update === 'current') void BluetoothSdk.setGalleryModeEnabled(false).catch(() => {});
  }, [ready, update === 'current']);

  // ── This phone as the glasses ─────────────────────────────────────────────
  const [mode, setModeState] = useState<Mode>(() => modeStore.load());
  const setMode = (m: Mode) => {
    modeStore.save(m);
    setModeState(m);
  };
  // Asked before the phone connects as the glasses, so the mic works from the first word.
  const [micAllowed, setMicAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode !== 'phone') return;
    void requestRecordingPermissionsAsync().then(
      (r) => setMicAllowed(r.granted),
      () => setMicAllowed(false),
    );
  }, [mode]);
  const cameraRef = useRef<CameraView | null>(null);
  const cameraReady = useRef(false);
  const phone = useMemo<PhoneParts | null>(
    () =>
      mode !== 'phone' ? null : {
        takePhoto: async () => {
          const cam = cameraRef.current;
          if (!cam || !cameraReady.current) throw new Error('the phone camera is off. Allow the camera for XR Starter in Settings.');
          const picture = await cam.takePictureAsync({ quality: 0.7 });
          return picture.uri;
        },
      },
    [mode],
  );

  const link = useLink(
    mode === 'phone' && micAllowed === null ? null : laptop,
    { connected: g.connected, wifi: wifiOn, battery, ssid: wifi?.state === 'connected' ? wifi.ssid : null, ip: wifi?.state === 'connected' ? (wifi.localIp ?? null) : null },
    phone,
  );
  const state = link.state;
  const active = !!state?.active;
  const phase: Phase = state?.phase ?? 'off';

  const scan = async () => {
    setProblem('');
    const allowed = await androidPermissions();
    if (allowed !== 'granted') {
      return allowed === 'settings'
        ? setProblem('To find your glasses, allow Nearby devices, Location and Microphone for XR Starter in Settings › Permissions.', true)
        : setProblem('Allow Bluetooth, location and the microphone to find your glasses. Android needs location to scan for Bluetooth devices.');
    }
    setBluetoothOff(false);
    try {
      await mentra.scan.start();
      setScanned(true);
    } catch (e) {
      glassesError(e);
    }
  };
  const connect = async (device: Device) => {
    setProblem('');
    try {
      await mentra.connect(device);
      await mentra.setDefaultDevice(device);
    } catch (e) {
      glassesError(e, `Could not connect to ${device.name}. `);
    }
  };
  // Android asks "Turn on Bluetooth?" over the app. iOS leaves it to Control
  // Center. Back in the app, the search starts again, after Bluetooth has had
  // a moment to switch on.
  const turnOnBluetooth = () =>
    void Linking.sendIntent('android.bluetooth.adapter.action.REQUEST_ENABLE')
      .catch(() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS'))
      .catch(() => {});
  const scanRef = useRef(scan);
  scanRef.current = scan;
  useEffect(() => {
    if (!bluetoothOff) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = AppState.addEventListener('change', (now) => {
      if (now !== 'active') return;
      clearTimeout(timer);
      timer = setTimeout(() => void scanRef.current(), 1500);
    });
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [bluetoothOff]);
  // The phone keeps trying the pair it connected to last. With several pairs
  // in the room, this stops that and lets the person pick another from the list.
  const switchGlasses = async () => {
    setProblem('');
    try {
      await BluetoothSdk.cancelConnectionAttempt().catch(() => {});
      await BluetoothSdk.forget().catch(() => {});
      await mentra.clearDefaultDevice();
      await scan();
    } catch (e) {
      glassesError(e);
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
      // The glasses fall back to a network they know when the new one fails,
      // and then report "connected" to that one. Joined means joined the one asked for.
      if (r.state === 'connected' && r.ssid === ssid.trim()) {
        setPassword('');
        setWifiOpen(false);
      } else if (r.error === 'wrong_password') setProblem('That Wi-Fi password did not work.');
      else if (r.state === 'connected') setProblem(`The glasses could not find “${ssid.trim()}” and stayed on “${r.ssid}”. Check the network name, and that the network is on and uses 2.4 GHz.`);
      else setProblem(`The glasses could not join “${ssid.trim()}”.`);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setJoining(false);
    }
  };

  // ── Where the person is ───────────────────────────────────────────────────
  const linkState = g.connected ? 'connected' : g.connection.state;
  const blockedBy =
    link.status !== 'connected' ? 'Connecting to the laptop…'
    : !g.connected ? 'Connect the glasses first.'
    : update === 'unknown' || update === 'checking' ? 'Checking the glasses software…'
    : update !== 'current' ? 'Update the glasses first.'
    : null;
  const toggleApp = () => {
    if (active || (link.status === 'connected' && (mode === 'phone' || !blockedBy))) link.setActive(!active);
  };
  const enterPhone = () => {
    if (active) link.setActive(false);
    setMode('phone');
  };

  // ── What the screen reader hears ─────────────────────────────────────────
  // Connection news, once per change. The laptop restarts each time a team
  // saves a file, so "Cannot reach" waits until the laptop stays away 5 s,
  // and until then the screen stays on its step.
  const [news, setNews] = useState('');
  const [away, setAway] = useState(false);
  const awayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (link.status === 'offline' || link.status === 'connecting') {
      if (!awayTimer.current) {
        awayTimer.current = setTimeout(() => {
          setAway(true);
          setNews('Cannot reach the laptop. Retrying.');
        }, 5000);
      }
      return;
    }
    if (awayTimer.current) clearTimeout(awayTimer.current);
    awayTimer.current = null;
    setAway(false);
    if (link.status === 'connected') {
      setReached(true);
      setNews('Connected to the laptop.');
    } else if (link.status === 'refused') setNews('Scan the QR code again. The laptop has a new pairing code.');
    else if (link.status === 'replaced') setNews('Another phone took over on the laptop.');
  }, [link.status, link.detail]);
  useEffect(() => () => void (awayTimer.current && clearTimeout(awayTimer.current)), []);
  useAnnounce(news);
  useAnnounce(state?.problem ? `Problem: ${state.problem}` : '');
  useAnnounce(problem ? `Problem: ${problem}` : '');
  useAnnounce(update === 'failed' ? `Problem: the glasses update stopped. ${updateError}` : '');
  // Start, Stop and the glasses: on a change, and not for the first value.
  const wasActive = useRef<boolean | null>(null);
  useEffect(() => {
    if (!state) return;
    if (wasActive.current !== null && wasActive.current !== active) announce(`${state.app} ${active ? 'started' : 'stopped'}.`);
    wasActive.current = active;
  }, [state != null, active]);
  const wasGlasses = useRef(g.connected);
  useEffect(() => {
    if (mode === 'glasses' && wasGlasses.current !== g.connected) announce(g.connected ? 'Glasses connected.' : 'Glasses disconnected.');
    wasGlasses.current = g.connected;
  }, [g.connected]);

  // One step at a time: the laptop, then the glasses, then the app.
  // A running update stays on screen while the glasses restart, and needs no laptop.
  const step: 'laptop' | 'glasses' | 'update' | 'app' =
    update === 'running' ? 'update'
    : !laptop || formOpen || !reached || away || link.status === 'refused' || link.status === 'replaced' ? 'laptop'
    : !g.connected ? 'glasses'
    : update === 'needed' || update === 'failed' ? 'update'
    : 'app';
  // Back on this screen, or on a new step: the screen reader starts at the step's title.
  const titleRef = useRef<Text>(null);
  useFocusOn(titleRef, !scanning && mode === 'glasses', step);
  const [moreOpen, setMoreOpen] = useState(false);

  // One camera screen at a time: the scanner replaces the rest while it is open.
  if (scanning) {
    return (
      <DarkScreen>
        <QrScanner
          onFound={(l) => {
            setLaptop(l);
            setFormOpen(false);
            setScanning(false);
          }}
          onCancel={() => setScanning(false)}
          onType={mode === 'phone' ? undefined : () => {
            setUrlInput(laptop?.url ?? '');
            setCodeInput(laptop?.token ?? '');
            setFormOpen(true);
            setScanning(false);
          }}
        />
      </DarkScreen>
    );
  }

  if (mode === 'phone') {
    return (
      <DarkScreen>
        <PhoneGlasses
          link={link}
          hasLaptop={!!laptop}
          micAllowed={micAllowed !== false}
          cameraRef={cameraRef}
          onCameraReady={(ready) => (cameraReady.current = ready)}
          onReconnect={() => laptop && setLaptop({ ...laptop })}
          onScan={() => setScanning(true)}
          onLeave={() => {
            if (active) link.setActive(false);
            setMode('glasses');
          }}
        />
      </DarkScreen>
    );
  }

  // On the glasses step it sits under the glasses card, next to the button that caused it.
  const problemNotice = problem ? (
    <View style={[s.notice, { backgroundColor: c.dangerSoft, borderColor: c.danger }]}>
      <Text style={[s.noticeText, { color: c.text }]}>{problem}</Text>
      {inSettings ? <Button label="Open Settings" size="small" onPress={() => void Linking.openSettings()} /> : null}
      <Button label="Dismiss" kind="quiet" size="small" onPress={() => setProblem('')} />
    </View>
  ) : null;

  // ── Step 1: the laptop ──────────────────────────────────────────────────
  const laptopCopy =
    formOpen ? { title: 'Connect to your laptop', text: 'Type the address and the pairing code from the dashboard. They are under “The phone cannot connect?”.' }
    : !laptop ? { title: 'Connect to your laptop', text: 'On your laptop, run “bun run dev” and open the dashboard. Then scan the QR code on it.' }
    : link.status === 'refused' ? { title: 'Scan the QR code again', text: 'The laptop has a new pairing code.' }
    : link.status === 'replaced' ? { title: 'Another phone took over', text: 'Another phone is connected to this laptop.' }
    : away ? { title: 'Cannot reach your laptop', text: 'Check that “bun run dev” is running on the laptop, and that the phone and the laptop are on the same Wi-Fi. Retrying…' }
    : { title: 'Connecting to your laptop…', text: '' };
  const laptopStep = (
    <>
      <Text ref={titleRef} style={[s.stepTitle, { color: c.text }]} accessibilityRole="header">{laptopCopy.title}</Text>
      {laptopCopy.text ? <Text style={[s.body, { color: c.textMuted }]}>{laptopCopy.text}</Text> : null}
      {formOpen ? (
        <>
          <Field label="Address" value={urlInput} onChangeText={setUrlInput} placeholder="http://192.168.1.20:3000" />
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
      ) : link.status === 'replaced' && laptop ? (
        <>
          <Button label="Use this phone again" size="large" onPress={() => setLaptop({ ...laptop })} />
          <Button label="Scan QR code" kind="quiet" onPress={() => setScanning(true)} />
        </>
      ) : (
        <>
          <Button label="Scan QR code" size="large" kind={laptop && !away && link.status !== 'refused' ? 'secondary' : 'primary'} onPress={() => setScanning(true)} />
          {!laptop ? <Button label="Type it in instead" kind="quiet" onPress={() => setFormOpen(true)} /> : null}
        </>
      )}
    </>
  );

  // ── Step 2: the glasses ─────────────────────────────────────────────────
  const devices = mentra.scan.devices;
  const searching = mentra.scan.active || linkState === 'scanning';
  const glassesText =
    bluetoothOff ? (Platform.OS === 'android' ? 'Bluetooth is off on this phone. The glasses connect over Bluetooth.' : 'Bluetooth is off on this phone. Turn it on in Control Center, then search again.')
    : searching ? 'Looking for glasses nearby…'
    : linkState !== 'disconnected' ? `Connecting to ${mentra.defaultDevice?.name ?? 'the glasses'}…`
    : devices.length ? 'Choose your glasses.'
    : scanned ? 'No glasses found. Check that they are switched on and close to this phone. Close the Mentra app, which can hold the connection.'
    : 'Switch the glasses on and keep them close to this phone.';
  const glassesStep = (
    <>
      <View style={s.doneRow}>
        <View style={[s.dot, { backgroundColor: c.ok }]} />
        <Text style={[s.doneText, { color: c.text }]}>Connected to your laptop</Text>
        <Button label="Change" kind="quiet" size="small" hint="Scans the QR code of another laptop" onPress={() => setScanning(true)} />
      </View>
      <Text ref={titleRef} style={[s.stepTitle, { color: c.text }]} accessibilityRole="header">Choose the glasses</Text>
      <Card>
        <Text style={[s.choiceTitle, { color: c.text }]} accessibilityRole="header">Mentra Live glasses</Text>
        <Text style={[s.body, { color: c.textMuted }]}>{glassesText}</Text>
        {bluetoothOff ? null : devices.map((d) => <Button key={d.id} label={`Connect to ${d.name}`} disabled={mentra.busy} onPress={() => void connect(d)} />)}
        {bluetoothOff ? (
          Platform.OS === 'android' ? <Button label="Turn on Bluetooth" onPress={turnOnBluetooth} /> : <Button label="Search again" onPress={() => void scan()} />
        ) : linkState === 'disconnected' && !searching && !devices.length ? (
          <Button label={scanned ? 'Search again' : 'Connect glasses'} disabled={mentra.busy} onPress={() => void scan()} />
        ) : linkState !== 'disconnected' && !searching && !g.connected ? (
          <Button label="Connect to a different pair" kind="secondary" hint="Stops this attempt and searches for glasses nearby" onPress={() => void switchGlasses()} />
        ) : null}
      </Card>
      {problemNotice}
      <Card>
        <Text style={[s.choiceTitle, { color: c.text }]} accessibilityRole="header">This phone</Text>
        <Text style={[s.body, { color: c.textMuted }]}>No glasses? The phone’s camera, microphone and speaker stand in for them.</Text>
        <Button label="Use this phone" hint="The phone acts as the glasses. Hold it sideways at eye level." onPress={enterPhone} />
      </Card>
    </>
  );

  // The glasses' Wi-Fi: for the update, and for quicker photos.
  const wifiForm = (
    <>
      <Field label="Network name" value={ssid} onChangeText={setSsid} />
      <Field label="Password" value={password} onChangeText={setPassword} secure />
      <View style={s.row}>
        <Button label={joining ? 'Joining…' : 'Join'} flex disabled={!ssid.trim() || joining} onPress={() => void joinWifi()} />
        <Button label="Cancel" kind="secondary" flex onPress={() => setWifiOpen(false)} />
      </View>
    </>
  );

  // ── Step 3, when the glasses need it: the update ────────────────────────
  const updateText =
    update === 'running'
      ? g.connected ? `Updating the glasses… ${updatePercent}%` : 'The glasses are restarting as part of the update. This phone reconnects to them on its own.'
    : update === 'failed' ? `The update stopped. ${updateError}`
    : 'These glasses need a software update to work with XR Starter. They download it over Wi-Fi.';
  const updateAction =
    update === 'running' || !g.connected ? null
    : wifiOpen ? wifiForm
    : !wifiOn ? (
      <>
        <Text style={[s.body, { color: c.textMuted }]}>First, connect the glasses to a Wi-Fi network with internet.</Text>
        <Button label="Connect the glasses to Wi-Fi" size="large" onPress={() => setWifiOpen(true)} />
      </>
    ) : (
      <>
        {wifi?.state === 'connected' ? <Text style={[s.body, { color: c.textMuted }]}>Glasses Wi-Fi: {wifi.ssid}</Text> : null}
        <Button label={update === 'failed' ? 'Try again' : 'Update the glasses'} size="large" onPress={() => void startUpdate()} />
        {update === 'failed' ? <Button label="Change the Wi-Fi" kind="quiet" onPress={() => setWifiOpen(true)} /> : null}
      </>
    );
  const updateStep = (
    <>
      <Text ref={titleRef} style={[s.stepTitle, { color: c.text }]} accessibilityRole="header">Update the glasses</Text>
      <Card>
        <Text style={[s.body, { color: c.text }]}>{updateText}</Text>
        {update === 'running' ? (
          <>
            <View
              style={[s.progress, { backgroundColor: c.surfaceAlt }]}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Update progress"
              accessibilityValue={{ min: 0, max: 100, now: updatePercent }}
            >
              <View style={[s.progressFill, { width: `${updatePercent}%`, backgroundColor: c.accentFill }]} />
            </View>
            <Text style={[s.body, { color: c.textMuted }]}>Keep the glasses switched on and close to this phone, with XR Starter open. They restart during the update.</Text>
          </>
        ) : updateAction}
      </Card>
      {update === 'running' ? null : <Button label="Use this phone as the glasses instead" kind="quiet" onPress={enterPhone} />}
    </>
  );

  // ── Step 3: the app ─────────────────────────────────────────────────────
  // Stop works at any time. Start waits for the laptop and the glasses.
  const startable = active || !blockedBy;
  const appStatus = active ? state?.status ?? '' : blockedBy ?? 'Ready';
  const appStep = (
    <>
      <Card>
        <View style={s.appHead}>
          <Text ref={titleRef} style={[s.stepTitle, { color: c.text }]} accessibilityRole="header">{state?.app ?? 'Your app'}</Text>
          <View style={s.statusLine}>
            <View style={s.dotBox}>
              {active ? (
                <Pulse color={phase === 'listening' ? c.ok : c.accent} active={phase !== 'off'} />
              ) : (
                <View style={[s.dot, { backgroundColor: blockedBy ? c.warn : c.ok }]} />
              )}
            </View>
            <Text style={[s.statusText, { color: c.textMuted }]}>{appStatus}</Text>
          </View>
        </View>
        <Pressable
          onPress={toggleApp}
          disabled={!startable}
          accessibilityRole="button"
          accessibilityLabel={active ? 'Stop' : 'Start'}
          accessibilityHint={startable ? startHint(active, state?.app) : blockedBy ?? undefined}
          accessibilityState={{ disabled: !startable }}
          style={({ pressed }) => [s.power, { backgroundColor: !startable ? c.surfaceAlt : active ? c.stop : c.go }, pressed ? s.pressed : null]}
        >
          <Text style={[s.powerText, { color: startable ? '#ffffff' : c.textMuted }]}>{active ? 'Stop' : 'Start'}</Text>
        </Pressable>
        {state?.problem ? (
          <View style={[s.notice, { backgroundColor: c.dangerSoft, borderColor: c.danger }]}>
            <Text style={[s.noticeText, { color: c.text }]}>{state.problem}</Text>
          </View>
        ) : null}
        {active && state?.heard ? (
          <View style={s.turn} accessible accessibilityLabel={`You said: ${state.heard}`}>
            <Text style={[s.who, { color: c.textMuted }]}>You</Text>
            <Text style={[s.heard, { color: c.text }]}>{state.heard}</Text>
          </View>
        ) : null}
        {active && state?.said ? (
          <View style={s.turn} accessible accessibilityLabel={`${state.captions ? 'Captions' : state.app}: ${state.said}`}>
            <Text style={[s.who, { color: c.textMuted }]}>{state.captions ? 'Captions' : state.app}</Text>
            <Text style={[state.captions ? s.caption : s.said, { color: c.text }]}>{state.said}</Text>
          </View>
        ) : null}
        {active ? <TypeBox onSend={link.type} /> : null}
      </Card>

      <View style={s.doneRow}>
        <View style={[s.dot, { backgroundColor: c.ok }]} />
        <Text style={[s.doneText, { color: c.text }]}>Glasses connected{battery != null ? ` · Battery ${battery}%` : ''}</Text>
      </View>
      {glassesName ? (
        <Text selectable style={[s.help, { color: c.textMuted }]}>
          {glassesName}
        </Text>
      ) : null}
      {Platform.OS === 'ios' ? (
        <Text style={[s.help, { color: c.textMuted }]}>For sound, choose the glasses in Control Center › AirPlay.</Text>
      ) : glassesAudio ? null : (
        <View style={s.hint}>
          <Text style={[s.help, { color: c.textMuted }]}>
            If the app’s voice comes from this phone, open Bluetooth settings, tap {glassesName ?? 'the glasses'} and turn on Media audio.
          </Text>
          <Button label="Bluetooth settings" kind="secondary" size="small" onPress={() => void Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {})} />
        </View>
      )}

      <Pressable
        onPress={() => setMoreOpen(!moreOpen)}
        accessibilityRole="button"
        accessibilityLabel="More options"
        accessibilityState={{ expanded: moreOpen }}
        style={({ pressed }) => [s.moreHead, pressed ? s.pressed : null]}
      >
        <Text style={[s.moreText, { color: c.accent }]}>More options</Text>
        <Text style={[s.moreText, { color: c.accent }]}>{moreOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {moreOpen ? (
        <Card>
          <StatusRow
            tone={wifiOn ? 'ok' : 'idle'}
            title="Glasses Wi-Fi"
            detail={wifiOn && wifi?.state === 'connected' ? `On “${wifi.ssid}”. Photos go straight to the laptop.` : 'Off. Photos reach the laptop faster over Wi-Fi.'}
            action={wifiOpen ? undefined : { label: wifiOn ? 'Change' : 'Set up', onPress: () => setWifiOpen(true) }}
          >
            {wifiOpen ? wifiForm : null}
          </StatusRow>
          <Divider />
          <Button label="Use this phone as the glasses" kind="secondary" onPress={enterPhone} />
          <Button label="Connect to another laptop" kind="secondary" onPress={() => setScanning(true)} />
          <Button label="Disconnect the glasses" kind="secondary" onPress={forgetGlasses} />
        </Card>
      ) : null}
    </>
  );

  return (
    <Screen style={[s.root, { backgroundColor: c.bg }]} onMagicTap={toggleApp}>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header} accessible accessibilityLabel="ai4a11y XR Starter">
            <Logo />
            <Text style={[s.title, { color: c.text }]}>XR Starter</Text>
          </View>
          {step === 'laptop' ? laptopStep : step === 'glasses' ? glassesStep : step === 'update' ? updateStep : appStep}
          {step === 'glasses' ? null : problemNotice}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Divider() {
  const c = usePalette();
  return <View style={[s.divider, { backgroundColor: c.border }]} />;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, marginBottom: space.lg },
  title: { flexShrink: 1, fontSize: type.title, ...font('800') },
  stepTitle: { fontSize: type.display, lineHeight: 34, ...font('800') },
  choiceTitle: { fontSize: type.lead, ...font('700') },
  body: { ...font(), fontSize: type.body, lineHeight: 24 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  doneText: { ...font('600'), flex: 1, fontSize: type.body },
  appHead: { gap: space.xs },
  // The dot sits on the first line of the status, which can wrap.
  statusLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dotBox: { height: 23, justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: radius.pill },
  statusText: { ...font(), flexShrink: 1, fontSize: type.body, lineHeight: 23 },
  power: { minHeight: 60, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  powerText: { fontSize: type.lead + 1, ...font('700') },
  turn: { gap: space.xs },
  who: { fontSize: type.caption, ...font('700'), letterSpacing: 0.8, textTransform: 'uppercase' },
  heard: { ...italic, fontSize: type.lead, lineHeight: 26 },
  said: { ...font(), fontSize: type.speech, lineHeight: 31 },
  caption: { fontSize: 30, lineHeight: 40, ...font('700') },
  help: { ...font(), fontSize: type.caption + 1, lineHeight: 20 },
  moreHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, marginTop: space.sm },
  moreText: { ...font('600'), fontSize: type.body },
  row: { flexDirection: 'row', gap: space.md },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  hint: { gap: space.sm, alignItems: 'flex-start' },
  progress: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%' },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  noticeText: { ...font(), fontSize: type.body, lineHeight: 22 },
  pressed: { opacity: 0.8 },
});
