# Notification Click → Focus Card

## Problem

Browser notifications fire when a card moves to review, but clicking them does nothing. The user expects clicking a notification to bring the app to the foreground and show the relevant card.

## Design

Use a custom DOM event to bridge from the notification click (in `root-store.ts`) to the React board layout (in `board.tsx`), which already has `selectCard` for opening/flashing cards in slots.

### Changes

**`app/stores/root-store.ts`** — Add `onclick` handler to the existing `new Notification()`:

```ts
const n = new Notification(msg.data.title, { body: 'moved to review' });
n.onclick = () => {
  window.focus();
  window.dispatchEvent(new CustomEvent('orchestrel:focus-card', { detail: { cardId: msg.data.id } }));
};
```

**`app/routes/board.tsx`** — Add a `useEffect` in the board layout to listen for the event:

```ts
useEffect(() => {
  const handler = (e: CustomEvent<{ cardId: number }>) => {
    selectCard(e.detail.cardId);
  };
  window.addEventListener('orchestrel:focus-card', handler as EventListener);
  return () => window.removeEventListener('orchestrel:focus-card', handler as EventListener);
}, [selectCard]);
```

### Behavior

1. Card moves to review → notification appears (existing behavior, only when tab is unfocused)
2. User clicks notification → `window.focus()` brings the tab to foreground
3. Custom event dispatched → board layout receives it → calls `selectCard(cardId)`
4. `selectCard` either opens the card in the first available slot, or flashes it if already visible (existing slot system behavior via `animate-slot-flash`)
5. Works on any current route (`/`, `/backlog`, `/archive`)

### Why custom DOM events

- Notifications are created in a MobX store, outside the React tree
- `selectCard` lives in the React component tree (board layout via `useSlots`)
- Custom events decouple the two — no new observables, no callback registration, no lifecycle management
- The notification is page-context (not service worker), so it can't outlive the tab — the closure naturally binds to the correct window

### Scope

- Two files changed
- No new routes, state, or components
- No URL changes
- Leverages existing `selectCard` + `animate-slot-flash` infrastructure
