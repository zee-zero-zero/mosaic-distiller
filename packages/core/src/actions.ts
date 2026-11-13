// Provides action resolution (§2.7): the action of a span is a neutralise literal's forced
// action, else the profile's entry for `category/variant`, else its entry for `category`, else
// the winning rule's default. The more specific key wins.
import type { Action } from "./schema";
import type { Hit, Profile } from "./types";

export function actionFor(profile: Profile, hit: Hit): Action {
  if (hit.forced !== undefined) return hit.forced;
  if (hit.variant !== undefined) {
    const specific = profile.actions.get(`${hit.category}/${hit.variant}`);
    if (specific !== undefined) return specific;
  }
  return profile.actions.get(hit.category) ?? hit.action;
}

export function neutraliseMarker(category: string): string {
  return `[neutralised: ${category}]`;
}
