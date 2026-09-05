/**
 * 全局 Command Palette（Cmd+K / Ctrl+K）。
 *
 * 触发：任意位置按 Cmd+K（macOS）/ Ctrl+K（其他）。
 * 内容：所有模块首页 + 各模块子页面，按模块分组，cmdk fuzzy 搜索。
 * 选中：关闭面板并 wouter 跳转。
 *
 * 作为导航"第二通道"，与 Activity Bar / Drawer / Launcher 互补。
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { modules } from "@/modules/registry";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // 输入框内也允许触发（避免与文本编辑冲突时再细化）
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setLocation(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="搜索模块或页面…  ⌘K" />
      <CommandList>
        <CommandEmpty>无匹配结果</CommandEmpty>
        {modules.map((m) => (
          <CommandGroup key={m.id} heading={m.label}>
            <CommandItem
              onSelect={() => go(m.path)}
              value={`${m.label} ${m.description || ""} 首页 home`}
            >
              <m.icon className="w-4 h-4 mr-2 shrink-0" />
              <span>{m.label} · 首页</span>
            </CommandItem>
            {m.nav?.map((item) => (
              <CommandItem
                key={item.path}
                onSelect={() => go(item.path)}
                value={`${m.label} ${item.label}`}
              >
                {item.icon ? (
                  <item.icon className="w-4 h-4 mr-2 shrink-0" />
                ) : (
                  <span className="w-4 mr-2 shrink-0" />
                )}
                <span>
                  {m.label} · {item.label}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
