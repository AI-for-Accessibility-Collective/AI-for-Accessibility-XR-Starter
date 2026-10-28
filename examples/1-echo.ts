// 1. Echo: the smallest app. It says back what it heard.
//
//   bun run dev examples/1-echo.ts
//
// Use it to check the microphone and the speaker, on the glasses or in the
// simulator. No AI is called apart from writing down what you said.
//
// Shows: onStart, onSpeech, g.say

import { defineApp } from '../src/starter/index.ts';

export default defineApp({
  name: 'Echo',

  async onStart(g) {
    await g.say('Say something and I will say it back.');
  },

  async onSpeech(text, g) {
    await g.say(`You said: ${text}`);
  },
});
