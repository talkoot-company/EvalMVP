import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isAuthenticated, loginWithPassword } from "@/lib/auth";

const LoginPage = () => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  if (isAuthenticated()) {
    return <Navigate to="/criteria" replace />;
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const ok = loginWithPassword(password);
    if (!ok) {
      setError("Incorrect password.");
      return;
    }

    const next = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    navigate(next && next !== "/login" ? next : "/criteria", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full">Continue</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
