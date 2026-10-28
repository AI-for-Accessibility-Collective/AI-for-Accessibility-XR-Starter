// The person's profile, kept by the AI for Accessibility Toolkit.
//
// The toolkit runs inside this server as a library (vendor/ai4a11y-toolkit).
// It stores the profile as files under data/. The starter calls the
// toolkit's store from this file.
//
// A profile is two lists:
//   supportAreas: broad areas the person wants support with ('vision', 'hearing', ...)
//   needs:        specific needs, each { dimension, value }, for example
//                 { dimension: 'readAloudRate', value: 0.8 }
//
// The person's free-text notes, which the toolkit also keeps, stay in
// this file. They do not reach the AI prompt.

import { createToolkit } from '@ai4a11y/toolkit';
import { fileKV } from '@ai4a11y/toolkit/platforms/node/kv.js';

export interface Need {
  dimension: string;
  value: unknown;
  strength?: 'floor' | 'preference' | 'hint';
  source?: string;
}

export interface Profile {
  supportAreas: string[];
  needs: Need[];
}

export const EMPTY_PROFILE: Profile = { supportAreas: [], needs: [] };

export interface ProfileStore {
  read(): Promise<Profile>;
  // Set one need, or remove it with null. `source` is recorded with the need,
  // so the profile shows where each one came from.
  setNeed(dimension: string, value: unknown, source?: string): Promise<Profile>;
  setSupportAreas(areas: string[]): Promise<Profile>;
  // Replace the profile with a new one (the example profiles on the dashboard).
  replace(profile: Profile, source?: string): Promise<Profile>;
  onChange(fn: (profile: Profile) => void): void;
}

const STRENGTHS = new Set(['floor', 'preference', 'hint']);

function clean(model: { supportAreas?: unknown; needs?: unknown } | null | undefined): Profile {
  const supportAreas = Array.isArray(model?.supportAreas) ? model.supportAreas.map(String) : [];
  const needs: Need[] = Array.isArray(model?.needs)
    ? model.needs
        .filter((n: any) => n && typeof n.dimension === 'string')
        .map((n: any) => ({
          dimension: n.dimension,
          value: n.value,
          strength: STRENGTHS.has(n.strength) ? n.strength : 'preference',
          ...(n.source ? { source: String(n.source) } : {}),
        }))
    : [];
  return { supportAreas, needs };
}

export async function openProfileStore(dataDir: string, person = 'wearer'): Promise<ProfileStore> {
  const { librarian, datastore } = createToolkit({ kv: fileKV(dataDir), clock: { now: () => Date.now() } });
  await datastore.runMigrations();
  await librarian.setActingUser(person);

  const listeners: Array<(p: Profile) => void> = [];
  // The needs are one array in one record, so each write reads, changes and
  // writes it back. One queue keeps two quick edits from overwriting each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  const read = async (): Promise<Profile> => clean(await librarian.getAbilityModel());
  const changed = async (): Promise<Profile> => {
    const p = await read();
    for (const fn of listeners) fn(p);
    return p;
  };

  return {
    read,
    // A change the person asks for is written directly. The toolkit's
    // proposal step is for changes an app infers.
    setNeed: (dimension, value, source = 'dashboard') =>
      serial(async () => {
        const kept = (await read()).needs.filter((n) => n.dimension !== dimension);
        const needs = value == null ? kept : [...kept, { dimension, value, strength: 'preference' as const, source }];
        await librarian.setProfileField('fields.needs', needs);
        return changed();
      }),
    setSupportAreas: (areas) =>
      serial(async () => {
        await librarian.setProfileField('supportAreas', [...new Set(areas.map(String))]);
        return changed();
      }),
    replace: (profile, source = 'example-profile') =>
      serial(async () => {
        await librarian.setProfileFields({
          supportAreas: [...profile.supportAreas],
          'fields.needs': profile.needs.map((n) => ({ dimension: n.dimension, value: n.value, strength: n.strength ?? 'preference', source })),
        });
        return changed();
      }),
    onChange: (fn) => void listeners.push(fn),
  };
}
