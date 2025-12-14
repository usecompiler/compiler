import type { Blocker } from "react-router";

interface NavigationBlockerProps {
  blocker: Blocker;
}

export function NavigationBlocker({ blocker }: NavigationBlockerProps) {
  if (blocker.state !== "blocked") {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Agent is still working
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Leaving this page will stop the current response. Are you sure you want to leave?
          </p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-neutral-50 dark:bg-neutral-900/50">
          <button
            onClick={() => blocker.reset?.()}
            className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
          >
            Stay
          </button>
          <button
            onClick={() => blocker.proceed?.()}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
          >
            Leave anyway
          </button>
        </div>
      </div>
    </div>
  );
}
