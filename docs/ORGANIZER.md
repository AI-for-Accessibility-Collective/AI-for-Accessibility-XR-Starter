# Organiser checklist

How to prepare the glasses, the phone and the repo for the hackathon, and how
to run the glasses hand-offs on the day.

## What to bring

- Mentra Live glasses, charged, with their charging cable.
- A phone with the **XR Starter** app installed (see `phone/README.md`), charged.
- A battery pack. Glasses and phone both drain faster while streaming audio.
- A laptop with this repo, to test each kit before handing it out.
- A plan for Gemini keys: teams bring their own free key, or you hand one out.
  The spending guard in `.env` limits each team to 60 calls a minute and 800
  per server run.

## A week before

1. **Glasses software.** The phone app uses Mentra Bluetooth SDK 3.1.1. The
   glasses must run the matching 3.1.1 software: with older software they
   connect, and then the mic, the button and the camera fail. XR Starter
   checks this when the glasses connect, and shows **Update the glasses**
   when they need it. Update each pair before the event, on a Wi-Fi network
   with internet for the glasses; the glasses restart during the update.
   Updates from the Mentra app install a different release, so update
   through XR Starter (or rebuild the app with the matching SDK,
   `phone/README.md`, Versions).
2. **Share the phone app**, so teams can install it on their own phones
   (`phone/README.md`, Share the app):
   - Android: push a tag such as `phone-v0.1.0`. The workflow publishes
     `XR-Starter.apk` as a GitHub Release, and the README and the dashboard
     link to it.
   - iPhone, optional: without a TestFlight link, bring iPhones with the app
     installed. To make a link, upload a build with `bun run ios:testflight`,
     and turn on a TestFlight public link. Put the link in `IOS_APP_URL` (in
     `src/starter/config.ts`), so the dashboard shows it. Apple reviews the
     first build for TestFlight, which can take a day, so start early.
3. **Pair the glasses** in XR Starter (Scan, Connect). On an iPhone, also
   choose the glasses in Settings › Bluetooth. On Android, allow location
   when asked and keep Location switched on, or the scan finds no glasses.
4. **Try the glasses with your own laptop:**

   ```bash
   bun install && cp .env.example .env    # add a Gemini key
   bun run check                          # should end with "Ready"
   bun run dev                            # then open http://localhost:3000
   ```

   In XR Starter, press **Scan QR code** and scan the dashboard's QR code.
   Press Start.
   Check each of these:
   - The app's greeting plays in the glasses speaker.
   - Saying "hello" gets an answer.
   - Saying "what do you see?" takes a photo, and the dashboard shows it.
   - The glasses button describes the scene.
   - "Speak slower" makes the next answer slower.
5. **Try the venue network if you can.** Some Wi-Fi networks stop devices
   reaching each other (common on guest and university networks). Then the
   phone shows "Cannot reach". Test `bun run tunnel` (needs
   `brew install cloudflared`), which works on networks with internet access.
   A phone hotspot shared by the laptop and the phone is another option.

## On the day

- **Opening (10 minutes):** show `bun run dev`, a phone as the glasses, and
  one real glasses session on the projector. Point teams to the README, sections 1 to 4.
  The slides are in `docs/intro-slides.key`, with timings in the presenter notes.
  The dashboard's **Tour** button goes through the page one part at a time.
- **Teams start with a phone as the glasses.** On a phone with XR Starter, a
  team scans their QR code and presses **Use this phone**, so they can start
  before their turn with the glasses. Each team needs a phone with the app:
  bring spare phones, or share the Android APK.
- **Hand-off between teams:**
  1. The current team presses **■ Stop**.
  2. The next team runs `bun run dev` and opens the dashboard.
  3. In XR Starter, open **More options**, press **Connect to another laptop**,
     and scan their QR code. The glasses stay paired.
- **Between sessions:** charge the glasses. Keep the phone app open; it keeps
  the glasses connection.
- **If a phone shows "Cannot reach":** the team runs `bun run tunnel` in a
  second terminal, and scans the new QR code.

## Common problems

| Problem | Fix |
|---|---|
| No sound in the glasses (iPhone) | Settings › Bluetooth: choose the glasses. Check the phone's volume. |
| No sound in the glasses (Android) | Settings › Connected devices: tap the glasses and turn on Media audio. The app shows a Bluetooth settings button for this. |
| "The glasses' Wi-Fi has no internet connection" during the update | Join the glasses to another network in the app (a phone hotspot works), then press Try again. |
| Scan finds no glasses (Android) | Switch Location on in the phone's quick settings, and allow location for XR Starter. Android 12+ withholds Bluetooth scan results without it. |
| The QR code does not open the app (Android) | Some camera apps show the link as text. Press **Scan QR code** in XR Starter, or **Type it in instead**. |
| The glasses do not show up in Scan | Close the Mentra app and other glasses apps, which can hold the connection. Restart the glasses. |
| A button press gets no response | XR Starter turns off the glasses' own photo-on-press (gallery mode) when it connects. Reconnect the glasses in the app. |
| Photos are slow | The glasses have no Wi-Fi, so photos go over Bluetooth. Set up **Glasses Wi-Fi** in the app, on a network that can reach the laptop. |
| "Another device took over" on the phone | Another phone scanned the same team's QR code. Press **Use this phone again** on the phone that should stay. |
| The app hears the room | Fine-tune in the app: `listen: 'when-asked'` keeps the mic off until a button press (see example 2). |
