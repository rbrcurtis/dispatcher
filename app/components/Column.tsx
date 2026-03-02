import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card } from './Card';

export type ColumnId = 'backlog' | 'ready' | 'in_progress' | 'review' | 'done';

const displayNames: Record<ColumnId, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

export const COLUMNS: ColumnId[] = ['backlog', 'ready', 'in_progress', 'review', 'done'];

interface CardItem {
  id: number;
  title: string;
  priority: string;
  position: number;
}

interface ColumnProps {
  id: ColumnId;
  cards: CardItem[];
}

export function Column({ id, cards }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div className="w-72 shrink-0 flex flex-col bg-gray-100 dark:bg-gray-900 rounded-lg">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {displayNames[id]}
        </h2>
        <span className="text-xs text-gray-500 bg-gray-200 dark:bg-gray-700 rounded-full px-2 py-0.5">
          {cards.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex flex-col gap-2 px-2 pb-2 min-h-[2rem] flex-1"
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <Card key={card.id} id={card.id} title={card.title} priority={card.priority} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
