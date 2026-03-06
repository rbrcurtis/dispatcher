import { useState, useRef } from 'react';
import { Outlet, Link, useLocation, useSearchParams } from 'react-router';
import { Settings } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { SearchBar } from '~/components/SearchBar';
import { ResizeHandle, useResizablePanel } from '~/components/ResizeHandle';

const NAV_ITEMS = [
  { to: '/', label: 'Board' },
  { to: '/backlog', label: 'Backlog' },
  { to: '/done', label: 'Done' },
] as const;

export default function BoardLayout() {
  const location = useLocation();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { panelRef, initialWidth, onMouseDown } = useResizablePanel();

  const selectedCardId = searchParams.get('card') ? Number(searchParams.get('card')) : null;

  function selectCard(id: number | null) {
    setSearchParams(prev => {
      if (id === null) {
        prev.delete('card');
      } else {
        prev.set('card', String(id));
      }
      return prev;
    }, { replace: true });
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <header className="shrink-0 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Conductor</h1>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label }) => (
              <Button
                key={to}
                variant={location.pathname === to ? 'default' : 'ghost'}
                size="sm"
                asChild
              >
                <Link to={to}>{label}</Link>
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
          <SearchBar ref={searchRef} value={search} onChange={setSearch} />
          <Button variant="ghost" size="icon" asChild className="shrink-0 text-muted-foreground">
            <Link to="/settings/repos" title="Settings">
              <Settings className="size-5" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: rows area */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <Outlet context={{ search, selectedCardId, selectCard }} />
        </div>

        {/* Resize handle (desktop only) */}
        <ResizeHandle onMouseDown={onMouseDown} />

        {/* Right: detail panel (desktop only) */}
        <div
          ref={panelRef}
          className="hidden lg:flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden"
          style={{ width: initialWidth }}
        >
          {selectedCardId ? (
            <div className="p-4 text-sm text-muted-foreground">
              Card {selectedCardId} detail (placeholder)
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a card to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
