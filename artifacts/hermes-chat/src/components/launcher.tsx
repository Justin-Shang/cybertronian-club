/**
 * 九宫格模块 Launcher。
 *
 * 从 Activity Bar 底部 "More" 按钮弹出，按 group 分组展示全部模块。
 * - 点击模块格：导航到该模块 + 关闭浮层
 * - 点击格子右上角 pin 按钮：toggle pin（不导航、不关闭，可连续操作）
 *
 * pinned 模块高亮（emerald 边框 + 角标），unpinned 为普通态。
 */
import { useState } from "react";
import { Link } from "wouter";
import { MoreHorizontal, Pin, PinOff } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { modules, type AppModule } from "@/modules/registry";

const GROUP_ORDER: AppModule["group"][] = ["常用", "工具", "内容", "娱乐"];

interface LauncherProps {
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  isPinned: (id: string) => boolean;
}

export function Launcher({ pinnedIds, onTogglePin, isPinned }: LauncherProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="全部模块"
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            open
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-80 p-3"
      >
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
          全部模块 · 已置顶 {pinnedIds.length}
        </div>
        {GROUP_ORDER.map((group) => {
          const items = modules.filter((m) => m.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-3 last:mb-0">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 px-1">
                {group}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {items.map((m) => (
                  <LauncherCell
                    key={m.id}
                    module={m}
                    pinned={isPinned(m.id)}
                    onTogglePin={() => onTogglePin(m.id)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function LauncherCell({
  module,
  pinned,
  onTogglePin,
  onNavigate,
}: {
  module: AppModule;
  pinned: boolean;
  onTogglePin: () => void;
  onNavigate: () => void;
}) {
  const Icon = module.icon;
  return (
    <div className="relative group">
      <Link href={module.path}>
        <button
          onClick={onNavigate}
          title={module.description || module.label}
          className={`w-full h-16 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all border ${
            pinned
              ? "bg-emerald-500/10 border-emerald-500/40 text-foreground hover:bg-emerald-500/15"
              : "bg-muted/40 border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[11px] font-medium leading-none">
            {module.label}
          </span>
        </button>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTogglePin();
        }}
        title={pinned ? "取消置顶" : "置顶到侧栏"}
        className={`absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center transition-all ${
          pinned
            ? "text-emerald-500 opacity-100"
            : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent"
        }`}
      >
        {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
      </button>
    </div>
  );
}
