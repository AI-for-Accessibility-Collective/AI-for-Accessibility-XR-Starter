// Accessibility helpers shared by the screens.
//
//   announce()          speaks a message with VoiceOver / TalkBack. iOS ignores
//                       accessibilityLiveRegion and the 'alert' role, so the
//                       screens announce changes through this.
//   announcing()        true while one of those messages plays. The phone's
//                       speaker is close to the microphone, so link.ts drops
//                       mic audio then, and the app does not hear the phone.
//   useA11ySettings()   the person's settings: screen reader, reduce motion,
//                       more contrast. useA11y() adds the text size.
//   useFocusOn()        moves the screen reader to a screen's title when the
//                       screen opens.

import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { AccessibilityInfo, Platform, findNodeHandle, useWindowDimensions, type Text, type View } from 'react-native';

// Messages play one after another: on iOS a new announcement cuts off the
// one still playing.
let quietUntil = 0;
const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function next(): void {
  timer = null;
  const wait = quietUntil - Date.now();
  if (wait > 0) {
    timer = setTimeout(next, wait);
    return;
  }
  const message = queue.shift();
  if (!message) return;
  // About 15 characters a second at the usual speech rate, plus a margin.
  quietUntil = Date.now() + 800 + message.length * 70;
  AccessibilityInfo.announceForAccessibility(message);
  if (queue.length) timer = setTimeout(next, quietUntil - Date.now());
}

export function announce(message: string): void {
  if (!message || !settings.screenReader || queue.includes(message)) return;
  queue.push(message);
  if (!timer) next();
}

export const announcing = (): boolean => Date.now() < quietUntil || queue.length > 0;

if (Platform.OS === 'ios') {
  AccessibilityInfo.addEventListener('announcementFinished', () => {
    quietUntil = Math.min(quietUntil, Date.now() + 300);
    if (timer) clearTimeout(timer);
    timer = setTimeout(next, 300);
  });
}

// ── Settings, read once and kept up to date ───────────────────────────────
interface Settings {
  screenReader: boolean;
  reduceMotion: boolean;
  moreContrast: boolean; // iOS Increase Contrast, Android High contrast text
}
let settings: Settings = { screenReader: false, reduceMotion: false, moreContrast: false };
const listeners = new Set<() => void>();
const update = (patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  listeners.forEach((l) => l());
};

void AccessibilityInfo.isScreenReaderEnabled().then((v) => update({ screenReader: v }), () => {});
void AccessibilityInfo.isReduceMotionEnabled().then((v) => update({ reduceMotion: v }), () => {});
AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => update({ screenReader: v }));
AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => update({ reduceMotion: v }));
if (Platform.OS === 'ios') {
  void AccessibilityInfo.isDarkerSystemColorsEnabled().then((v) => update({ moreContrast: v }), () => {});
  AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (v: boolean) => update({ moreContrast: v }));
} else {
  void AccessibilityInfo.isHighTextContrastEnabled().then((v) => update({ moreContrast: v }), () => {});
  AccessibilityInfo.addEventListener('highTextContrastChanged', (v: boolean) => update({ moreContrast: v }));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useA11ySettings = (): Settings => useSyncExternalStore(subscribe, () => settings);

export function useA11y(): Settings & { largeText: boolean } {
  const s = useA11ySettings();
  // The phone's text size setting. Past about 1.3x, rows stack.
  const { fontScale } = useWindowDimensions();
  return { ...s, largeText: fontScale >= 1.3 };
}

// Announces `message` each time it changes to a non-empty value.
export function useAnnounce(message: string | null | undefined): void {
  const last = useRef('');
  useEffect(() => {
    if (message && message !== last.current) announce(message);
    last.current = message ?? '';
  }, [message]);
}

// Puts the screen reader on `ref` when the screen opens (and, with `when`,
// each time `when` turns true, and with `key`, each time `key` changes), so a
// person hears where they are. The short wait lets the screen finish drawing.
export function useFocusOn(ref: RefObject<View | Text | null>, when = true, key?: unknown): void {
  useEffect(() => {
    if (!when) return;
    const t = setTimeout(() => {
      const tag = ref.current ? findNodeHandle(ref.current) : null;
      if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
    }, 400);
    return () => clearTimeout(t);
  }, [when, key]);
}
