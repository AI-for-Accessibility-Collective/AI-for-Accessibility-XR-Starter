<img src="docs/logo.png" alt="ai4a11y" width="220">

# XR Starter

Starter code for building a small app for **Mentra Live** smart glasses in an
afternoon. The glasses have a camera, a microphone, a speaker and a button.
They have no screen, so your app talks and listens.

Your app is one TypeScript file on your laptop. The starter handles the
glasses, speech, the camera and the AI. The
[AI for Accessibility Toolkit](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit)
keeps the wearer's accessibility profile, and the starter adapts your app's
speech to it.

What you get:

- A working app in `src/app.ts`. Run it first, then change it.
- A **phone simulator**: in the XR Starter phone app, the phone's camera, mic
  and speaker stand in for the glasses, with a round button on the screen.
  Use it while another team has the glasses.
- Five short examples in `examples/`.
- A dashboard in your browser that shows what the app hears, says and sees,
  and lets you edit the wearer's profile.

## How it fits together

1. You write your app in `src/app.ts`.
2. `bun run dev` runs it on your laptop. The starter turns speech into text,
   makes the app's voice, and calls Gemini.
3. A phone runs the **XR Starter** app. It links the glasses to your laptop
   over Bluetooth and Wi-Fi, or it acts as the glasses itself. The organiser
   brings the glasses and the phone.
4. The toolkit reads the wearer's profile, for example "speak slower" or "one
   step at a time", and the starter shapes the app's speech to fit.

```
glasses ⇄ Bluetooth ⇄ phone (XR Starter app) ⇄ network ⇄ your laptop (bun run dev, src/app.ts)
                                                          your browser: dashboard
```

## 1. Set up (about 10 minutes)

