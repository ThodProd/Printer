import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  dangerous = false,
}) => (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[200]"
    onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
  >
    <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
      <div className="flex items-start gap-3 mb-5">
        <AlertTriangle
          className={dangerous ? 'text-red-500 shrink-0 mt-0.5' : 'text-yellow-500 shrink-0 mt-0.5'}
          size={22}
        />
        <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{message}</p>
      </div>
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={
            dangerous
              ? 'px-4 py-2 rounded-xl text-sm text-white bg-red-600 hover:bg-red-700 transition-colors'
              : 'px-4 py-2 rounded-xl text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

interface AlertModalProps {
  message: string;
  onClose: () => void;
  variant?: 'info' | 'error' | 'success';
}

export const AlertModal: React.FC<AlertModalProps> = ({
  message,
  onClose,
  variant = 'info',
}) => {
  const iconColor =
    variant === 'error' ? 'text-red-500' :
    variant === 'success' ? 'text-green-500' :
    'text-blue-500';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[200]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
        <div className="flex items-start gap-3 mb-5">
          <Info className={`${iconColor} shrink-0 mt-0.5`} size={22} />
          <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{message}</p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            ОК
          </button>
        </div>
      </div>
    </div>
  );
};
