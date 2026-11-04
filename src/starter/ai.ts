// g.ai.ask() and g.ai.chat(): Gemini with the rules for spoken answers, the
// app's own instructions, and the profile's directives (toolkit/prompt.ts).

import { generate, type GeminiContent, type GeminiPart } from './gemini.ts';
import type { AskOptions, Photo } from './index.ts';

// The camera stands in for the wearer's eyes, and the wearer may be blind.
// So answers say where things are from the wearer and leave out wording that
// takes sight (or another sense or ability) for granted. The profile
// (toolkit/prompt.ts) adds what the person has said they need.
const PHOTO_AND_WEARER =
  "A photo, when attached, was just taken by the glasses camera, facing the way the wearer's head faces. " +
  'The wearer may be blind, have low vision, or see well. Make no assumption about what they can see, hear or do. ' +
  "Describe what things are and where they are from the wearer: ahead, left, right, and rough distances, for example 'A person is about two metres ahead of you, facing you.' " +
  "Leave the wearer's own senses and actions out of the description. Phrases such as 'you are looking at', 'as you can see' or 'you are holding' are guesses about the wearer.";

// The model's words are read aloud, so they have to be speech.
const SPOKEN =
  'You are the voice of an app on smart glasses. The glasses have a camera, a microphone and a speaker, and no screen. ' +
  'Your words are read aloud to the wearer as written. ' +
  'Write plain spoken sentences: no markdown, no lists, no headings, no emoji, no labels, no stage directions. ' +
  'Keep answers short, one to three sentences, unless asked for more. ' +
  PHOTO_AND_WEARER;

// Markdown that slips through anyway would be read out as "asterisk".
export function spoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function photoParts(photo: AskOptions['photo']): GeminiPart[] {
  const list = photo == null ? [] : Array.isArray(photo) ? photo : [photo];
  return list.map((p: Photo) => ({ inlineData: { mimeType: 'image/jpeg', data: p.base64 } }));
}

// With json: the answer is data for the app, and the app decides what to say.
const DATA =
  'You work inside an app on smart glasses (camera, microphone, speaker, no screen). Reply with JSON and no other text. ' +
  'Text in it will be read aloud, so write it as plain spoken sentences. ' +
  PHOTO_AND_WEARER;

// Without a photo the model has no view of the surroundings. Asked about
// them, it makes up a scene, and the wearer may have no way to tell. So it
// answers LOOK, and g.ai takes a photo and asks again with it.
const NO_PHOTO =
  'This message has no photo, so you cannot see the surroundings at this moment. ' +
  'A photo earlier in the conversation shows the moment it was taken, and you can answer questions about it. ' +
  'Do not describe or guess what is around the wearer without a photo.';
const ASK_FOR_PHOTO = 'When the answer needs a new look at the surroundings, reply with the single word LOOK.';
const SAY_NO_PHOTO = 'When the answer needs a new look at the surroundings, say that you need a photo for that.';

export interface AiContext {
  appInstructions?: string;
  profilePrompt: (forData: boolean) => string;
  /** Takes a photo when a question needs one. */
  look: () => Promise<Photo>;
  /** Tests pass a stand-in for Gemini. */
  generate?: typeof generate;
}

export function createAi(ctx: AiContext) {
  let history: GeminiContent[] = [];
  const gemini = ctx.generate ?? generate;

  const noPhoto = (opts: AskOptions): string => (opts.json ? NO_PHOTO : `${NO_PHOTO} ${opts.look === false ? SAY_NO_PHOTO : ASK_FOR_PHOTO}`);

  const system = (opts: AskOptions, withPhoto: boolean): string =>
    [opts.json ? DATA : SPOKEN, opts.instructions ?? ctx.appInstructions ?? '', ctx.profilePrompt(!!opts.json), withPhoto ? '' : noPhoto(opts)]
      .filter(Boolean)
      .join('\n\n');

  const call = async (contents: GeminiContent[], opts: AskOptions): Promise<string> => {
    const withPhoto = contents.at(-1)!.parts.some((p) => p.inlineData);
    const out = await gemini({ system: system(opts, withPhoto), contents, temperature: opts.temperature ?? 0.3, json: opts.json });
    return opts.json ? out : spoken(out);
  };

  const wantsPhoto = (answer: string, opts: AskOptions) => !opts.json && opts.look !== false && /^\W*look\W*$/i.test(answer);

  return {
    async ask(prompt: string, opts: AskOptions = {}): Promise<string> {
      const turn = (photo: AskOptions['photo']): GeminiContent[] => [{ role: 'user', parts: [...photoParts(photo), { text: prompt }] }];
      const answer = await call(turn(opts.photo), opts);
      return wantsPhoto(answer, opts) ? call(turn(await ctx.look()), opts) : answer;
    },

    async chat(message: string, opts: AskOptions = {}): Promise<string> {
      let turn: GeminiContent = { role: 'user', parts: [...photoParts(opts.photo), { text: message }] };
      let answer = await call([...history, turn], opts);
      if (wantsPhoto(answer, opts)) {
        turn = { role: 'user', parts: [...photoParts(await ctx.look()), { text: message }] };
        answer = await call([...history, turn], opts);
      }
      history.push(turn, { role: 'model', parts: [{ text: answer }] });
      // Keep the last 12 turns, and the photos of the last 4, so requests stay small.
      history = history.slice(-24).map((c, i, all) =>
        i < all.length - 8 ? { ...c, parts: c.parts.map((p) => (p.inlineData ? { text: '[a photo was shown here]' } : p)) } : c,
      );
      return answer;
    },

    forget(): void {
      history = [];
    },
  };
}

export type Ai = ReturnType<typeof createAi>;
