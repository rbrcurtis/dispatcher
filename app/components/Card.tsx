import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const priorityColors: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-blue-500',
  low: 'border-l-gray-300',
};

interface CardProps {
  id: number;
  title: string;
  priority: string;
}

export function Card({ id, title, priority }: CardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded bg-white dark:bg-gray-800 border-l-4 ${priorityColors[priority] ?? 'border-l-gray-300'} px-3 py-2 shadow-sm cursor-grab active:cursor-grabbing select-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{title}</p>
    </div>
  );
}

export function CardOverlay({ title, priority }: { title: string; priority: string }) {
  return (
    <div
      className={`rounded bg-white dark:bg-gray-800 border-l-4 ${priorityColors[priority] ?? 'border-l-gray-300'} px-3 py-2 shadow-lg cursor-grabbing select-none w-72`}
    >
      <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{title}</p>
    </div>
  );
}
