import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { File02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import type { Agent } from "../lib/agents";
import type { SlashCommandMeta } from "../lib/slashCommands";
import type { Snippet } from "../lib/snippets";
import type { SkillConfig } from "@/modules/skills/types";

export type PickerItem =
  | { kind: "snippet"; snippet: Snippet }
  | { kind: "command"; command: SlashCommandMeta }
  | { kind: "skill"; skill: SkillConfig }
  | { kind: "agent"; agent: Agent }
  | { kind: "file"; filePath: string };

type Props = {
  items: readonly PickerItem[];
  activeIndex: number;
  onPick: (item: PickerItem) => void;
  onHover: (index: number) => void;
};

export function SnippetPickerContent({
  items,
  activeIndex,
  onPick,
  onHover,
}: Props) {
  const files = items.filter((it) => it.kind === "file");
  const agents = items.filter((it) => it.kind === "agent");
  const commands = items.filter((it) => it.kind === "command");
  const skills = items.filter((it) => it.kind === "skill");
  const snippets = items.filter((it) => it.kind === "snippet");
  let cursor = -1;

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={6}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      className="w-72 overflow-hidden rounded-lg border border-border/60 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
    >
      {items.length === 0 ? (
        <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
          No matches.
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto py-1">
          {files.length > 0 && (
            <>
              <SectionHeader label="Files" />
              <ul>
                {files.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "file") return null;
                  const fileName = it.filePath.split("/").pop() || it.filePath;
                  return (
                    <li key={`file-${it.filePath}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex
                            ? "bg-accent"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <HugeiconsIcon
                          icon={File02Icon}
                          size={13}
                          strokeWidth={1.5}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px]">
                          {fileName}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {it.filePath}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {agents.length > 0 && (
            <>
              <SectionHeader label="Agents" />
              <ul>
                {agents.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "agent") return null;
                  const a = it.agent;
                  return (
                    <li key={`agent-${a.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex
                            ? "bg-accent"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted/40">
                          <HugeiconsIcon
                            icon={SparklesIcon}
                            size={11}
                            strokeWidth={1.5}
                            className="text-muted-foreground"
                          />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{a.name}</span>
                          {a.description ? (
                            <span className="line-clamp-1 text-[10px] text-muted-foreground">
                              {a.description}
                            </span>
                          ) : null}
                        </span>
                        {a.builtIn && (
                          <span className="rounded bg-muted/50 px-1 py-px text-[9px] text-muted-foreground">
                            BUILT-IN
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {commands.length > 0 && (
            <>
              <SectionHeader label="Commands" />
              <ul>
                {commands.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "command") return null;
                  const c = it.command;
                  return (
                    <li key={`cmd-${c.name}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex
                            ? "bg-accent"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <HugeiconsIcon
                          icon={c.icon}
                          size={13}
                          strokeWidth={1.75}
                          className="text-muted-foreground"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-muted-foreground">
                              /{c.name}
                            </span>
                            <span className="font-medium">{c.label}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {skills.length > 0 && (
            <>
              <SectionHeader label="Skills" />
              <ul>
                {skills.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "skill") return null;
                  const s = it.skill;
                  return (
                    <li key={`skill-${s.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex
                            ? "bg-accent"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          <span className="font-mono text-muted-foreground">
                            /{s.name}
                          </span>
                          <span className="font-medium">{s.name}</span>
                        </span>
                        {s.description ? (
                          <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                            {s.description}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {snippets.length > 0 && (
            <>
              <SectionHeader label="Snippets" />
              <ul>
                {snippets.map((it) => {
                  cursor += 1;
                  const i = cursor;
                  if (it.kind !== "snippet") return null;
                  const s = it.snippet;
                  return (
                    <li key={`sn-${s.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(it)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-[12px]",
                          i === activeIndex
                            ? "bg-accent"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          <span className="font-mono text-muted-foreground">
                            #{s.handle}
                          </span>
                          <span className="font-medium">{s.name}</span>
                        </span>
                        {s.description ? (
                          <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                            {s.description}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </PopoverContent>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {label}
    </div>
  );
}
