// Response sanitizers. creator_id is the ownership credential (the unsigned
// creator_id cookie is compared against it), so leaking it in any public
// response lets a caller forge ownership of someone else's story. All
// story-shaped responses must pass through here: we strip creator_id and
// substitute a server-computed boolean instead.

import type { StoryIndex, StoryVersion } from './types';

function ownerMatches(creatorId: string | undefined, requesterId: string | null): boolean {
  return !!creatorId && creatorId !== 'system' && !!requesterId && requesterId === creatorId;
}

export type PublicStoryVersion = Omit<StoryVersion, 'creator_id'> & { is_owner: boolean };

export function toPublicStory(story: StoryVersion, requesterId: string | null): PublicStoryVersion {
  const { creator_id, ...rest } = story;
  return { ...rest, is_owner: ownerMatches(creator_id, requesterId) };
}

export type PublicStoryIndex = Omit<StoryIndex, 'creator_id'> & { is_mine: boolean };

export function toPublicIndex(idx: StoryIndex, requesterId: string | null): PublicStoryIndex {
  const { creator_id, ...rest } = idx;
  return { ...rest, is_mine: ownerMatches(creator_id, requesterId) };
}
