import { useState } from "react";
import { useFetcher } from "react-router";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  shareLink: { token: string; createdAt: string } | null;
}

export function ShareModal({ isOpen, onClose, conversationId, shareLink }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const fetcher = useFetcher();

  if (!isOpen) return null;

  const isCreating = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "create-share";
  const isRevoking = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "revoke-share";

  // Use fetcher data if available (optimistic update), otherwise use loader data
  const currentShareLink = fetcher.data?.shareRevoked ? null : (fetcher.data?.shareToken ? { token: fetcher.data.shareToken, createdAt: new Date().toISOString() } : shareLink);

  const shareUrl = currentShareLink ? `${window.location.origin}/share/${currentShareLink.token}` : null;

  const handleCopy = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreate = () => {
    fetcher.submit(
      { intent: "create-share" },
      { method: "post", action: `/c/${conversationId}` }
    );
  };

  const handleRevoke = () => {
    fetcher.submit(
      { intent: "revoke-share" },
      { method: "post", action: `/c/${conversationId}` }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-neutral-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Share conversation
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {currentShareLink ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={shareUrl || ""}
                  readOnly
                  className="flex-1 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Only members of your organization can view this conversation.
              </p>

              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Link created {new Date(currentShareLink.createdAt).toLocaleDateString()}
              </p>

              <button
                onClick={handleRevoke}
                disabled={isRevoking}
                className="w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {isRevoking ? "Revoking..." : "Revoke link"}
              </button>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-neutral-600 dark:text-neutral-400">
                Create a link to share this conversation with your team.
              </p>

              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Only members of your organization can view.
              </p>

              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="w-full px-4 py-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create link"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
