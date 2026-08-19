import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Fragment, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  footer,
  widthClass = "max-w-2xl",
}: Props) {
  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        </TransitionChild>

        <div className="fixed inset-0 flex justify-end">
          <TransitionChild
            as={Fragment}
            enter="transform transition ease-out duration-200"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transform transition ease-in duration-150"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <DialogPanel
              className={`w-screen ${widthClass} bg-white h-full flex flex-col shadow-2xl`}
            >
              <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
                <div>
                  <DialogTitle className="text-lg font-semibold text-gray-900">
                    {title}
                  </DialogTitle>
                  {subtitle && (
                    <div className="text-sm text-gray-500 mt-1">{subtitle}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 -m-2 text-gray-400 hover:text-gray-600 rounded-md"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              {actions && (
                <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100 bg-gray-50">
                  {actions}
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

              {footer && (
                <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
                  {footer}
                </div>
              )}
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
