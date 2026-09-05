// Finance 模块统一布局：全局 Layout（Activity Bar + Drawer 已含子导航）+ 滚动内容区
import Layout from "@/components/layout";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <div className="h-full overflow-y-auto">{children}</div>
    </Layout>
  );
}