You need [Bun](https://bun.sh) and a free Gemini API key from
[Google AI Studio](https://aistudio.google.com/apikey).

```bash
curl -fsSL https://bun.sh/install | bash      # Windows: powershell -c "irm bun.sh/install.ps1 | iex"
git clone https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR-Starter.git
cd AI-for-Accessibility-XR-Starter
bun install
cp .env.example .env                          # then put your key after GEMINI_API_KEY=
bun run check                                 # checks your setup, including your key
```

`bun run check` ends with **Ready** when your setup works.

## 2. Run the starter app

```bash
bun run dev
```

Open **http://localhost:3000**. This is the dashboard. It shows what the app
hears, says and sees, and a QR code for the phone.

The first time you open the dashboard, a short tour shows each part of the
page. The **Tour** button at the top opens it again.

## 3. Try it with a phone as the glasses

The phone's camera, microphone and speaker stand in for the glasses, and a
round button on the screen is the glasses button. First, get the XR Starter
app on the phone:

- **Android:** on the phone, open [XR-Starter.apk](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR-Starter/releases/latest/download/XR-Starter.apk) and allow the
  install. Or scan the QR code on the dashboard, under **No XR Starter on the
  phone yet?**
- **iPhone:** ask the organiser. The organiser has iPhones with the app.

1. On the phone, open **XR Starter**, press **Scan QR code**, and point the
   phone at the QR code on the dashboard. The phone vibrates when it finds it.
2. Under **Choose the glasses**, press **Use this phone**. Allow the camera
   and the microphone.
3. Hold the phone sideways at eye level, with the camera facing ahead. The
   screen turns with the phone, and the app starts by itself. It says it is ready.
4. Say "hello", or ask a question. Then say "what do you see?". It takes a
   photo and describes it.
5. Tap the round button. It describes what the camera sees. Hold the button
   for a long press.
6. Say "speak slower". It saves that to the profile, and the next answer is slower.

You can also type in the **Conversation** box on the dashboard, the same as
speaking.

The glasses have no screen, so the phone hides the words at first. Turn on
**Captions** to show them. When the profile asks for captions, they show
without the switch. **Type** sends typed words from the phone. **Exit** stops
the app and leaves the phone simulator. Your app sees a simulator
(`g.device` is `'simulator'`), and its photos have `from: 'phone'`.

## 4. Connect the real glasses

The organiser has the glasses and a phone with the XR Starter app on it.

1. On the phone, open **XR Starter**, press **Scan QR code**, and point the
   phone at the QR code on your dashboard.
2. If the phone asks you to choose the glasses, press **Connect glasses**.
3. The phone shows your app by its name, for example **Starter assistant**.
   Press **Start** on the phone, or **▶ Start** on the dashboard.
4. Wear the glasses and talk. Press the button on the right arm of the glasses.

When you are done, press **Stop** and pass the glasses on. The next team
opens **More options** on the phone, presses **Connect to another laptop**,
and scans their own QR code.

**If the phone cannot reach your laptop**, the Wi-Fi may stop devices from
reaching each other. Run a tunnel in a second terminal:

```bash
brew install cloudflared      # once. Windows: winget install --id Cloudflare.cloudflared
bun run tunnel
```

The dashboard's QR code then uses the tunnel. Scan it again.

## 5. Build your idea

Open `src/app.ts`. It is about 60 lines. Save a change and the server
restarts, and the phone reconnects by itself.

The API is in `src/starter/index.ts`. In short:

| To do this | Write this |
|---|---|
| Speak | `await g.say('Hello')` |
| React to speech | `onSpeech(text, g) { ... }` |
| Wait for an answer | `const answer = await g.listen()` |
| Take a photo | `const photo = await g.takePhoto()` |
| Ask the AI | `await g.ai.ask('What is this?', { photo })` |
| Have a conversation | `await g.ai.chat(text)` (it remembers earlier turns) |
| React to the button | `onButton(button, g) { ... }` (`button.press` is `'short'` or `'long'`) |
| Read the profile | `g.profile.settings.rate`, `g.profile.get('captions')` |
| Save to the profile | `await g.profile.set('readAloudRate', 0.9)` |
| Light the glasses' LED | `g.light('green')` |
| Write to the dashboard log | `g.log('something happened')` |

Run an example:

```bash
bun run dev examples/2-what-do-you-see.ts
```

| Example | What it does | Shows |
|---|---|---|
| `1-echo.ts` | Says back what it heard | The smallest app |
| `2-what-do-you-see.ts` | Press the button, hear what is in front of you, ask about it | Photos, follow-up questions |
| `3-read-it-to-me.ts` | Reads a letter, label or menu aloud | Reading text, JSON from the AI |
| `4-step-by-step.ts` | Guides you through a task one step at a time | `g.listen()`, the profile changing behaviour |
| `5-remember-for-me.ts` | Remembers what you tell it or show it | Keeping your own data |

To start from an example, copy it over your app:
`cp examples/4-step-by-step.ts src/app.ts`, then change the import line to
`from './starter/index.ts'`.

### Tips for voice apps

- Write the way people talk. Short sentences, one idea each. The AI's answers
  are already asked to be short and spoken.
- Say something straight away when a step takes time. For example, say
  "Let me look." before taking a photo.
- The wearer cannot see a screen. Tell them what the app is doing, and what
  they can say next.
- The wearer may be blind. Say where things are (left, right, ahead), and
  leave out phrases like "you are looking at". The AI already follows this rule.
- Try your app with the people on your team who will use it, early and often.

## 6. The AI for Accessibility Toolkit

The toolkit keeps a **profile** of what the wearer needs. The person sets it
up once, and apps built on the toolkit read the same profile. You
can edit it on the dashboard, under **Profile**.

The starter uses the profile in two ways:

- **How the app speaks.** `g.say()` follows the profile's speaking speed, and
  one step at a time with a pause between steps.
- **What the AI says.** `g.ai.ask()` and `g.ai.chat()` add the profile to the
  AI's instructions: plain words, how much detail, describing surroundings.

Switch **Adapt to the profile** off and on to hear the difference. The
example buttons load a ready-made profile. The dashboard shows two needs to
keep the page short. The others in `src/toolkit/needs.ts` work the same way
from your app.

Your app can read the profile (`g.profile.settings`, `g.profile.get(...)`)
and change what it does. Example 4 gives the steps together, or one at a
time, depending on the profile.

The profile belongs to the person. Save a change when the person asks for it,
as `src/app.ts` does with "speak slower". If your app guesses a need,
ask the person before you save it.

To add a need of your own, add it to `src/toolkit/needs.ts`. It then shows on
the dashboard, and your app reads it with `g.profile.get('yourNeed')`.

## Using a coding agent

`AGENTS.md` explains this repo to coding agents such as Claude Code, Codex or
Cursor. A good first message:

> Read AGENTS.md. Then change src/app.ts so that ... Run bun test and bun run typecheck when you are done.

## What is in the repo

```
src/app.ts          your app (start here)
examples/           five small apps to run or copy
src/starter/        the engine: glasses link, speech, voice, AI, dashboard (you should not need to change it)
src/toolkit/        the bridge to the toolkit: the profile, what it means for audio, the AI prompt
vendor/             a copy of the toolkit package (do not edit)
phone/              the phone app: links the glasses, or acts as them (see phone/README.md)
scripts/            check, tunnel, update-toolkit
test/               bun test
docs/ORGANIZER.md   preparing the glasses and the phone for the event
```

## Troubleshooting

| Problem | What to do |
|---|---|
| `bun run check` says the key is missing | Put `GEMINI_API_KEY=...` in `.env` (copy `.env.example` first). |
| A Gemini model is not available to your key | The app switches to `gemini-flash-latest` by itself. You can also set `GEMINI_MODEL` in `.env`. |
| The phone says "Cannot reach" | Is `bun run dev` running? Is the phone on the same Wi-Fi? If both are yes, run `bun run tunnel`. |
| The phone says the code was refused | In XR Starter, press **Scan QR code** and scan your dashboard's QR code again. |
| The phone simulator does not hear me | In the phone's Settings › XR Starter, allow the microphone. The phone also stops listening while the app speaks. |
| The app hears itself | The phone stops listening while the app speaks. If it still hears itself, turn the phone's volume down. |
| The app ignores what I said | The dashboard shows "not handled" and the reason. Usually the app was still busy with the last thing. |
| The glasses are silent with an iPhone | In the iPhone's Settings › Bluetooth, choose the glasses. |
| The Android phone finds no glasses | Switch Location on and allow it for XR Starter. Android needs it for Bluetooth scanning. |
| Answers feel slow | Making Gemini's voice takes 2 to 5 seconds per sentence. `VOICE=device` in `.env` uses the phone's own voice, which is instant. |
| "Gemini is switched off" | A spending guard stopped Gemini (60 calls a minute, 800 a run). Restart `bun run dev`. |
| Port 3000 is in use | Another copy is running. Stop it, or set `PORT=3001` in `.env`. |

## Good to know

- Each thing the wearer says costs one or two Gemini calls, and each answer
  one or two more. The limits in `.env` stop runaway costs.
- Photos stay in memory on your laptop, and go to Gemini when your app asks
  about them. The dashboard opens on your own laptop and refuses other devices. The glasses show a
  light while they take a photo. Tell people nearby when you are filming.
- The starter takes single photos. It does not stream video.
- This starter grew out of the
  [AI for Accessibility XR](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR)
  project, where the speech, voice and phone code was tested on real glasses.

Apache 2.0, like the toolkit.
