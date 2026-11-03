# XR Starter phone app

The phone app links the Mentra Live glasses to a team's laptop. It can also
stand in for the glasses itself. The organiser builds it once and brings the
phone to the event. Teams do not change it.

It is a React Native (Expo) app on the
[Mentra Bluetooth SDK](https://docs.mentraglass.com/bluetooth-sdk/overview).
The code is adapted from the AI for Accessibility XR phone app, which was
tested on real glasses.

What it does:

- Holds the Bluetooth connection to the glasses, and reconnects on its own.
- Sends the glasses microphone to the laptop.
- Plays the laptop's voice clips. The phone routes them to the glasses speaker.
- Takes photos with the glasses camera. The glasses upload them to the laptop
  over Wi-Fi, or through the phone over Bluetooth.
- Sends glasses button presses to the laptop.
- Shows Start and Stop, what the app heard and said, and large captions when
  the profile asks for them.
- **Use this phone** (`src/PhoneGlasses.tsx`): the phone's
  camera, microphone and loudspeaker stand in for the glasses, and a round
  button on the screen is the glasses button (tap, or hold for a long press).
  The screen is laid out for a phone held sideways, and turns with the phone.
  The app starts when the screen connects, and **Exit** stops it. The glasses light shows over the
  camera. The laptop sees a simulator. Teams can try their app this way
  without glasses.

## Versions

The Bluetooth SDK and the glasses software must be the same release. This app
uses **SDK 3.1.1**, the same as the AI for Accessibility XR phone app, so the
same glasses work with both. If you update the glasses to a newer release,
change `@mentra/bluetooth-sdk` in `package.json` to match, run `bun install`,
and rebuild. See [Update Mentra Live](https://docs.mentraglass.com/bluetooth-sdk/software-update).

## Build it (iPhone)

You need a Mac with Xcode, an Apple developer account, and the iPhone on a
USB cable, unlocked.

```bash
cd phone
bun install
bun run ios:release
```

The first time, Xcode may ask for a signing team. Open
`ios/XRStarter.xcworkspace`, choose the **XRStarter** target, then **Signing &
Capabilities**, and pick your team. Then run `bun run ios:release` again.

Release builds run on their own. (`bun run ios` makes a development build,
which needs a Metro server on the laptop.)

If the build stops with "The iOS deployment target 'IPHONEOS_DEPLOYMENT_TARGET'
is set to 11.0", the `plugins/withPodsDeploymentTarget.js` plugin is missing
from `app.json`. Xcode 27 needs it.

Without the expo command, the same build by hand:

```bash
cd phone && bunx expo prebuild --platform ios && cd ios && pod install
xcodebuild -workspace XRStarter.xcworkspace -scheme XRStarter -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build/dd -allowProvisioningUpdates build
xcrun devicectl device install app --device <device id> build/dd/Build/Products/Release-iphoneos/XRStarter.app
```

(`xcrun devicectl list devices` shows the device id.)

## Build it (Android)

One codebase builds both apps. The iPhone and Android builds come from the
same `src/`, `app.json` and `package.json`, so a change to the app is a change
to both. The Android parts of `app.json` are the `android` block (package
name, permissions) and the Android settings under `expo-build-properties`.
Expo turns `scheme: "xrstarter"` into the Android intent filter that opens
the dashboard's QR link.

You need Java 17, the Android SDK (Android Studio installs it), and a phone
with USB debugging on, connected by cable. Point the tools at the SDK once:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"     # Linux: ~/Android/Sdk
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"  # macOS; Linux: your JDK 17 path
```

Then:

```bash
cd phone
bun install
bun run android:release          # builds and installs on the connected phone
```

Release builds run on their own. (`bun run android` makes a development build,
which needs a Metro server on the laptop.)

To hand the app to teams who bring Android phones, build an APK and share the
file. It is signed with the debug key, which is fine for a sideloaded event app.

```bash
cd phone && bunx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# the APK: android/app/build/outputs/apk/release/app-release.apk
```

On the phone, open the APK from a message or a download and allow installs
from that source when asked. Or install it by cable: `adb install app-release.apk`.

The repo's GitHub Actions workflow (`.github/workflows/android-apk.yml`)
builds this APK on each push that changes the phone app, and attaches it to
the run as an artifact, so an up-to-date APK is available without a build
machine. The iPhone build still needs a Mac and a signing team.

If Gradle fails on a native library, check that Java 17 is in use
(`java -version`), and that `plugins/withAndroid16KbPageSize.js` is still in
`app.json`.

## Share the app

Teams install the app on their own phones from a link. The dashboard shows
both links as QR codes, under **No XR Starter on the phone yet?**

**Android.** Push a tag:

```bash
git tag phone-v0.1.0 && git push origin phone-v0.1.0
```

The workflow (`.github/workflows/android-apk.yml`) builds the APK and
publishes it as a GitHub Release named `XR-Starter.apk`. This link always
gives the newest one:
https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR-Starter/releases/latest/download/XR-Starter.apk.
On the phone, open the link and allow the install.

**iPhone.** Apple allows installs from the App Store or TestFlight. Once:

1. In [App Store Connect](https://appstoreconnect.apple.com), create the app
   with bundle ID `edu.mit.media.xrstarter`.
2. On a Mac with Xcode signed in to the developer account, run
   `DEVELOPMENT_TEAM=<team ID> bun run ios:testflight`. It archives the app
   and uploads it.
3. In App Store Connect › TestFlight, add an external testing group, add the
   build, and turn on its public link. Apple reviews the first build, which
   can take a day.
4. Set `IOS_APP_URL` in `src/starter/config.ts` to the public link, so the
   dashboard shows it.

For a new version, run step 2 again and add the build to the group.

## Use it

The main screen shows one step at a time.

1. **Connect to your laptop.** Press **Scan QR code** and point the phone at
   the QR code on a team's dashboard. The phone vibrates when
   it finds the code. The phone's **Camera** app works too (on Android, the
   camera app or Google Lens). **Type it in instead** takes the address and
   pairing code shown under the QR code.
2. **Choose the glasses.** Press **Connect glasses**, then the glasses' name.
   The app remembers them and reconnects on its own. Or press **Use this
   phone** to use the phone as the glasses.
3. **The app.** Press **Start**. On an iPhone, also choose the glasses in
   Settings › Bluetooth, so the voice plays in the glasses. Android routes the
   voice to the glasses on its own. **More options** has the glasses' Wi-Fi,
   another laptop, and Disconnect.

Android asks for Bluetooth, location and microphone permission the first
time. Location is needed for the Bluetooth scan, and the phone's Location
setting has to be on.

In the phone simulator, hold the phone sideways. The screen turns with the
phone, also with the rotation lock on. The app starts when the phone
connects. **Exit** stops it and returns to the main screen. The phone
remembers which of the two you used last.

Close the Mentra app and other glasses apps first. One app at a time can hold the
Bluetooth connection.

## Accessibility

The app is built for teams that include blind, low-vision, Deaf,
hard-of-hearing and motor-impaired people. What it does:

- **Screen readers.** VoiceOver and TalkBack hear connection changes, Start
  and Stop, and problems (`src/a11y.ts`). The app's own words are left out,
  because the app speaks them. While the phone reads one of these messages,
  it holds back the microphone, so the app does not hear the phone. Each
  screen starts the reader on its title.
- **iOS gestures.** On the main screen, a two-finger double-tap starts and
  stops the app. In the phone simulator, it presses the glasses button, or
  starts the app again after it stopped. The two-finger scrub leaves the
  phone simulator and the scanner.
- **The glasses button.** Tap it or hold it. With a screen reader, the long
  press is in the actions. With Voice Control, say "Long press Glasses button".
- **Seeing the screen.** Text uses Atkinson Hyperlegible Next. Text and
  button colors meet WCAG AA in light and dark, and the phone's Increase
  Contrast (iOS) or High contrast text (Android) setting makes them stronger.
  Layouts follow the phone's text size: rows stack, and long words scroll
  while the controls stay on the screen. The glasses light shows its color as a word.
- **Hearing.** In the phone simulator, **Captions** shows what the person
  said and what the app said, and the phone remembers the choice. Captions
  from the profile show by themselves. The main screen shows the words while
  the app runs.
- **Speech.** **Type** in the phone simulator, and **Type instead of
  speaking** on the main screen, send typed words as if they were said.
- **Motion.** With Reduce Motion on, the dot holds still and the camera does
  not flash for a photo.
- **Holding the phone.** The phone simulator is laid out for a phone held
  sideways, because the glasses camera takes wide photos. Portrait works too,
  for a phone on a mount.

To check a change: try it with VoiceOver on, with the largest text size
(Settings › Accessibility › Display & Text Size), and with Increase Contrast.
In the phone simulator, VoiceOver plays through the speaker the microphone
hears, so it can reach the app as speech. The hint on the app's name says so
to VoiceOver users.

## Notes

- `app.json` allows plain `http://` addresses, because laptops on the same
  Wi-Fi do not have certificates. This is a development tool.
- With the glasses, the audio session is for playback. A recording session
  would switch the iPhone to hands-free Bluetooth, and the voice would stop
  reaching the glasses. The phone does not record: the glasses microphone
  arrives as data.
- As the glasses, the phone records and plays through its loudspeaker. The
  phone mic arrives through the SDK's `mic_pcm` event, the same event as the
  glasses mic (`setMicState(on, false)` picks the phone mic). Voice clips keep
  the audio session active, because expo-audio would otherwise switch it off
  after each clip, and the mic with it.
- Text uses Atkinson Hyperlegible Next (SIL Open Font License,
  `assets/fonts/OFL.txt`). The `expo-font` plugin in `app.json` builds it into
  the app. Text styles take it from `font()` or `italic` in `src/theme.ts`, so
  new text gets it too. Set the weight through `font('700')` in place of
  `fontWeight`.
- The scanner (`src/QrScanner.tsx`) reads QR codes with `expo-camera`. On
  Android, that needs the barcode scanner, which `app.json` leaves on.
- `plugins/withAndroid16KbPageSize.js` keeps the Android build working on
  phones with 16 KB memory pages. `usesCleartextTraffic` in `app.json` is the
  Android side of allowing plain `http://` to the laptop.
- On Android, the phone's back button leaves the phone simulator, the same as
  **Exit**.
