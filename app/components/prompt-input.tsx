import { useRef, useEffect } from "react";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string | null;
  name?: string;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isStreaming = false,
  onStop,
  placeholder = "Ask anything",
  autoFocus = false,
  autoFocusKey,
  name,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  // Handle autoFocus - native autoFocus only works on initial mount
  // autoFocusKey triggers refocus when it changes (e.g., conversationId)
  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus, autoFocusKey]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled && !isStreaming) {
        // Try to submit the parent form if one exists
        const form = e.currentTarget.closest("form");
        if (form) {
          form.requestSubmit();
        } else {
          onSubmit();
        }
      }
    }
  };

  return (
    <div className="relative flex items-center bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-3xl">
      <button
        type="button"
        className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <textarea
        ref={textareaRef}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isStreaming}
        rows={1}
        autoFocus={autoFocus}
        className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 py-3 resize-none focus:outline-none disabled:opacity-50"
        style={{ maxHeight: "200px" }}
      />

      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim() || disabled}
          className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors disabled:opacity-30"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      )}
    </div>
  );
}
