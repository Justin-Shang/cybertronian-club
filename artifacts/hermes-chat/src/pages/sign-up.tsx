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

export default function SignUpPage() {
  const { register, loginGoogle } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(email, password, displayName);
      setLocation("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "注册失败");
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
          <h1 className="text-xl font-semibold text-foreground">注册账号</h1>
          <p className="text-xs text-muted-foreground">需在白名单内方可注册</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">显示名</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码（至少 8 位）</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "注册中…" : "注册"}
          </Button>
        </form>
        {googleClientId && (
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={(resp) => onGoogle(resp.credential ?? "")}
              onError={() => toast.error("Google 登录失败")}
              text="signup_with"
              shape="rectangular"
              width={320}
            />
          </div>
        )}
        <p className="text-xs text-center text-muted-foreground">
          已有账号？{" "}<Link href="/sign-in" className="text-primary hover:underline">登录</Link>
        </p>
      </Card>
    </div>
  );
}
