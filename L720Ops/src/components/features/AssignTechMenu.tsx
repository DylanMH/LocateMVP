import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { ChevronUpDownIcon, CheckIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { OpsService } from "../../services/opsService";
import type { TechRow } from "../../types/ops";
import clsx from "clsx";

interface Props {
  value: string | null;
  onChange: (techId: string | null) => void;
  areaFilter?: string | null;
  placeholder?: string;
  disabled?: boolean;
}

export function AssignTechMenu({
  value,
  onChange,
  areaFilter,
  placeholder = "Unassigned",
  disabled,
}: Props) {
  const { data } = useQuery({
    queryKey: ["ops", "techs", "menu", areaFilter ?? null],
    queryFn: () =>
      OpsService.getTechs({
        range: "all",
        area: areaFilter || undefined,
      }),
    staleTime: 60000,
  });

  const techs: TechRow[] = data?.techs || [];
  const selected = techs.find((t) => t.id === value) || null;

  return (
    <Listbox
      value={value}
      onChange={(next: string | null) => onChange(next)}
      disabled={disabled}
    >
      <div className="relative">
        <ListboxButton
          className={clsx(
            "relative w-full cursor-default rounded-md bg-white py-1.5 pl-3 pr-10 text-left text-sm border border-gray-300 shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        >
          <span className="block truncate">
            {selected
              ? `${selected.name}${selected.areaId ? ` · ${selected.areaId}` : ""}`
              : placeholder}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-gray-400" />
          </span>
        </ListboxButton>
        <ListboxOptions className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
          <ListboxOption
            value={null}
            className={({ focus }) =>
              clsx(
                "cursor-default select-none relative py-2 pl-10 pr-4",
                focus ? "bg-blue-50 text-blue-900" : "text-gray-700",
              )
            }
          >
            {({ selected: s }) => (
              <>
                <span className={clsx("block truncate", s && "font-medium")}>
                  Unassigned
                </span>
                {s && (
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                    <CheckIcon className="h-5 w-5" />
                  </span>
                )}
              </>
            )}
          </ListboxOption>
          {techs.map((tech) => (
            <ListboxOption
              key={tech.id}
              value={tech.id}
              className={({ focus }) =>
                clsx(
                  "cursor-default select-none relative py-2 pl-10 pr-4",
                  focus ? "bg-blue-50 text-blue-900" : "text-gray-700",
                )
              }
            >
              {({ selected: s }) => (
                <>
                  <span className={clsx("block truncate", s && "font-medium")}>
                    {tech.name}
                    <span className="text-gray-400">
                      {tech.areaId ? ` · ${tech.areaId}` : ""} · {tech.ticketsOnBoard} open
                    </span>
                  </span>
                  {s && (
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                      <CheckIcon className="h-5 w-5" />
                    </span>
                  )}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
