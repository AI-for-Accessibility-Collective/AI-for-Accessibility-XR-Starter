// 4. Step by step: say a task ("make a cup of tea"), and be guided through it.
//
//   bun run dev examples/4-step-by-step.ts
//
// An idea for people who find it easier to do one thing at a time. With the
// profile need "Steps: One step at a time", it gives one step and waits
// until you say you have done it. Without it, it gives the steps together.
// Try the example profile "One step at a time, plain words, a little slower".
//
// Shows: g.ai.ask with json, g.listen in a loop, g.profile.settings.oneStepAtATime

import { defineApp, type Glasses } from '../src/starter/index.ts';

export default defineApp({
  name: 'Step by step',
  instructions: 'You guide people through everyday tasks at home.',

  async onStart(g) {
    await g.say('What would you like to do? For example, make a cup of tea.');
  },

  async onSpeech(task, g) {
    const reply = await g.ai.ask(
      `Break this task into short steps: "${task}". At most 8 steps, one action each. Reply as JSON: {"steps": ["..."]}`,
      { json: true },
    );
    const steps = (JSON.parse(reply) as { steps: string[] }).steps;

    if (!g.profile.settings.oneStepAtATime) {
      await g.say(steps.join(' '));
      return g.say('Ask me about another task when you are ready.');
    }
    await guide(g, steps);
  },
});

async function guide(g: Glasses, steps: string[]) {
  await g.say(`There are ${steps.length} steps. Tell me when each one is done. You can also say repeat, or go back.`);
  let i = 0;
  while (i < steps.length) {
    await g.say(steps[i]!);
    const answer = await g.listen({ timeoutMs: 120_000 });
    if (answer == null) return g.say('I will stop here. Tell me a task when you want to start again.');
    if (/\b(stop|cancel|quit)\b/i.test(answer)) return g.say('Okay, stopping.');
    if (/\b(repeat|again|what)\b/i.test(answer)) continue;
    if (/\b(back|previous)\b/i.test(answer)) {
      i = Math.max(0, i - 1);
      continue;
    }
    i++;
  }
  await g.say('That was the last step. The task is done.');
}
