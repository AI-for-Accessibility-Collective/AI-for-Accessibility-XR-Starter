// YOUR APP. Start here.
//
// This small app uses each part of the starter, so you can check that the
// parts work, and then change it into your own idea.
//
//   bun run dev     then open http://localhost:3000
//
// Try:
//   - Say "hello" or ask a question. It answers.
//   - Say "what do you see?" or press the glasses button. It takes a photo and describes it.
//   - Say "speak slower" or "speak faster". It saves that to your profile (the toolkit).
//   - Long-press the button to make it stop talking.
//
// The API is in src/starter/index.ts. More examples are in examples/.

import { defineApp, type Glasses } from './starter/index.ts';

export default defineApp({
  name: 'Hello Glasses',

  // Who the AI is in this app. Added to g.ai requests.
  instructions: 'You are a friendly helper on smart glasses. Answer in one or two short sentences.',

  async onStart(g) {
    await g.say('Hi. I am listening. Ask me a question, or press the button and I will describe what is in front of you.');
  },

  async onSpeech(text, g) {
    if (/\b(slower|slow down)\b/i.test(text)) return changeSpeed(g, -0.1);
    if (/\b(faster|speed up)\b/i.test(text)) return changeSpeed(g, +0.1);
    if (/\b(see|look|front of me|describe)\b/i.test(text)) return describe(g, text);

    // Other speech: a conversation. g.ai.chat remembers earlier turns until Stop.
    const answer = await g.ai.chat(text);
    await g.say(answer);
  },

  async onButton(button, g) {
    if (button.press === 'long') return g.stopSpeaking();
    await describe(g, 'What is in front of me?');
  },
});

async function describe(g: Glasses, question: string) {
  await g.say('Let me look.');
  const photo = await g.takePhoto();
  // The profile shapes this answer too: plain words, detail, describing surroundings.
  const answer = await g.ai.ask(question, { photo });
  await g.say(answer);
}

// Reading and writing the person's profile. The toolkit keeps it, so other
// apps built on the toolkit can use the same profile.
async function changeSpeed(g: Glasses, step: number) {
  const now = g.profile.settings.rate;
  const next = Math.round(Math.min(2, Math.max(0.5, now + step)) * 10) / 10;
  await g.profile.set('readAloudRate', next);
  await g.say(next === now ? `That is as ${step < 0 ? 'slow' : 'fast'} as I go.` : `Okay. From now on I will speak at ${next} times speed.`);
}
