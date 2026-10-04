import { createContext, useContext, useState, type ReactNode } from 'react';

const FontRetryContext = createContext<{ revision: number; retry: () => void } | null>(null);

/** Retry the controls and preview in one editor without applying an unrelated draft. */
export function FontRetryScope({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: () => void;
}) {
  const [revision, setRevision] = useState(0);
  return (
    <FontRetryContext
      value={{
        revision,
        retry: () => {
          setRevision((value) => value + 1);
          onRetry?.();
        },
      }}
    >
      {children}
    </FontRetryContext>
  );
}

export const useFontRetry = () => useContext(FontRetryContext);
