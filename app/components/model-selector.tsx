import { useState, useRef, useEffect } from "react";

interface ModelOption {
  id: string;
  displayName: string;
}

interface ModelSelectorProps {
  availableModels: ModelOption[];
  currentModel: string;
  onModelChange: (modelId: string) => void;
}

export function ModelSelector({
  availableModels,
  currentModel,
  onModelChange,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentModelData = availableModels.find((m) => m.id === currentModel);
  const displayName = currentModelData?.displayName || currentModel;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (availableModels.length <= 1) {
    return (
      <div>
        <span className="text-neutral-900 dark:text-neutral-100 text-lg">Compiler</span>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{displayName}</div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 hover:opacity-70 transition-opacity text-left"
      >
        <div>
          <span className="text-neutral-900 dark:text-neutral-100 text-lg">Compiler</span>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{displayName}</div>
        </div>
        <svg
          className={`w-4 h-4 text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg z-50 py-1">
          {availableModels.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onModelChange(model.id);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                model.id === currentModel
                  ? "bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
              }`}
            >
              {model.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
