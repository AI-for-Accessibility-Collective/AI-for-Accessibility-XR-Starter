# XR Starter phone app

The phone app links the Mentra Live glasses to a team's laptop. The
organiser builds it once and brings the phone to the event. Teams do not
change it.

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

```bash
cd phone
bun install
bun run android:release          # installs on a phone connected by USB
```

To share an APK with teams who bring Android phones, build it with
`cd android && ./gradlew assembleRelease`. The file is
`android/app/build/outputs/apk/release/app-release.apk`.

## Use it

1. Open **XR Starter**. Under **Glasses**, press **Scan**, then **Connect to …**.
   The app remembers the glasses.
2. On an iPhone, also choose the glasses in Settings › Bluetooth, so the voice
   plays in the glasses.
3. Point the phone's **Camera** app at the QR code on a team's dashboard and tap
   **Open in XR Starter**. Or press **Type the address instead** and enter the
   address and pairing code shown under the QR code.
4. Press **▶ Start**.

Close the Mentra app and other glasses apps first. One app at a time can hold the
Bluetooth connection.

## Notes

- `app.json` allows plain `http://` addresses, because laptops on the same
  Wi-Fi do not have certificates. This is a development tool.
- The audio session is for playback. A recording session would switch the
  iPhone to hands-free Bluetooth, and the voice would stop reaching the
  glasses. The phone does not record: the glasses microphone arrives as data.
- `plugins/withAndroid16KbPageSize.js` keeps the Android build working on
  phones with 16 KB memory pages.
