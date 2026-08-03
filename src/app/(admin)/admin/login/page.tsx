import { LoginForm } from "./login-form";

export default function AdminLoginPage() {
  return (
    <main className="admin-auth">
      <div className="admin-auth-card">
        <h1>Auction House Admin</h1>
        <LoginForm />
      </div>
    </main>
  );
}
