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
   glasses must run the matching 3.1.1 software. If the Wearable Task Guide
   app works with the glasses, they already match. Do not update the glasses
   unless you also rebuild the app with the matching SDK (`phone/README.md`,
   Versions).
2. **Build and install the phone app** (`phone/README.md`).
3. **Pair the glasses** in XR Starter (Scan, Connect). On an iPhone, also
   choose the glasses in Settings › Bluetooth.
4. **Try the glasses with your own laptop:**

   ```bash
   bun install && cp .env.example .env    # add a Gemini key
   bun run check                          # should end with "Ready"
   bun run dev                            # then open http://localhost:3000
   ```

   Scan the dashboard's QR code with the phone's Camera app. Press Start.
   Check each of these:
   - The app says hello in the glasses speaker.
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

- **Opening (10 minutes):** show `bun run dev`, the simulator, and one real
  glasses session on the projector. Point teams to the README, sections 1 to 3.
  The slides are in `docs/intro-slides.key`, with timings in the presenter notes.
  The dashboard's **Tour** button goes through the page one part at a time.
- **Teams start with the simulator.** It runs on their laptop, so teams can
  start before their turn with the glasses.
- **Hand-off between teams:**
  1. The current team presses **■ Stop**.
  2. The next team runs `bun run dev` and opens the **Real glasses** tab.
  3. Scan their QR code with the phone's Camera app. The phone connects to the
     new laptop. The glasses stay paired.
- **Between sessions:** charge the glasses. Keep the phone app open; it keeps
  the glasses connection.
- **If a phone shows "Cannot reach":** the team runs `bun run tunnel` in a
  second terminal, and scans the new QR code.

## Common problems

| Problem | Fix |
|---|---|
| No sound in the glasses (iPhone) | Settings › Bluetooth: choose the glasses. Check the phone's volume. |
| The glasses do not show up in Scan | Close the Mentra app and other glasses apps, which can hold the connection. Restart the glasses. |
| A button press gets no response | XR Starter turns off the glasses' own photo-on-press (gallery mode) when it connects. Reconnect the glasses in the app. |
| Photos are slow | The glasses have no Wi-Fi, so photos go over Bluetooth. Set up **Glasses Wi-Fi** in the app, on a network that can reach the laptop. |
| "Another device took over" on the phone | Someone opened the simulator on the laptop. Press **Use this phone again**. |
| The app hears the room | Fine-tune in the app: `listen: 'when-asked'` keeps the mic off until a button press (see example 2). |
