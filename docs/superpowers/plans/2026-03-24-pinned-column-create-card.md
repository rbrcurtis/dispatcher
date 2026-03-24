# Pinned Column Inline Card Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `+` button to empty pinned column headers that opens an inline card creation form, pre-configured with the pinned project and "running" status.

**Architecture:** Local `creatingCard` state on `ColumnSlot` controls whether to render `NewCardDetail` in place of the empty pinned state. `NewCardDetail` gains an `initialProjectId` prop to pre-populate project and its defaults.

**Tech Stack:** React, TypeScript, MobX, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-24-pinned-column-create-card-design.md`

---

### Task 1: Add `initialProjectId` prop to `NewCardDetail`

**Files:**

- Modify: `app/components/CardDetail.tsx:569-596`

- [ ] **Step 1: Add prop to type and destructure**

In `CardDetail.tsx`, add `initialProjectId` to `NewCardProps` and destructure it:

```typescript
type NewCardProps = {
  column: string;
  onCreated: (id: number, projectId: number | null) => void;
  onClose: () => void;
  onColorChange?: (color: string | null) => void;
  initialProjectId?: number;
};
```

Add it to the destructured props:

```typescript
export const NewCardDetail = observer(function NewCardDetail({
  column,
  onCreated,
  onClose,
  onColorChange,
  initialProjectId,
}: NewCardProps) {
```

- [ ] **Step 2: Compute initial draft from `initialProjectId`**

Replace the static `useState<Draft>` initializer (lines 588-596) with a function initializer that looks up the project when `initialProjectId` is provided:

```typescript
const [draft, setDraft] = useState<Draft>(() => {
  if (initialProjectId != null) {
    const proj = projectStore.getProject(initialProjectId);
    if (proj) {
      return {
        title: '',
        description: '',
        projectId: initialProjectId,
        useWorktree: proj.isGitRepo ? (proj.defaultWorktree ?? false) : false,
        sourceBranch: null,
        model: proj.defaultModel ?? 'sonnet',
        thinkingLevel: proj.defaultThinkingLevel ?? 'high',
      };
    }
  }
  return {
    title: '',
    description: '',
    projectId: null,
    useWorktree: false,
    sourceBranch: null,
    model: 'sonnet',
    thinkingLevel: 'high',
  };
});
```

- [ ] **Step 3: Fire `onColorChange` on mount when project is pre-set**

Add a `useEffect` after the existing focus effect (line 600-602) to notify the parent of the initial project color:

```typescript
useEffect(() => {
  if (initialProjectId != null) {
    const proj = projectStore.getProject(initialProjectId);
    onColorChange?.(proj?.color ?? null);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 4: Verify build compiles**

Run: `pnpm build`
Expected: No type errors. Existing callers don't pass `initialProjectId`, so it's backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add app/components/CardDetail.tsx
git commit -m "feat: add initialProjectId prop to NewCardDetail"
```

---

### Task 2: Add `+` button and `creatingCard` state to `ColumnSlot`

**Files:**

- Modify: `app/routes/board.tsx:458-601`

- [ ] **Step 1: Add local state**

Inside `ColumnSlot` (after line 476 — the `draftColor` state), add:

```typescript
const [creatingCard, setCreatingCard] = useState(false);
```

- [ ] **Step 2: Clear `creatingCard` on drop**

At the top of `handleDrop` (line 494, after `e.preventDefault()`), add:

```typescript
setCreatingCard(false);
```

- [ ] **Step 3: Add the `NewCardDetail` render branch**

In the render logic (line 539), after the existing `newCardColumn && index === 0` branch and before the `cardId != null` branch, insert a new branch:

```tsx
) : creatingCard && pinProjectId != null ? (
  <NewCardDetail
    column="running"
    initialProjectId={pinProjectId}
    onCreated={(id, projectId) => {
      setCreatingCard(false);
      setDraftColor(null);
      onCardCreated(id, projectId);
    }}
    onClose={() => {
      setCreatingCard(false);
      setDraftColor(null);
    }}
    onColorChange={setDraftColor}
  />
```

The full ternary chain becomes:

```
newCardColumn && index === 0  →  NewCardDetail (existing)
creatingCard && pinProjectId  →  NewCardDetail (new)
cardId != null                →  CardDetail
pinProjectId != null          →  empty pinned state (with + button)
index === 0                   →  "Select a card"
else                          →  ProjectPinSelector
```

- [ ] **Step 4: Add `+` button to empty pinned header**

In the empty pinned column header (line 569), add a `+` button before the close button. Replace the header div (lines 569-588):

```tsx
<div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
  <span className="flex-1" />
  {(() => {
    const p = projectStore.getProject(pinProjectId);
    return p ? (
      <Badge
        variant="secondary"
        className={`text-xs shrink-0 ${p.color ? 'animate-review-glow' : ''}`}
        style={{
          ...(p.color ? { borderLeft: `3px solid var(--${p.color})` } : {}),
          ...(p.color ? ({ '--glow-color': `var(--${p.color})` } as React.CSSProperties) : {}),
        }}
      >
        {p.name}
      </Badge>
    ) : null;
  })()}
  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => setCreatingCard(true)}>
    <Plus className="size-4" />
  </Button>
  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => closeSlot(index)}>
    <X className="size-4" />
  </Button>
</div>
```

Note: `Plus` is already imported at line 6 of `board.tsx`.

- [ ] **Step 5: Verify build compiles**

Run: `pnpm build`
Expected: No type errors.

- [ ] **Step 6: Manual test**

1. Open the board at `http://localhost:6194`
2. Pin a column to a project that has no review/running cards
3. Verify the `+` button appears in the empty pinned header
4. Click `+` — form appears with "running" column and project pre-selected
5. Verify description is focused
6. Change column/project — verify selectors work
7. Press X — form closes, empty state with `+` returns
8. Click `+` again, then drag a card onto the slot — form dismissed, card shown
9. Click `+`, fill in description, wait for title suggestion, save — card created, resolver picks it up

- [ ] **Step 7: Commit**

```bash
git add app/routes/board.tsx
git commit -m "feat: add inline card creation to empty pinned columns"
```
