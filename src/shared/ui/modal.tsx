import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './icon';
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const scope = dialog?.getRootNode();
    const opener = scope instanceof ShadowRoot ? scope.activeElement : document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
