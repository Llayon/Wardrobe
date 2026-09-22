import { useEffect, useState } from "react";
import "./index.css";
import { detectHost } from "./lib/host";
import {
  exchangeWithWardrobe,
  formatCredits,
  getPlatformStatus,
  humanizePlatformError,
  type AuthState,
  type PlatformBalance,
} from "./lib/platform";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("booting");
  const [balance, setBalance] = useState<PlatformBalance | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const bootPlatform = async () => {
    setAuthState("booting");
    setAuthError(null);
    try {
      const status = await getPlatformStatus();
      if (!status.integrationEnabled) {
        setAuthState("anonymous");
        return;
      }
      const host = detectHost();
      if (host.name === "web" || !host.initData) {
        setAuthState("anonymous");
        return;
      }
      const account = await exchangeWithWardrobe({
        platform: host.name,
        initData: host.initData,
        startParam: host.startParam,
      });
      setBalance(account.balance);
      setAuthState("authenticated");
    } catch (e) {
      setAuthError(humanizePlatformError(e));
      setAuthState("auth-error");
    }
  };

  useEffect(() => {
    void bootPlatform();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logo">Гардероб</div>
        {authState === "authenticated" && balance && (
          <div className="balance-chip" data-testid="balance-chip">
            {formatCredits(balance.available)}
          </div>
        )}
      </header>
      <main className="app-main">
        {authState === "booting" && (
          <section className="analyzing" data-testid="auth-booting">
            <div className="spinner" aria-hidden="true" />
            <h2>Открываю…</h2>
          </section>
        )}
        {authState === "auth-error" && (
          <section className="landing" data-testid="auth-error">
            <div className="error-banner" role="alert">
              <span>{authError ?? "Не удалось войти"}</span>
              <button onClick={() => void bootPlatform()} data-testid="auth-retry">
                Повторить
              </button>
            </div>
          </section>
        )}
        {authState !== "booting" && authState !== "auth-error" && (
          <section className="landing" data-testid="landing">
            <h1>Гардероб скоро откроется.</h1>
            <p>Gauntlet 1: интеграция платформы. Вещи — в следующей фазе.</p>
          </section>
        )}
      </main>
    </div>
  );
}
