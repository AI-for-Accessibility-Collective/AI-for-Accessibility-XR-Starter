// Profile → lines added to AI requests (g.ai.ask, g.ai.chat). This is
// how the profile changes WHAT the app says. The other half, how it is
// spoken, is the rate, pieces and pauses in say().
//
// The lines come from the wearable-extension project
// (src/toolkit-candidates/adapters/), where each was tested against real
// model output. The structured needs reach the prompt. The person's
// free-text notes stay out of it.

import type { Profile } from './profile.ts';
import type { AudioSettings } from './settings.ts';

// Plain words and short steps invite a model to talk down to people. This
// line is added when the profile adds other lines. (Kemper & Harden 1999;
// Williams et al. 2009.)
const RESPECT =
  "Speak to the person as a capable adult: no endearments, no baby talk, no 'we' or 'let's', no tag questions such as 'okay?', no over-praise.";

// `forData`: the answer is data for the app (g.ai.ask with json), and the app
// decides how to say it. Then the wording lines apply and the others are left out. "Give one
// action" would conflict with a request for the full list of steps.
export function profilePrompt(profile: Profile | null, s: AudioSettings, opts: { forData?: boolean } = {}): string {
  if (!profile || (!profile.needs.length && !profile.supportAreas.length)) return '';
  const lines: string[] = [];

  if (s.oneStepAtATime && !opts.forData) {
    lines.push(
      'Give ONE next action, then stop and wait. Do not list several steps. ' +
        'You may end with a few words asking them to tell you when it is done; do not tell them to say a particular word.',
      'When they say they have done it, in whatever words, begin with a few plain words naming what they just did, then give the next action.',
      'If they ask something partway through a step, answer it and carry on from where they are. Do not read the step out again word for word.',
    );
  }
  if (s.plainLanguage) {
    lines.push(
      "Use plain everyday words: say 'soap', 'big dial'. No jargon, no technical terms.",
      'Use one name for each thing, and keep it.',
      'Keep sentences short, one idea each. Start with the action, then say where.',
    );
  }
  if (s.detail === 'gist') lines.push('Give the one-sentence gist first. Wait to be asked before adding details.');
  if (s.detail === 'full') lines.push('Give complete detail: include small print, numbers and the wording as written.');
  if (s.describeImages) {
    lines.push('When a photo is attached, also mention what in it matters for getting around: obstacles, steps, doors, signs, people nearby. Say where each thing is.');
  }
  if (profile.supportAreas.includes('vision')) lines.push("Seeing is one of the person's support areas. Read out text and signs in a photo, and give the position and distance of things that matter.");
  if (profile.supportAreas.includes('hearing')) lines.push('Keep each sentence short and complete, so it reads well as a caption.');

  if (!lines.length) return '';
  lines.push(RESPECT);
  return 'ABOUT THE PERSON (adapt to this):\n' + lines.map((l) => `- ${l}`).join('\n');
}
