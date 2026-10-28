// 5. Remember for me: say "remember that my keys are in the blue bowl", and
// later ask "where are my keys?".
//
//   bun run dev examples/5-remember-for-me.ts
//
// An idea for people who want help with memory. Press the button to
// remember what you are looking at. The notes are kept in data/notes.json,
// on this laptop.
//
// Shows: keeping your own data, g.ai.ask over it, a photo turned into a note

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defineApp } from '../src/starter/index.ts';

const FILE = 'data/notes.json';
type Note = { at: string; text: string };
const notes: Note[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
const save = (text: string) => {
  notes.push({ at: new Date().toLocaleString(), text });
  writeFileSync(FILE, JSON.stringify(notes, null, 2));
};

export default defineApp({
  name: 'Remember for me',

  async onStart(g) {
    await g.say('Tell me something to remember, or ask me about something you told me. Press the button to remember what you see.');
  },

  async onSpeech(text, g) {
    const toRemember = /^\s*remember\b(?: that)?\s*(.+)/i.exec(text);
    if (toRemember) {
      save(toRemember[1]!);
      return g.say('Got it. I will remember that.');
    }
    if (!notes.length) return g.say('I have no notes yet. Tell me something to remember.');
    const list = notes.map((n) => `- ${n.at}: ${n.text}`).join('\n');
    await g.say(
      await g.ai.ask(
        `The wearer asks: "${text}"\nTheir notes, oldest first:\n${list}\n` +
          'Answer from the notes. If the notes do not say, tell them so. Mention when the note was made if it helps.',
      ),
    );
  },

  async onButton(_button, g) {
    const photo = await g.takePhoto();
    const what = await g.ai.ask('In one sentence, say what this is and where it is, so the wearer can find it later.', { photo });
    save(`Seen: ${what}`);
    await g.say(`Remembered: ${what}`);
  },
});
