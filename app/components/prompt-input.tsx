import { useRef, useEffect, useCallback } from "react";

export interface PendingFile {
  file: File;
  blobId?: string;
  uploading: boolean;
  previewUrl: string;
}

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
  files?: PendingFile[];
  onFilesChange?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
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
  files = [],
  onFilesChange,
  onRemoveFile,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus, autoFocusKey]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!onFilesChange) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        onFilesChange(pastedFiles);
      }
    },
    [onFilesChange]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!onFilesChange || !e.target.files) return;
      const selected = Array.from(e.target.files);
      onFilesChange(selected);
      e.target.value = "";
      textareaRef.current?.focus();
    },
    [onFilesChange]
  );

  const hasUploading = files.some((f) => f.uploading);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((value.trim() || files.length > 0) && !disabled && !isStreaming && !hasUploading) {
        const form = e.currentTarget.closest("form");
        if (form) {
          form.requestSubmit();
        } else {
          onSubmit();
        }
      }
    }
  };

  const hasFiles = files.length > 0;

  return (
    <div className="relative bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-3xl">
      {hasFiles && (
        <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto">
          {files.map((f, i) => (
            <div key={i} className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-600">
              {f.file.type.startsWith("image/") ? (
                <img
                  src={f.previewUrl}
                  alt={f.file.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-neutral-100 dark:bg-neutral-700 flex flex-col items-center justify-center p-1">
                  <svg className="w-5 h-5 text-neutral-500 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <span className="text-[9px] text-neutral-500 dark:text-neutral-400 truncate w-full text-center mt-0.5">
                    {f.file.name.split(".").pop()?.toUpperCase()}
                  </span>
                </div>
              )}
              {f.uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              )}
              {onRemoveFile && !isStreaming && (
                <button
                  type="button"
                  onClick={() => onRemoveFile(i)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center">
        {onFilesChange && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || files.length >= 5}
              className="pl-3 pr-1 py-3 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors disabled:opacity-30"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          autoFocus={autoFocus}
          className={`flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 py-3 ${onFilesChange ? "pl-1" : "pl-4"} resize-none focus:outline-none disabled:opacity-50`}
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
            disabled={(!value.trim() && files.length === 0) || disabled || hasUploading}
            className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors disabled:opacity-30"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
