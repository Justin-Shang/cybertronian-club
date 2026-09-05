import { useState, type FormEvent } from "react";
import { useLocation, Link } from "wouter";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export default function SignInPage() {
  const { login, loginGoogle } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      setLocation("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async (credential: string) => {
    setLoading(true);
    try {
      await loginGoogle(credential);
      setLocation("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google 登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-6 space-y-4">
        <div className="text-center space-y-1">
          <div className="mx-auto w-10 h-10 rounded-lg bg-primary flex items-center justify-center mb-2">
            <span className="text-primary-foreground text-base font-bold">H</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">登录 Transformer Club</h1>
          <p className="text-xs text-muted-foreground">多 Agent 协作平台</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </Button>
        </form>
        {googleClientId && (
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={(resp) => onGoogle(resp.credential ?? "")}
              onError={() => toast.error("Google 登录失败")}
              text="signin_with"
              shape="rectangular"
              width={320}
            />
          </div>
        )}
        <p className="text-xs text-center text-muted-foreground">
          没有账号？{" "}<Link href="/sign-up" className="text-primary hover:underline">注册</Link>
        </p>
      </Card>
    </div>
  );
}
