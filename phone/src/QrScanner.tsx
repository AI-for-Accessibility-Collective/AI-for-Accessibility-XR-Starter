// "Scan QR code": reads the pairing QR code on a laptop's dashboard from
// inside the app, so a person can skip the Camera app. The code holds
// xrstarter://connect?url=…&token=… (storage.ts parses it). The phone
// vibrates and VoiceOver / TalkBack speaks when it finds the code, so a
// person who cannot see the screen knows to stop aiming. On iOS, VoiceOver's
// two-finger scrub cancels, the same as Android's back button.

import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { announce, useAnnounce, useFocusOn } from './a11y';
import { Button, Screen } from './components';
import { parsePairingLink, type Laptop } from './storage';
import { font, radius, space, type, usePalette } from './theme';

const WRONG = '! That QR code is from somewhere else. Scan the one on the dashboard.';

export function QrScanner(props: { onFound: (laptop: Laptop) => void; onCancel: () => void; onType?: () => void }) {
  const c = usePalette();
  const [camera, requestCamera] = useCameraPermissions();
  const [wrong, setWrong] = useState(false);
  const found = useRef(false);
  const lastWrong = useRef('');
  const titleRef = useRef<Text>(null);
  useFocusOn(titleRef);
  useAnnounce(wrong ? WRONG.slice(2) : '');

  useEffect(() => {
    if (camera && !camera.granted && camera.canAskAgain) void requestCamera();
  }, [camera?.granted, camera?.canAskAgain]);
  // Android's back button cancels, the same as ‹ Cancel.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      props.onCancel();
      return true;
    });
    return () => sub.remove();
  }, [props.onCancel]);

  // Called for each frame that shows a QR code, so it acts once per code.
  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (found.current) return;
    const laptop = parsePairingLink(data);
    if (laptop) {
      found.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      announce('Found the laptop. Connecting.');
      props.onFound(laptop);
    } else if (data !== lastWrong.current) {
      lastWrong.current = data;
      setWrong(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  };

  return (
    <Screen style={[s.root, { backgroundColor: c.bg }]} onAccessibilityEscape={props.onCancel}>
      <StatusBar barStyle="light-content" />
      <View style={s.top}>
        <Button label="‹ Cancel" kind="quiet" size="small" onPress={props.onCancel} />
        <Text ref={titleRef} style={[s.title, { color: c.text }]} accessibilityRole="header">Scan the QR code</Text>
        <View style={s.topSpacer} />
      </View>

      <View style={[s.cameraBox, { borderColor: c.border, backgroundColor: c.surface }]}>
        {camera?.granted ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScanned}
              accessibilityLabel="Camera view for scanning the QR code"
            />
            <View style={s.frameWrap} pointerEvents="none" importantForAccessibility="no-hide-descendants">
              <View style={s.frame} />
            </View>
          </>
        ) : (
          <View style={s.cameraOff}>
            <Text style={[s.body, s.center, { color: c.text }]}>Scanning uses this phone’s camera.</Text>
            {camera ? (
              camera.canAskAgain ? (
                <Button label="Allow the camera" onPress={() => void requestCamera()} />
              ) : (
                <Button label="Open Settings" onPress={() => void Linking.openSettings()} hint="Allow the camera for XR Starter" />
              )
            ) : null}
          </View>
        )}
      </View>

      <ScrollView style={s.bottomScroll} contentContainerStyle={s.bottom}>
        <Text style={[s.body, { color: c.text }]}>
          Point the camera at the QR code on your laptop, from about 30 cm (a foot) away. The phone vibrates when it finds the code.
        </Text>
        {wrong ? <Text style={[s.body, { color: c.warn }]}>{WRONG}</Text> : null}
        {props.onType ? <Button label="Type it in instead" kind="quiet" onPress={props.onType} /> : null}
      </ScrollView>
    </Screen>
  );
}

const FRAME = 220;

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm },
  title: { flex: 1, fontSize: type.lead, ...font('700'), textAlign: 'center' },
  topSpacer: { width: 88 },
  cameraBox: { flex: 1, minHeight: 140, marginHorizontal: space.md, marginTop: space.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cameraOff: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME, height: FRAME, borderRadius: radius.lg, borderWidth: 3, borderColor: '#ffffff' },
  // The words scroll at large text sizes, so the camera keeps some room.
  bottomScroll: { flexGrow: 0, flexShrink: 1 },
  bottom: { padding: space.lg, gap: space.md },
  body: { ...font(), fontSize: type.body, lineHeight: 23 },
  center: { textAlign: 'center' },
});
