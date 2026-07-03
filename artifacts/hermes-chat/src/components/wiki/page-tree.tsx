import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronRight, ChevronDown, FileText } from "lucide-react";
import { PageTreeNode } from "@workspace/api-client-react";

interface TreeNodeProps {
  node: PageTreeNode;
  depth?: number;
}

function TreeNode({ node, depth = 0 }: TreeNodeProps) {
  const [location] = useLocation();
  const isActive = location === `/wiki/pages/${node.id}`;
  const hasChildren = node.children && node.children.length > 0;
  const [open, setOpen] = useState(() => {
    const isAncestor = (n: PageTreeNode): boolean =>
      location === `/wiki/pages/${n.id}` || (n.children ?? []).some(isAncestor);
    return isAncestor(node);
  });

  return (
    <div>
      <div
        className="flex items-center gap-1 group"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center justify-center w-4 h-4 shrink-0 text-muted-foreground transition-colors ${
            hasChildren ? "hover:text-foreground" : "invisible"
          }`}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        <Link
          href={`/wiki/pages/${node.id}`}
          className={`flex items-center gap-1.5 flex-1 min-w-0 py-1 pr-2 text-sm rounded transition-colors ${
            isActive
              ? "text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="w-3.5 h-3.5 shrink-0 opacity-50" />
          <span className="truncate">{node.title}</span>
        </Link>
      </div>

      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface PageTreeProps {
  nodes: PageTreeNode[];
}

export function PageTree({ nodes }: PageTreeProps) {
  if (nodes.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">No pages yet.</p>;
  }
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} />
      ))}
    </div>
  );
}
