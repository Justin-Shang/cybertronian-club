/**
 * 用户 pin 配置：决定哪些模块常驻 Activity Bar。
 *
 * 持久化到 localStorage，key = cybertron:pinnedModules（string[] 模块 id）。
 * 初始值 = registry 中 defaultPin=true 的模块，顺序保持 registry 顺序。
 * togglePin 追加到末尾（P1 不做拖拽重排，顺序由 pin 顺序决定）。
 */
import { useCallback, useEffect, useState } from "react";
import { modules, type AppModule } from "@/modules/registry";

const PINNED_KEY = "cybertron:pinnedModules";

function loadPinnedIds(): string[] {
  const fallback = modules.filter((m) => m.defaultPin).map((m) => m.id);
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(PINNED_KEY);
    if (saved) {
      const ids = JSON.parse(saved);
      if (Array.isArray(ids) && ids.length > 0) {
        // 过滤掉已不存在的 id，保留有效顺序
        const valid = ids.filter((id: string) => modules.some((m) => m.id === id));
        if (valid.length > 0) return valid;
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return fallback;
}

export function usePinnedModules() {
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinnedIds);

  useEffect(() => {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const isPinned = useCallback(
    (id: string) => pinnedIds.includes(id),
    [pinnedIds],
  );

  // 按 pinnedIds 顺序解析为模块对象
  const pinnedOrdered: AppModule[] = pinnedIds
    .map((id) => modules.find((m) => m.id === id))
    .filter((m): m is AppModule => !!m);

  return { pinnedIds, pinnedOrdered, togglePin, isPinned };
}
