import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props { title: string; children: ReactNode; onClose(): void; className?: string; }
export function Modal({ title, children, onClose, className = '' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog.current?.open) return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      if (!controls.length) return;
      const active = document.activeElement;
      const position = controls.indexOf(active as HTMLElement);
      const next = position < 0 ? event.shiftKey ? controls.length - 1 : 0 : (position + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      const target = controls[next];
      event.preventDefault(); target.focus();
    };
    document.addEventListener('keydown', trapTab, true);
    return () => {
      document.removeEventListener('keydown', trapTab, true);
      dialog.current?.close();
      // Restore after React removes the dialog; native close restoration may run first.
      requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); });
    };
  }, []);
  return <dialog ref={dialog} className={`modal ${className}`} aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); close.current(); }}>
    <header className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Закрыть окно" onClick={onClose}><X aria-hidden="true" size={20} /></button></header>
    {children}
  </dialog>;
}
