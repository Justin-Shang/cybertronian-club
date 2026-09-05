// StatPilot 体育数据分析模块统一布局
import Layout from "@/components/layout";

export default function StatpilotLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <div className="h-full overflow-y-auto">{children}</div>
    </Layout>
  );
}
