export function trackingUpdates(body, userId) {
  // The mode switcher controls the current user's preference. Sending the
  // entire client-side member map must never overwrite another user's choice.
  const update = {}
  if (body.on_for && Object.hasOwn(body.on_for, userId)) {
    update[`track_changes.${userId}`] = body.on_for[userId]
  }
  if (body.on_for_guests !== undefined) {
    update['track_changes.__guests__'] = body.on_for_guests
  }
  return update
}
