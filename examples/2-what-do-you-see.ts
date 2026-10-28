// 2. What do you see? Press the button, hear what is in front of you, then
// ask follow-up questions about it.
//
//   bun run dev examples/2-what-do-you-see.ts
//
// An idea for people who are blind or have low vision. Try it with the
// example profile "Fast speech, full detail, describes surroundings", then
// with adapting switched off, and hear the difference.
//
// The mic turns on after a button press (listen: 'when-asked'), so a noisy
// room does not set it off.
//
// Shows: onButton, g.takePhoto, g.ai.chat with a photo, g.listen, g.profile.settings

import { defineApp } from '../src/starter/index.ts';

export default defineApp({
  name: 'What do you see?',
  listen: 'when-asked',
  instructions:
    'You describe what is in front of the wearer. Start with the most important thing. ' +
    'Say where things are using left, right, ahead and rough distances. Do not guess at text you cannot read.',

  async onStart(g) {
    await g.say('Press the button and I will describe what is in front of you.');
  },

  async onButton(button, g) {
    if (button.press === 'long') return g.stopSpeaking();

    const photo = await g.takePhoto({ size: 'high' });
    g.ai.forget(); // a new photo starts a new conversation
    const detail = g.profile.settings.detail === 'full' ? 'Describe it in detail.' : 'Describe it in two sentences.';
    await g.say(await g.ai.chat(`What is in front of me? ${detail}`, { photo }));

    // Follow-up questions about the same photo, until they stop asking.
    for (let i = 0; i < 5; i++) {
      const question = await g.listen({ timeoutMs: 10_000 });
      if (!question || /\b(stop|thanks|thank you|that's all)\b/i.test(question)) break;
      await g.say(await g.ai.chat(question));
    }
  },
});
