import { useEffect, useRef, useState } from "react";
import "./index.css";
import { detectHost } from "./lib/host";
import {
  exchangeWithWardrobe,
  formatCredits,
  fetchPlatformMe,
  getPlatformStatus,
  humanizePlatformError,
  type AuthState,
  type PlatformBalance,
} from "./lib/platform";
import {
  CATEGORIES,
  confirmItems,
  deleteItem,
  humanizeWardrobeError,
  isWardrobeApiError,
  listItems,
  scanItems,
  thumbnailUrl,
  type CandidateItem,
  type StoredItemView,
  type UncertainGarment,
} from "./lib/wardrobe";
import { compressImage } from "./lib/imageCompression";

type Step = "landing" | "photo" | "analyzing" | "candidates" | "grid";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("booting");
  const [balance, setBalance] = useState<PlatformBalance | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("landing");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [uncertain, setUncertain] = useState<UncertainGarment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<StoredItemView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<string>("top");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // One stable idempotency key per photo: retries of the same photo reuse it.
  const scanRequestIdRef = useRef<string>(crypto.randomUUID());

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
      // Preload grid count for returning users (metadata only, paginated).
      listItems(20)
        .then((g) => setItems(g.items))
        .catch(() => undefined);
    } catch (e) {
      setAuthError(humanizePlatformError(e));
      setAuthState("auth-error");
    }
  };

  useEffect(() => {
    void bootPlatform();
  }, []);

  const refreshBalance = () => {
    if (authState !== "authenticated") return;
    fetchPlatformMe()
      .then((me) => setBalance(me.balance))
      .catch(() => undefined);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const lowerName = file.name.toLowerCase();
    const isHeicByExt = lowerName.endsWith(".heic") || lowerName.endsWith(".heif");
    if (!file.type.startsWith("image/") && !isHeicByExt) {
      setError("Пожалуйста, выберите изображение");
      return;
    }
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setStep("photo");
    try {
      const result = await compressImage(file);
      // New photo = new deliberate action = fresh idempotency key.
      scanRequestIdRef.current = crypto.randomUUID();
      setImageBase64(result.base64);
      setImageMime(result.mimeType);
      setImagePreviewUrl(result.dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("landing");
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = "";
  };

  const triggerScan = async () => {
    if (!imageBase64) {
      setError("Сначала выберите фото");
      return;
    }
    setError(null);
    setStep("analyzing");
    try {
      const { data, meta } = await scanItems({
        imageBase64,
        mimeType: imageMime,
        requestId: scanRequestIdRef.current,
      });
      if (meta.balance) setBalance({ available: meta.balance.available, reserved: 0 });
      else refreshBalance();
      setCandidates(data.items);
      setUncertain(data.uncertainItems);
      setSelected(new Set(data.items.map((i) => i.canonicalName)));
      setStep("candidates");
    } catch (e) {
      setError(humanizeWardrobeError(e));
      setStep("photo");
    }
  };

  const toggleSelect = (canonical: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(canonical)) next.delete(canonical);
      else next.add(canonical);
      return next;
    });
  };

  const addUncertain = (u: UncertainGarment) => {
    setCandidates((prev) => {
      if (prev.some((p) => p.canonicalName === u.canonicalName)) return prev;
      return [
        ...prev,
        {
          canonicalName: u.canonicalName,
          displayName: u.displayName,
          category: "top",
          colors: [],
          confidence: 0.5,
        },
      ];
    });
    setSelected((prev) => new Set(prev).add(u.canonicalName));
    setUncertain((prev) => prev.filter((x) => x.canonicalName !== u.canonicalName));
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    const canonical =
      name
        .toLowerCase()
        .replace(/[^a-zа-яё0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64) || "custom";
    setCandidates((prev) => {
      if (prev.some((p) => p.canonicalName === canonical)) return prev;
      return [
        ...prev,
        {
          canonicalName: canonical,
          displayName: name.slice(0, 64),
          category: customCategory,
          colors: [],
          confidence: 1,
        },
      ];
    });
    setSelected((prev) => new Set(prev).add(canonical));
    setCustomName("");
  };

  const handleConfirm = async () => {
    if (!imageBase64) return;
    setError(null);
    try {
      const selections = candidates
        .filter((c) => selected.has(c.canonicalName))
        .map((c) => ({
          canonicalName: c.canonicalName,
          displayName: c.displayName,
          category: c.category,
          colors: c.colors,
          season: "all",
        }));
      const { items: created } = await confirmItems({
        requestId: scanRequestIdRef.current,
        imageBase64,
        selections,
      });
      setItems((prev) => [...created, ...prev]);
      setStep("grid");
    } catch (e) {
      if (isWardrobeApiError(e) && e.code === "SESSION_EXPIRED") {
        setAuthState("auth-error");
        setAuthError(humanizeWardrobeError(e));
        return;
      }
      setError(humanizeWardrobeError(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(humanizeWardrobeError(e));
    }
  };

  const openGrid = async () => {
    try {
      const g = await listItems(20);
      setItems(g.items);
      setStep("grid");
    } catch (e) {
      setError(humanizeWardrobeError(e));
    }
  };

  const resetToLanding = () => {
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setStep("landing");
    setImageBase64(null);
    setImagePreviewUrl(null);
    setCandidates([]);
    setUncertain([]);
    setSelected(new Set());
    setError(null);
  };

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
        {authState !== "booting" && authState !== "auth-error" && step === "landing" && (
          <section className="landing" data-testid="landing">
            <div className="landing-hero">
              <h1>Сфотографируй вещи — соберём гардероб.</h1>
              <p>
                На одном фото помещается 2–8 вещей. Подтвердишь находки — сохраним в твой гардероб.
              </p>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <div className="cta-stack">
              <button
                className="btn btn-primary"
                onClick={() => cameraInputRef.current?.click()}
                data-testid="cta-camera"
              >
                📷 Сфотографировать вещи
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                data-testid="cta-upload"
              >
                Загрузить фото
              </button>
              {items.length > 0 && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void openGrid()}
                  data-testid="open-grid"
                >
                  Мой гардероб ({items.length})
                </button>
              )}
              <div className="helper">
                Фото вещей используется для распознавания и не сохраняется целиком
              </div>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="upload-input"
              onChange={onPickFile}
              data-testid="input-camera"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="upload-input"
              onChange={onPickFile}
              data-testid="input-upload"
            />
          </section>
        )}

        {step === "photo" && (
          <section className="photo-section" data-testid="photo-step">
            <h2 style={{ margin: 0, fontSize: 18 }}>Твоё фото</h2>
            <div className="photo-preview">
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="Выбранное фото одежды" />
              ) : (
                <div className="placeholder">Нет фото</div>
              )}
            </div>
            {error && (
              <div className="error-banner" role="alert" data-testid="error-banner">
                <span>{error}</span>
                <button onClick={() => setError(null)}>Скрыть</button>
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={() => void triggerScan()}
              data-testid="analyze-btn"
            >
              Найти вещи (1 кредит)
            </button>
            <button className="btn btn-ghost btn-small" onClick={resetToLanding}>
              На главную
            </button>
          </section>
        )}

        {step === "analyzing" && (
          <section className="analyzing" data-testid="analyzing">
            <div className="spinner" aria-hidden="true" />
            <h2>Смотрю, что на фото…</h2>
            {imagePreviewUrl && (
              <div className="preview-thumb">
                <img src={imagePreviewUrl} alt="preview" />
              </div>
            )}
          </section>
        )}

        {step === "candidates" && (
          <section className="ingredients" data-testid="candidates-step">
            <h2>Вот что я нашёл</h2>
            <p className="subtitle">Сними галочку с лишнего, подтверди своё</p>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <div className="chip-list" data-testid="candidates-list">
              {candidates.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 14 }}>
                  Ничего уверенного — добавь вручную
                </div>
              )}
              {candidates.map((c) => (
                <label
                  key={c.canonicalName}
                  className="chip"
                  data-testid={`candidate-${c.canonicalName}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.canonicalName)}
                    onChange={() => toggleSelect(c.canonicalName)}
                    data-testid={`toggle-${c.canonicalName}`}
                  />
                  <span>{c.displayName}</span>
                </label>
              ))}
            </div>
            {uncertain.length > 0 && (
              <div className="uncertain-section" data-testid="uncertain-section">
                <h3>Возможно ещё</h3>
                <div className="chip-list">
                  {uncertain.map((u) => (
                    <div key={u.canonicalName} className="chip uncertain">
                      <span>{u.displayName}</span>
                      <button
                        onClick={() => addUncertain(u)}
                        aria-label={`Добавить ${u.displayName}`}
                        data-testid={`add-uncertain-${u.canonicalName}`}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="add-row">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Своя вещь…"
                className="input-add"
                data-testid="add-input"
              />
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                data-testid="add-category"
                aria-label="Категория"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-small"
                onClick={addCustom}
                data-testid="add-btn"
              >
                + Добавить
              </button>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void handleConfirm()}
              disabled={selected.size === 0}
              data-testid="confirm-btn"
            >
              Сохранить в гардероб →
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => setStep("photo")}>
              ← Вернуться к фото
            </button>
          </section>
        )}

        {step === "grid" && (
          <section className="recs" data-testid="grid">
            <h2>Мой гардероб</h2>
            {error && <div className="error-banner">{error}</div>}
            {items.length === 0 && <p className="subtitle">Пока пусто — добавь первые вещи.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="recipe-card"
                  data-testid={`item-${item.canonicalName}`}
                >
                  {item.thumbnail && (
                    <img
                      src={thumbnailUrl(item.id)}
                      alt={item.displayName}
                      width={96}
                      height={96}
                      data-testid={`thumb-${item.canonicalName}`}
                    />
                  )}
                  <h3>{item.displayName}</h3>
                  <div className="meta-row">
                    <span>{item.category}</span>
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => void handleDelete(item.id)}
                      data-testid={`delete-${item.canonicalName}`}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={resetToLanding} data-testid="add-more">
              + Добавить ещё
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
