// 3. Read it to me: hold up a letter, a label or a menu and say "read this".
//
//   bun run dev examples/3-read-it-to-me.ts
//
// An idea for people with low vision or who find reading hard. The profile
// decides how much is read: the gist first (plain language, or the "gist"
// detail need), or the full text.
//
// Shows: g.takePhoto({ mode: 'text' }), g.ai.ask with json, the profile changing behaviour

import { defineApp } from '../src/starter/index.ts';

export default defineApp({
  name: 'Read it to me',
  instructions: 'You read printed text for the wearer. Do not invent text you cannot see.',

  async onStart(g) {
    await g.say('Hold something up and say read this. Say read the full text to hear it word for word.');
  },

  async onSpeech(text, g) {
    if (!/\bread\b/i.test(text)) return g.say('Say read this when you are ready.');

    await g.say('Hold still.');
    const photo = await g.takePhoto({ mode: 'text', size: 'high' });
    const reply = await g.ai.ask(
      'Read the text in this photo. Reply as JSON: {"found": true or false, "kind": "what it is, with a or an, like a letter or a medicine label", "gist": "one sentence on what it says", "full": "the text word for word, in reading order"}',
      { photo, json: true },
    );
    const page = JSON.parse(reply) as { found: boolean; kind: string; gist: string; full: string };
    if (!page.found) return g.say('I cannot find text in this photo. Try holding it closer and flatter.');

    const everyWord = /\b(all|every|whole|full)\b/i.test(text) || g.profile.settings.detail === 'full';
    if (everyWord) return g.say(`This is ${page.kind}. ${page.full}`);
    await g.say(`This is ${page.kind}. ${page.gist} Say read the full text to hear it word for word.`);
  },
});
