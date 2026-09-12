# shopping-list

A shared shopping list with no accounts. One TypeScript file, deployed as an HTTP val on
[Val Town](https://www.val.town/x/yonee/shopping-list). The UI is in Polish.

## Where this code comes from

The app lives on Val Town, where it was written and deployed on 12 September 2026, between
10:44 and 11:32 UTC, in 20 versions. This repository is a snapshot of `main.ts` version 20,
the last one from that day, copied on 18 October 2026. The commit author date is the time of
version 20; the full version history is on Val Town only.

## How it works

- Access: `POST /api/new` creates a list with a random 10-character id.
  Anyone who has `/l/<id>` can read and edit the list. There are no accounts and no login.
- Expiry: a list untouched for 7 days is deleted together with its items.
- Conflict resolution: each item field (name, order, checked, deleted) carries its own
  timestamp and device id, and the newer write wins, field by field. Deletes are tombstones,
  not row removals. The list name is a separate register with the same rule.
- Polling: clients send pending changes and fetch everything newer than the last seen
  sequence number every 2 seconds while the page is visible.
- Storage: Val Town SQLite (`std/sqlite`), two tables: `lists` and `items`.
- Front end: vanilla JS and CSS inside the same file. Tap to check, hold to rename,
  drag the grip to reorder, clear the name to delete.

## Running it

The code depends on Val Town's `std/sqlite`, so it runs on Val Town as is: create an HTTP val
and paste `main.ts`. Elsewhere you would need to replace the SQLite import.

## Not production-ready

Anyone with a link has full access to the list, `/api/new` has no rate limit, and there is
no backup.
